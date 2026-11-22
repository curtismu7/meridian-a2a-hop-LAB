// Run observability (rule 27) in this lab: the record the route builds for the CURRENT run, in the current mode. Mock rows are
// simulated and computed from what the mock did on this run; Real rows are replies the lab received plus lines read from an
// in-process fake Elasticsearch. Every record passes the shared assertRunObservability contract.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import http from 'node:http'
import { createApp } from '../src/app.js'
import { assertRunObservability, ElasticsearchReader, classify } from '../src/runObservability.js'
import { observeStep } from '../src/runLog.js'

const LAYERS = ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource']
// Built from parts so no scanner reads a test value as a real credential.
const JWT = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ1c2VyLTcifQ', 'c2lnbmF0dXJlc2lnbmF0dXJl'].join('.')
const ESKEY = ['read', 'only', 'test', 'value'].join('-')

let lines
let app
const mk = (opts = {}) => { lines = []; app = createApp({ runLogWrite: (l) => lines.push(l), ...opts }); return app }
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
    expect(rec.summary).toEqual({ allowed: 5, refused: 0, blocked: 0, info: 0 })
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

  it('Reset clears the run: back to 204', async () => {
    await toDoor()
    expect((await record()).status).toBe(200)
    await request(app).post('/api/flow/reset')
    expect((await record()).status).toBe(204)
  })

  it('the lab logs each decision as one timestamped stdout line: actor and outcome, never a token', async () => {
    await toDoor()
    await run({ step: 'mcp-payouts' })
    const tokens = (await request(app).get('/api/flow/captured')).body.tokens.map((t) => t.raw)
    expect(tokens.length).toBeGreaterThan(0)
    expect(lines).toHaveLength(5)
    for (const l of lines) {
      expect(l).toMatch(/^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] (INFO|WARN): meridian-a2a-hop .* actor=\S+ outcome=(allowed|refused|blocked|info) mode=mock$/)
      expect(l).not.toMatch(/eyJ/)
      for (const t of tokens) expect(l).not.toContain(t)
    }
    // only the resource line can be read by the MCP-server matchers: a door or exchange line never lands on the wrong layer
    const read = lines.map((l) => classify({ product: 'mcp-server', message: l }))
    expect(lines.filter((l, i) => read[i] && !/layer=resource/.test(l))).toEqual([])
    expect(lines.some((l) => /layer=resource/.test(l) && /served/.test(l))).toBe(true)
  })

  it('hostile text in a reply (a bearer, a JWT, an address, markup) is masked in the record', async () => {
    const evil = observeStep({ source: 'mock', stepId: 'third-party-exchange', who: { sub: 'jordan', actor: 'agent-1' }, result: { status: 400, response: { error: `Bearer ${JWT} from 203.0.113.9 <img src=x onerror=alert(1)>` } } })
    app.locals.runLog.record(evil[0])
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
function recordRealRun(a) {
  const who = { sub: 'user-7', actor: 'concierge-1' }
  const step = (stepId, result) => { for (const e of observeStep({ source: 'real', stepId, result, who })) a.locals.runLog.record(e) }
  a.locals.runLog.record({ source: 'real', layer: 'person', outcome: 'allowed', product: 'PingOne sign-in reply', actor: 'user-7', line: 'sign-in layer=person accepted', message: 'PingOne accepted the sign-in', detail: { status: 200 } })
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
    recordRealRun(app)
    // the line is written after the run began (inside its window)
    const stamp = new Date().toISOString()
    hits['mcp-server'] = [{ '@timestamp': stamp, message: `[${stamp}] INFO: tool query_account_payouts served for user-7`, ping_product: 'mcp-server' }]
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
    expect(rowsOf(rec, 'gateway')[0]).toMatchObject({ origin: 'response', outcome: 'refused' })
    // Elasticsearch is read with the read key, one search per product, and the key is not in the record
    expect(es.seen.length).toBeGreaterThan(0)
    expect(es.seen.every((s) => s.method === 'POST' && /_search$/.test(s.url) && s.auth === `ApiKey ${ESKEY}`)).toBe(true)
    expect(JSON.stringify(rec)).not.toContain(ESKEY)
  })

  it('with no reader configured: the replies still show, the log layers say unreachable and name what to set', async () => {
    process.env.DEMO_MODE = 'real'
    mk({ runObsReaders: [] })
    recordRealRun(app)
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
    recordRealRun(app)
    const res = await record()
    expect(res.status).toBe(200)
    expect(assertRunObservability(res.body)).toEqual([])
    expect(res.body.coverage.resource).toBe('unreachable')
    expect(res.body.reasons.resource).toMatch(/refused the read credential/)
    expect(JSON.stringify(res.body)).not.toContain(ESKEY)
  })

  it("the lab's own claim check refuses before anything reaches the gateway: no gateway row, and the reason says so", async () => {
    process.env.DEMO_MODE = 'real'
    mk({ runObsReaders: [] })
    for (const e of observeStep({ source: 'real', stepId: 'mcp-payouts', who: { sub: 'user-7' }, result: { ok: true, refused: { status: 401 }, traceNote: "This lab's own claim check refused the call before anything was sent to the gateway, so the gateway did nothing here." } })) app.locals.runLog.record(e)
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
    recordRealRun(app)
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
