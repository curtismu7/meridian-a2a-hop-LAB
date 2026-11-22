// Run observability (rule 27) in this lab: the record the route builds for the CURRENT run, in the current mode. Mock rows are
// simulated and computed from what the mock did on this run; Real rows are replies the lab received plus lines read from an
// in-process fake Elasticsearch. Every record passes the shared assertRunObservability contract.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import http from 'node:http'
import { createApp } from '../src/app.js'
import { assertRunObservability, classify, layerMatchers } from '../src/runObservability.js'
import { ElasticsearchReader } from '../src/runObservabilityReaders.js'
import { createRunLog, observeStep, observeSignIn, doorReplyOutcome, lineValue } from '../src/runLog.js'

// [time] INFO|WARN: meridian-a2a-hop decision <fields> actor=<who> result=<word> mode=<mode>
const LINE = /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] (INFO|WARN): meridian-a2a-hop decision [A-Za-z0-9 =._:/@-]+ actor=[A-Za-z0-9._:/@-]+ result=(passed|stopped|unclear|no-reply) mode=(mock|real)$/
const PRODUCTS = [...new Set(layerMatchers.map((m) => m.product))]
const LAYERS = ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource']
// Built from parts so no scanner reads a test value as a real credential.
const JWT = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ1c2VyLTcifQ', 'c2lnbmF0dXJlc2lnbmF0dXJl'].join('.')
const FAKEKEY = ['abcdefgh', '12345678'].join('')
const ESKEY = ['read', 'only', 'test', 'value'].join('-')

let lines
let app
let runLog
const mk = (opts = {}) => { lines = []; runLog = createRunLog({ write: (l) => lines.push(l) }); app = createApp({ runLog, ...opts }); return app }
beforeEach(() => { delete process.env.DEMO_MODE; mk() })

const run = (body) => request(app).post('/api/flow/run').send(body)
const record = () => request(app).get('/api/run-observability')

async function toDoor() {
  await run({ step: 'sign-in' })
  await request(app).post('/api/flow/external-tokens').send()
  await run({ step: 'third-party-exchange' })
  await run({ step: 'concierge-decides', overrides: { intent: 'Show my recent payouts' } })
  expect((await run({ step: 'exchange-payouts' })).body.status).toBe(200)
}
const rowsOf = (rec, layer) => rec.rows.filter((r) => r.layer === layer && r.origin !== 'not-logged')

describe('Mock: simulated rows computed from what the mock did', () => {
  it('no run yet: 204 and no body, never an empty record', async () => {
    const res = await record()
    expect(res.status).toBe(204)
    expect(res.body).toEqual({})
    expect(res.text).toBe('')
  })

  it('an allowed run: person, agent, gateway and resource are simulated, in time order; Authorize and Privilege say not-logged', async () => {
    await toDoor()
    expect((await run({ step: 'mcp-payouts' })).body.result.status).toBe(200)
    const res = await record()
    expect(res.status).toBe(200)
    const rec = res.body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rec.source).toBe('mock')
    expect(rec.truncated).toBe(false)
    expect(rec.rows.some((r) => r.origin === 'logged' || r.origin === 'response')).toBe(false)
    expect(rec.coverage).toEqual({ person: 'simulated', agent: 'simulated', authorize: 'not-logged', privilege: 'not-logged', gateway: 'simulated', resource: 'simulated' })
    expect(rec.reasons.authorize).toMatch(/does not call PingOne Authorize/)
    // 1 sign-in, 2 exchanges, 1 door verdict, 1 backend answer
    expect(rowsOf(rec, 'person')).toHaveLength(1)
    expect(rowsOf(rec, 'agent')).toHaveLength(2)
    expect(rowsOf(rec, 'gateway')[0]).toMatchObject({ outcome: 'allowed', origin: 'simulated', product: 'lab mock Privilege door' })
    expect(rowsOf(rec, 'resource')[0]).toMatchObject({ outcome: 'allowed', origin: 'simulated' })
    expect(rowsOf(rec, 'resource')[0].message).toMatch(/served query_account_payouts: 5 rows/)
    const order = rec.rows.filter((r) => r.at).map((r) => LAYERS.indexOf(r.layer))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(rec.summary).toEqual({ allowed: 5, refused: 0, blocked: 0, info: 0, unverified: 0 })
  })

  it('a refused door call: the door row says which check failed, and the backend row does not exist (it was never reached)', async () => {
    await toDoor()
    await run({ step: 'mcp-payouts', overrides: { body: { door: 'meridian-payouts', token: '{token:person}', tool: 'query_account_payouts', arguments: {} } } })
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    const gw = rowsOf(rec, 'gateway')
    expect(gw).toHaveLength(1)
    expect(gw[0]).toMatchObject({ outcome: 'refused', detail: { check: 'act', status: 401 } })
    expect(rowsOf(rec, 'resource')).toHaveLength(0)
    expect(rec.coverage.resource).toBe('not-logged')
    expect(rec.summary.refused).toBe(1)
  })

  it('the backend refusing a call the door let through is a resource row, not a gateway refusal', async () => {
    await toDoor()
    await run({ step: 'mcp-payouts', overrides: { body: { door: 'meridian-payments', token: '{token:payouts}', tool: 'take_guest_payment', arguments: {} } } })
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    // the payouts token at the payments door is refused by the door itself (aud); either way exactly one layer owns the refusal
    const refusedLayers = rec.rows.filter((r) => r.outcome === 'refused').map((r) => r.layer)
    expect(refusedLayers).toHaveLength(1)
  })

  it('a time the shared collector refuses (outside 2000 to 2100) is a 400 {error, message} JSON, never a blank or an HTML page', async () => {
    runLog = createRunLog({ write: () => {}, clock: () => Date.parse('1999-06-01T00:00:00Z') })
    app = createApp({ runLog })
    await run({ step: 'sign-in' })
    const res = await record()
    expect(res.status).toBe(400)
    expect(res.headers['content-type']).toMatch(/json/)
    expect(res.body).toMatchObject({ error: expect.any(String), message: expect.any(String) })
  })

  it('Reset clears the run: back to 204', async () => {
    await toDoor()
    expect((await record()).status).toBe(200)
    await request(app).post('/api/flow/reset')
    expect((await record()).status).toBe(204)
  })

  it('the lab logs each decision as one timestamped stdout line: actor and result, never a token', async () => {
    await toDoor()
    await run({ step: 'mcp-payouts' })
    const tokens = (await request(app).get('/api/flow/captured')).body.tokens.map((t) => t.raw)
    expect(tokens.length).toBeGreaterThan(0)
    expect(lines).toHaveLength(5)
    for (const l of lines) {
      expect(l).toMatch(LINE)
      expect(l).not.toMatch(/eyJ/)
      for (const t of tokens) expect(l).not.toContain(t)
    }
    expect(lines.every((l) => / INFO: /.test(l))).toBe(true)
  })

  it('hostile text in a reply (a bearer, a JWT, an address, markup) is masked in the record', async () => {
    const evil = observeStep({ source: 'mock', stepId: 'third-party-exchange', who: { sub: 'jordan', actor: 'agent-1' }, result: { status: 400, response: { error: `Bearer ${JWT} from 203.0.113.9 <img src=x onerror=alert(1)>` } } })
    runLog.record(evil[0])
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(JSON.stringify(rec)).not.toContain(JWT)
    expect(JSON.stringify(rec)).not.toContain('203.0.113.9')
  })
})

// A fake Elasticsearch on loopback that answers by product (the term the reader filters on). Records every request.
async function fakeEs(byProduct, { status = 200 } = {}) {
  const seen = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization })
      const product = body?.query?.bool?.filter?.[1]?.bool?.should?.[0]?.term?.ping_product
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(status === 200 ? { hits: { hits: (byProduct[product] || []).map((src) => ({ _index: 'demo-logs-x', _id: 'x', _source: src })) } } : { error: 'no' }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

// The Real flow needs a live PingOne tenant, so the tests hand the run log what each real step would have returned.
function recordRealRun() {
  const who = { sub: 'user-7', actor: 'concierge-1' }
  const step = (stepId, result) => { for (const e of observeStep({ source: 'real', stepId, result, who })) runLog.record(e) }
  for (const e of observeSignIn({ source: 'real', outcome: { ok: true, status: 200, response: { access_token: 'at-fake' } }, who })) runLog.record(e)
  step('third-party-exchange', { status: 200, response: {} })
  step('exchange-payouts', { status: 200, response: {} })
  step('mcp-payouts', { status: 200, gatewayTrace: [{ status: 403, trace: { source: 'real' } }] })
}

describe('Real: replies the lab received, plus lines read from Elasticsearch', () => {
  let es
  afterEach(() => { es?.close(); es = undefined })

  it('with an Elasticsearch that holds a matching line: response rows plus a logged row with an UNVERIFIED shape; nothing simulated', async () => {
    process.env.DEMO_MODE = 'real'
    const hits = {}
    es = await fakeEs(hits)
    mk({ runObsReaders: [new ElasticsearchReader({ url: es.url, apiKey: ESKEY })] })
    recordRealRun()
    // the line is written after the run began (inside its window)
    const stamp = new Date().toISOString()
    hits['mcp-server'] = [{ '@timestamp': stamp, message: `[${stamp}] INFO: Tool query_account_payouts served`, ping_product: 'mcp-server' }]
    const res = await record()
    expect(res.status).toBe(200)
    const rec = res.body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rec.source).toBe('real')
    expect(rec.rows.some((r) => r.origin === 'simulated')).toBe(false)
    expect(rec.coverage.person).toBe('response')
    expect(rec.coverage.agent).toBe('response')
    expect(rec.coverage.gateway).toBe('response')
    expect(rec.coverage.authorize).toBe('not-logged')
    expect(rec.coverage.resource).toBe('logged')
    expect(rowsOf(rec, 'resource')[0]).toMatchObject({ origin: 'logged', basis: 'unverified-shape' })
    // an unverified shape is counted as information (and as unverified), never as allowed: 3 response rows allowed, 1 refused
    expect(rec.summary).toMatchObject({ allowed: 3, refused: 1, unverified: 1 })
    expect(rec.summary.info).toBeGreaterThanOrEqual(1)
    expect(rowsOf(rec, 'gateway')[0]).toMatchObject({ origin: 'response', outcome: 'refused' })
    // Elasticsearch is read with the read key, one search per product, and the key is not in the record
    expect(es.seen.length).toBeGreaterThan(0)
    expect(es.seen.every((s) => s.method === 'POST' && /_search$/.test(s.url) && s.auth === `ApiKey ${ESKEY}`)).toBe(true)
    expect(JSON.stringify(rec)).not.toContain(ESKEY)
  })

  it('with no reader configured: the replies still show, the log layers say unreachable and name what to set', async () => {
    process.env.DEMO_MODE = 'real'
    mk({ runObsReaders: [] })
    recordRealRun()
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rec.coverage.resource).toBe('unreachable')
    expect(rec.reasons.resource).toMatch(/RUN_OBS_ES_URL and RUN_OBS_ES_READ_APIKEY/)
    expect(rec.coverage.person).toBe('response')
  })

  it('Elasticsearch refusing the key: unreachable with the reason, the route still answers 200', async () => {
    process.env.DEMO_MODE = 'real'
    es = await fakeEs({}, { status: 401 })
    mk({ runObsReaders: [new ElasticsearchReader({ url: es.url, apiKey: ESKEY })] })
    recordRealRun()
    const res = await record()
    expect(res.status).toBe(200)
    expect(assertRunObservability(res.body)).toEqual([])
    expect(res.body.coverage.resource).toBe('unreachable')
    expect(res.body.reasons.resource).toMatch(/refused the read credential/)
    expect(JSON.stringify(res.body)).not.toContain(ESKEY)
  })

  it('a measured MCP-server header line is a logged resource row with a measured shape, counted as information, not unverified', async () => {
    process.env.DEMO_MODE = 'real'
    const hits = {}
    es = await fakeEs(hits)
    mk({ runObsReaders: [new ElasticsearchReader({ url: es.url, apiKey: ESKEY })] })
    recordRealRun()
    const stamp = new Date().toISOString()
    hits['mcp-server'] = [{ '@timestamp': stamp, message: `[${stamp}] INFO: token audience validated`, ping_product: 'mcp-server' }]
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rowsOf(rec, 'resource')[0]).toMatchObject({ origin: 'logged', basis: 'measured-shape', outcome: 'info', matcher: 'mcp-server-validation' })
    expect(rec.summary.unverified).toBe(0)
  })

  it('an Elasticsearch search cut at the cap with no match: not-logged, flagged partial, and the contract holds', async () => {
    process.env.DEMO_MODE = 'real'
    const stamp = new Date().toISOString()
    const noise = Array.from({ length: 500 }, (_, i) => ({ '@timestamp': stamp, message: `unrelated line ${i}`, ping_product: 'mcp-server' }))
    es = await fakeEs({ 'mcp-server': noise })
    mk({ runObsReaders: [new ElasticsearchReader({ url: es.url, apiKey: ESKEY })] })
    recordRealRun()
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rec.coverage.resource).toBe('not-logged')
    expect(rec.partial).toMatchObject({ resource: true })
    expect(rec.reasons.resource).toMatch(/cut at the cap/)
  })

  it("the lab's own claim check refuses before anything reaches the gateway: no gateway row, and the reason says so", async () => {
    process.env.DEMO_MODE = 'real'
    mk({ runObsReaders: [] })
    for (const e of observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { ok: true, refused: { status: 401 }, traceNote: "This lab's own claim check refused the call before anything was sent to the gateway, so the gateway did nothing here." } })) runLog.record(e)
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rowsOf(rec, 'gateway')).toHaveLength(0)
    expect(rec.reasons.gateway).toMatch(/before anything was sent to the gateway/)
  })
})

describe('mode switch: both directions, and a record never carries the other mode', () => {
  const REAL_ENV = { MERIDIAN_PINGONE_ENV_ID: 'env-x', MERIDIAN_CONCIERGE_CLIENT_ID: 'c', MERIDIAN_CONCIERGE_CLIENT_SECRET: 's' }
  afterEach(() => { for (const k of Object.keys(REAL_ENV)) delete process.env[k] })

  it('Mock run, switch to Real (no real run yet: 204), record a Real run (source real), back to Mock (the Mock record is still the Mock run)', async () => {
    Object.assign(process.env, REAL_ENV)
    mk({ runObsReaders: [] })
    await toDoor()
    await run({ step: 'mcp-payouts' })
    expect((await record()).body.source).toBe('mock')

    expect((await request(app).post('/api/mode').send({ mode: 'real' })).status).toBe(200)
    expect((await record()).status).toBe(204)
    recordRealRun()
    const real = (await record()).body
    expect(real.source).toBe('real')
    expect(assertRunObservability(real)).toEqual([])
    expect(real.rows.every((r) => r.origin !== 'simulated')).toBe(true)

    expect((await request(app).post('/api/mode').send({ mode: 'mock' })).status).toBe(200)
    const mock = (await record()).body
    expect(mock.source).toBe('mock')
    expect(assertRunObservability(mock)).toEqual([])
    expect(mock.rows.every((r) => r.origin !== 'logged' && r.origin !== 'response')).toBe(true)
  })

  it('Real not configured still answers 409 and the Mock record is unchanged; /api/info keeps its shape', async () => {
    await toDoor()
    await run({ step: 'mcp-payouts' })
    expect((await request(app).post('/api/mode').send({ mode: 'real' })).status).toBe(409)
    expect((await record()).body.source).toBe('mock')
    const info = (await request(app).get('/api/info')).body
    expect(Object.keys(info).sort()).toEqual(['app', 'banner', 'demoUser', 'mode', 'realAvailable', 'realConfigured', 'workspaceId'])
  })
})

// ---- the stdout vocabulary: no shared matcher may read a lab line, on any path, refused included ------------------------------------
const classifyAll = (line) => PRODUCTS.filter((product) => classify({ product, message: line }) !== null)

describe("the lab's own stdout lines are never read by a shared matcher", () => {
  const events = () => [
    ...observeStep({ source: 'mock', stepId: 'sign-in', who: { sub: 'jordan' }, result: { status: 401 } }),
    ...observeStep({ source: 'mock', stepId: 'sign-in', who: { sub: 'jordan' }, result: { status: 200 } }),
    ...observeStep({ source: 'mock', stepId: 'third-party-exchange', who: { sub: 'jordan' }, result: { status: 400, response: { error: 'invalid_grant' } } }),
    ...observeStep({ source: 'real', stepId: 'third-party-exchange', who: { sub: 'user-7' }, result: { status: 403, response: { error: 'access_denied' } } }),
    ...observeStep({ source: 'real', stepId: 'exchange-payouts', who: { sub: 'user-7' }, result: { status: 401, response: { error: 'unauthorized forbidden insufficient scope token audience' } } }),
    ...observeSignIn({ source: 'real', outcome: { ok: false, status: 401 }, who: { sub: 'user-7' } }),
    ...observeSignIn({ source: 'real', outcome: { ok: true, status: 200 }, who: { sub: 'user-7' } }),
    ...observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { status: 403, response: {}, gatewayTrace: [{ status: 403 }] } }),
    ...observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { status: 200, response: { error: { code: -32001, message: 'denied' } }, gatewayTrace: [{ status: 200 }] } }),
    ...observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { status: 502, response: {}, gatewayTrace: [{ status: 502 }] } }),
    ...observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { status: 502, response: {}, gatewayTrace: [{ status: null }] } }),
    ...observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { refused: { status: 401 }, traceNote: 'refused before the gateway, denied' } }),
    ...observeStep({ source: 'mock', stepId: 'mcp-payouts', who: { sub: 'jordan' }, result: { refused: { status: 403, error: 'tool_not_allowed' }, gatewayTrace: [{ trace: { decisions: [{ id: 'tool', outcome: 'fail' }], request: { body: { tool: 'take_guest_payment' } } } }] } }),
    ...observeStep({ source: 'mock', stepId: 'mcp-payouts', who: { sub: 'jordan' }, result: { refused: { status: 403 }, gatewayTrace: [{ trace: { decisions: [{ id: 'door', outcome: 'pass' }, { id: 'backend', outcome: 'fail', evidence: 'refused' }], request: { body: { tool: 'x' } } } }] } }),
    ...observeStep({ source: 'mock', stepId: 'mcp-payouts', who: { sub: 'jordan' }, result: { result: { status: 200, payouts: [1, 2] }, gatewayTrace: [{ trace: { decisions: [{ id: 'door', outcome: 'pass' }], request: { body: { tool: 'query_account_payouts' } } } }] } }),
  ]

  it('every line, refused and rejected paths included, classifies as nothing for every product', () => {
    const out = []
    const log = createRunLog({ write: (l) => out.push(l) })
    const evs = events()
    expect(evs.length).toBeGreaterThanOrEqual(14)
    for (const e of evs) log.record(e)
    expect(out.some((l) => /result=stopped/.test(l))).toBe(true)
    for (const l of out) {
      expect(l).toMatch(LINE)
      expect(classifyAll(l), l).toEqual([])
      expect(l).not.toMatch(/refused|denied|forbidden|unauthori[sz]ed|insufficient|invalid|failed|expired|mismatch|rejected|not allowed|token|audience|scope|served|introspect/i)
    }
  })

  it('positive: a real MCP-server header-line shape still classifies as its own layer (the matchers are anchored, not switched off)', () => {
    const header = '[2026-11-22T10:00:06.000Z] INFO: token audience validated'
    expect(classify({ product: 'mcp-server', message: header })).toMatchObject({ layer: 'resource', matcher: 'mcp-server-validation', basis: 'measured-shape' })
  })

  it('level is INFO except for a real error (a door 5xx or no reply)', () => {
    const out = []
    const log = createRunLog({ write: (l) => out.push(l) })
    for (const e of events()) log.record(e)
    expect(out.filter((l) => / WARN: /.test(l))).toHaveLength(2)
    expect(out.filter((l) => / WARN: /.test(l)).every((l) => /status=502|reply=none/.test(l))).toBe(true)
  })

  it('a claim cannot add a fake key=value pair, a quote or a line', () => {
    const out = []
    const log = createRunLog({ write: (l) => out.push(l) })
    const hostile = 'jordan outcome=allowed" result=passed\nmode=real [2026-01-01T00:00:00Z] INFO: x'
    for (const e of observeStep({ source: 'mock', stepId: 'sign-in', who: { sub: hostile }, result: { status: 401 } })) log.record(e)
    for (const e of observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: hostile, actor: hostile }, result: { status: 403, gatewayTrace: [{ status: 403 }] } })) log.record(e)
    expect(out).toHaveLength(2)
    for (const l of out) {
      expect(l).toMatch(LINE)
      expect(l.split('\n')).toHaveLength(1)
      expect(l.match(/ result=/g)).toHaveLength(1)
      expect(l.match(/ actor=/g)).toHaveLength(1)
      expect(l.match(/ mode=/g)).toHaveLength(1)
      expect(l).not.toContain('"')
    }
    expect(lineValue('a b=c"d\ne')).toBe('a_b_c_d_e')
  })
})

describe('a door reply of HTTP 200 is a success only when its answer says so', () => {
  const door = (status, response) => observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { status, response, gatewayTrace: [{ status }] } })[0]

  it('outcomes from the answer, not the status alone', () => {
    expect(doorReplyOutcome(200, { jsonrpc: '2.0', result: { content: [] } })).toBe('allowed')
    expect(doorReplyOutcome(200, { jsonrpc: '2.0', error: { code: -32001 } })).toBe('refused')
    expect(doorReplyOutcome(200, { jsonrpc: '2.0', result: { isError: true } })).toBe('refused')
    expect(doorReplyOutcome(200, {})).toBe('info') // the body was not parsed (the real flow keeps {} for a non-JSON answer)
    expect(doorReplyOutcome(200, null)).toBe('info')
    expect(doorReplyOutcome(200, 'text')).toBe('info')
    expect(doorReplyOutcome(200, [])).toBe('info')
    expect(doorReplyOutcome(401, {})).toBe('refused')
    expect(doorReplyOutcome(403, { jsonrpc: '2.0', result: {} })).toBe('refused')
    expect(doorReplyOutcome(500, {})).toBe('info')
  })

  it('a JSON-RPC error inside HTTP 200 is never an allowed row, and the record counts no allowed', async () => {
    process.env.DEMO_MODE = 'real'
    mk({ runObsReaders: [] })
    runLog.record(door(200, { jsonrpc: '2.0', error: { code: -32001, message: 'no grant' } }))
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rowsOf(rec, 'gateway')[0]).toMatchObject({ outcome: 'refused', origin: 'response' })
    expect(rec.summary.allowed).toBe(0)
    runLog.reset()
    runLog.record(door(200, {}))
    const info = (await record()).body
    expect(rowsOf(info, 'gateway')[0].outcome).toBe('info')
    expect(info.summary).toMatchObject({ allowed: 0, info: 1 })
    expect(info.rows.find((r) => r.layer === 'gateway').message).toMatch(/could not be read as a tool result/)
  })
})

describe('an error that is not a string', () => {
  it('an object error never reads [object Object]; it is kept in detail as bounded JSON text', () => {
    const big = { error_description: 'x'.repeat(20000), nested: { a: [1, 2, 3] } }
    const [ev] = observeStep({ source: 'real', stepId: 'exchange-payouts', who: { sub: 'user-7' }, result: { status: 400, response: { error: big } } })
    expect(ev.message).not.toMatch(/object Object/)
    expect(ev.message).toMatch(/structured error object/)
    expect(typeof ev.detail.errorBody).toBe('string')
    expect(ev.detail.errorBody.length).toBeLessThanOrEqual(4096)
    expect(ev.detail.error).toBeUndefined()
    const [str] = observeStep({ source: 'real', stepId: 'exchange-payouts', who: { sub: 'user-7' }, result: { status: 400, response: { error: 'invalid_grant' } } })
    expect(str.message).toMatch(/rejected: invalid_grant/)
    expect(str.detail.error).toBe('invalid_grant')
  })

  it('the record built from an object error passes the contract', async () => {
    process.env.DEMO_MODE = 'real'
    mk({ runObsReaders: [] })
    for (const e of observeStep({ source: 'real', stepId: 'exchange-payouts', who: { sub: 'user-7' }, result: { status: 400, response: { error: { description: 'x'.repeat(9000), api_key: FAKEKEY } } } })) runLog.record(e)
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(JSON.stringify(rec)).not.toMatch(/object Object/)
    expect(JSON.stringify(rec)).not.toContain(FAKEKEY)
  })
})

// ---- the Real wiring through the routes, with a fake Real flow (the real one needs a live PingOne tenant) ----------------------------
function fakeRealFlow({ signIn, steps = {}, captured = [] } = {}) {
  return {
    captured,
    reset() { captured.length = 0 },
    async signInSubmit() { return signIn },
    async runStep(step) { return steps[step] },
  }
}
const submit = () => request(app).post('/api/flow/sign-in-submit').send({ username: 'u', password: 'p' })

describe('Real mode through the routes (fake Real flow)', () => {
  beforeEach(() => { process.env.DEMO_MODE = 'real' })

  it('a failed sign-in submit records a refused person row (a response, not a log) and the record shows it', async () => {
    const rf = fakeRealFlow({ signIn: { ok: false, status: 401, flow: { message: 'bad credentials' } } })
    mk({ realFlow: rf, runObsReaders: [] })
    expect((await submit()).body.ok).toBe(false)
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rec.source).toBe('real')
    expect(rowsOf(rec, 'person')[0]).toMatchObject({ outcome: 'refused', origin: 'response' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/layer=person status=401 .*result=stopped mode=real$/)
  })

  it('a sign-in submit with no open flow records nothing; in Mock the route is a 409 and records nothing', async () => {
    mk({ realFlow: fakeRealFlow({ signIn: { ok: false, error: 'no_flow' } }), runObsReaders: [] })
    await submit()
    expect((await record()).status).toBe(204)
    process.env.DEMO_MODE = 'mock'
    expect((await submit()).status).toBe(409)
    expect(lines).toHaveLength(0)
  })

  it('a whole Real run through /api/flow/run and /api/flow/sign-in-submit: who() comes from the newest captured claims, rows are responses', async () => {
    const captured = []
    const rf = fakeRealFlow({
      captured,
      signIn: { ok: true, status: 200, response: { access_token: 'at-fake' } },
      steps: {
        'third-party-exchange': { ok: true, step: 'third-party-exchange', status: 200, response: { access_token: 'at-fake' } },
        'exchange-payouts': { ok: true, step: 'exchange-payouts', status: 200, response: { access_token: 'at-fake' } },
        'mcp-payouts': { ok: true, step: 'mcp-payouts', status: 200, response: { jsonrpc: '2.0', id: 1, result: { content: [] } }, gatewayTrace: [{ status: 200, trace: { source: 'real' } }] },
      },
    })
    mk({ realFlow: rf, runObsReaders: [] })
    captured.push({ hop: 1, decoded: { sub: 'user-7' } })
    expect((await submit()).body.ok).toBe(true)
    captured.push({ hop: 2, decoded: { sub: 'user-7', act: { sub: 'agent-1', client_id: 'concierge-1' } } })
    for (const step of ['third-party-exchange', 'exchange-payouts', 'mcp-payouts']) expect((await run({ step })).status).toBe(200)
    const rec = (await record()).body
    expect(assertRunObservability(rec)).toEqual([])
    expect(rec.source).toBe('real')
    expect(rec.rows.some((r) => r.origin === 'simulated')).toBe(false)
    expect(rec.coverage).toMatchObject({ person: 'response', agent: 'response', gateway: 'response', authorize: 'not-logged' })
    expect(rowsOf(rec, 'agent')).toHaveLength(2)
    expect(rec.truncated).toBe(false) // ids in a row do not make a false "excerpt was cut" notice
    expect(rowsOf(rec, 'agent')[0].message).toMatch(/acting for user-7/)
    expect(JSON.stringify(rowsOf(rec, 'agent')[0].detail)).not.toMatch(/concierge-1|user-7/)
    expect(rowsOf(rec, 'gateway')[0]).toMatchObject({ outcome: 'allowed', origin: 'response' })
    expect(lines).toHaveLength(4)
    expect(lines.some((l) => l.includes('actor=concierge-1'))).toBe(true)
    expect(lines.every((l) => !l.includes('at-fake'))).toBe(true)
    expect(JSON.stringify(rec)).not.toContain('at-fake')
  })

  it("the Real flow's own pre-checks (no person token, no payouts token) record nothing", async () => {
    mk({ realFlow: fakeRealFlow({ steps: { 'exchange-payouts': { ok: false, status: 400, response: { error: 'no_person_token' } }, 'mcp-payouts': { ok: false, status: 400, response: { error: 'no_payouts_token' } } } }), runObsReaders: [] })
    await run({ step: 'exchange-payouts' })
    await run({ step: 'mcp-payouts' })
    expect((await record()).status).toBe(204)
  })
})
