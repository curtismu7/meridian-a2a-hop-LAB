// "What Privilege did" (rule 25) for the payouts door: every trace this lab builds passes the shared assertTrace contract; the mock
// decisions are `checked` (the simulated door computed them), a real trace never says `checked`, and no token is ever in a trace.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createFlow } from '../src/flow/orchestrator.js'
import { createRealFlow } from '../src/flow/realFlow.js'
import { assertTrace } from '../src/gatewayTrace.js'
import { createDoors } from '../../stub-issuer/doors.mjs'
import { createIssuer } from '../../stub-issuer/issuer.mjs'

let app
beforeEach(() => { app = createApp() })

const run = (body) => request(app).post('/api/flow/run').send(body)
const door = (body) => run({ step: 'mcp-payouts', overrides: { body: { arguments: {}, ...body } } })

async function toDoor() {
  await run({ step: 'sign-in' })
  await request(app).post('/api/flow/external-tokens').send()
  await run({ step: 'third-party-exchange' })
  await run({ step: 'concierge-decides', overrides: { intent: 'Show my recent payouts' } })
  expect((await run({ step: 'exchange-payouts' })).body.status).toBe(200)
}

const only = (res) => {
  expect(res.body.gatewayTrace).toHaveLength(1)
  return res.body.gatewayTrace[0]
}
const ids = (t, outcome) => t.trace.decisions.filter((d) => d.outcome === outcome).map((d) => d.id)

describe('mock: the simulated door computed every decision', () => {
  it('an allowed call: 7 checks pass, all checked, and the exchange is exact', async () => {
    await toDoor()
    const res = await run({ step: 'mcp-payouts' })
    const ex = only(res)
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ex.trace.source).toBe('mock')
    expect(ex.step).toBe(6)
    expect(ex.status).toBe(200)
    expect(ex.trace.decisions.map((d) => d.id)).toEqual(['door', 'token', 'act', 'aud', 'act-sub', 'client', 'tool'])
    expect(ex.trace.decisions.every((d) => d.outcome === 'pass' && d.basis === 'checked')).toBe(true)
    expect(ex.trace.request.url).toMatch(/^https:\/\/mcpgw\.meridian\.invalid\/meridian-payouts\/mcp$/)
    expect(ex.trace.request.body).toMatchObject({ door: 'meridian-payouts', tool: 'query_account_payouts' })
    expect(ex.trace.response.body).toEqual(res.body.result)
  })

  it('a person token at the door: refused at act, later checks not reached', async () => {
    await toDoor()
    const ex = only(await door({ door: 'meridian-payouts', token: '{token:person}', tool: 'query_account_payouts' }))
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ex.status).toBe(401)
    expect(ids(ex, 'pass')).toEqual(['door', 'token'])
    expect(ids(ex, 'fail')).toEqual(['act'])
    expect(ids(ex, 'skipped')).toEqual(['aud', 'act-sub', 'client', 'tool'])
  })

  it('the payouts token at the payments door: refused at aud', async () => {
    await toDoor()
    const ex = only(await door({ door: 'meridian-payments', token: '{token:payouts}', tool: 'take_guest_payment' }))
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ex.status).toBe(403)
    expect(ids(ex, 'fail')).toEqual(['aud'])
    expect(ids(ex, 'pass')).toEqual(['door', 'token', 'act'])
  })

  it("another specialist's tool at the payouts door: refused at tool", async () => {
    await toDoor()
    const ex = only(await door({ door: 'meridian-payouts', token: '{token:payouts}', tool: 'take_guest_payment' }))
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ids(ex, 'fail')).toEqual(['tool'])
    expect(ex.trace.response.body.error).toBe('tool_not_allowed')
  })

  it('an unknown door: refused at the first check, nothing else reached', async () => {
    await toDoor()
    const ex = only(await door({ door: 'no-such-door', token: '{token:payouts}', tool: 'query_account_payouts' }))
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ex.status).toBe(404)
    expect(ids(ex, 'fail')).toEqual(['door'])
    expect(ids(ex, 'skipped')).toHaveLength(6)
  })

  it('a garbage token: refused at the token check', async () => {
    const ex = only(await door({ door: 'meridian-payouts', token: 'not-a-token', tool: 'query_account_payouts' }))
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ids(ex, 'fail')).toEqual(['token'])
    expect(ex.trace.request.headers.authorization).toBe('Bearer not-a-token')
  })

  it('a payments token at the payments door passes the door, then the backend decision fails (checked)', async () => {
    const flow = createFlow()
    const token = await flow.issuer.issueAccessToken({ sub: 'jordan', client_id: 'meridian-payments', aud: 'meridian-payments-rs', scope: 'mp:payments', act_sub: 'meridian-concierge', act_client_id: 'meridian-concierge' })
    const out = await flow.runStep('mcp-payouts', { body: { door: 'meridian-payments', token, tool: 'take_guest_payment', arguments: {} } })
    const ex = out.gatewayTrace[0]
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ex.status).toBe(403)
    expect(ex.trace.decisions.filter((d) => d.outcome === 'pass')).toHaveLength(7)
    expect(ex.trace.decisions.at(-1)).toMatchObject({ id: 'backend', outcome: 'fail', basis: 'checked' })
  })

  it('the token never appears in a trace, only its shortened form', async () => {
    await toDoor()
    const raw = (await request(app).get('/api/flow/captured')).body.tokens.at(-1).raw
    expect(raw.split('.')).toHaveLength(3)
    const res = await run({ step: 'mcp-payouts' })
    const text = JSON.stringify(res.body.gatewayTrace)
    expect(text).not.toContain(raw)
    expect(text).not.toContain(raw.split('.')[2])
    expect(only(res).trace.request.headers.authorization).toMatch(/^Bearer eyJ.{0,20}… \(\d+ characters, shortened\)$/)
  })
})

describe('the simulated door itself', () => {
  it('checkDoor answers exactly what checkDoorDetailed.refusal says', async () => {
    const issuer = createIssuer()
    const doors = createDoors({ platformKeys: issuer.platformKeys, iss: issuer.ISSUER })
    for (const [d, tok, tool] of [['nope', 'x', 't'], ['meridian-payouts', 'x', 'query_account_payouts'], ['meridian-payouts', 'x', undefined]]) {
      expect(doors.checkDoor(d, tok, tool)).toEqual(doors.checkDoorDetailed(d, tok, tool).refusal)
    }
  })
})

// ---- Real: the lab POSTs to the live door; a fake door answers ------------------------------------------------------------------------
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const KEEP = ['MERIDIAN_MCP_DOOR_PAYOUTS_URL', 'MERIDIAN_PAYOUTS_CLIENT_ID', 'MERIDIAN_PINGONE_ENV_ID']

describe('real: the gateway answers with a status and a body, so no decision is checked', () => {
  const saved = {}
  let token
  beforeEach(() => {
    for (const k of KEEP) saved[k] = process.env[k]
    process.env.MERIDIAN_MCP_DOOR_PAYOUTS_URL = 'https://door.example/payouts/mcp'
    process.env.MERIDIAN_PAYOUTS_CLIENT_ID = 'fake-payouts-client'
    token = `${b64u({ alg: 'RS256' })}.${b64u({ scope: 'mp:payouts', client_id: 'fake-payouts-client', act: { sub: 'meridian-concierge' }, k: 'secret-claim-value' })}.${Buffer.from('fake-signature-bytes-0123456789').toString('base64url')}`
  })
  afterEach(() => { for (const k of KEEP) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  const flowWith = (reply) => {
    const calls = []
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return typeof reply === 'function' ? reply(url, init) : reply }
    return { flow: createRealFlow({ netguard: { fetchImpl } }), calls }
  }
  const call = (flow, extra = {}) => flow.runStep('mcp-payouts', { body: { door: 'meridian-payouts', token, tool: 'query_account_payouts', ...extra } })
  const reply = (status, body, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type, 'set-cookie': 'sid=should-not-appear', 'mcp-session-id': 'abcdef0123456789' } })

  it('200: exact request and response, every decision inferred, token shown by length only', async () => {
    const ok = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'payouts' }] } }
    const { flow, calls } = flowWith(reply(200, ok))
    const out = await call(flow)
    const ex = out.gatewayTrace[0]
    expect(assertTrace(ex.trace)).toEqual([])
    expect(ex.trace.source).toBe('real')
    expect(ex.trace.decisions.some((d) => d.basis === 'checked')).toBe(false)
    expect(ex.trace.decisions.map((d) => [d.id, d.outcome, d.basis])).toEqual([['authenticated', 'pass', 'inferred'], ['grant', 'pass', 'inferred']])
    expect(ex.trace.decisions[1].label).toBe('Delegation policy')
    expect(JSON.stringify(ex.trace.decisions)).not.toMatch(/tool|grant allows/i)
    // exact: the body that was sent is the body that is shown
    expect(ex.trace.request.body).toEqual(JSON.parse(calls[0].init.body))
    expect(ex.trace.request.url).toBe('https://door.example/payouts/mcp')
    expect(ex.trace.request.headers.accept).toBe(calls[0].init.headers.Accept)
    expect(ex.trace.response.body).toEqual(ok)
    expect(Object.keys(ex.trace.response.headers)).toEqual(['content-type'])
    expect(out.response).toEqual(ok)
    const text = JSON.stringify(out.gatewayTrace)
    expect(text).not.toContain(token)
    expect(text).not.toContain(token.split('.')[1])
    expect(text).not.toContain('secret-claim-value')
    expect(ex.trace.request.headers.authorization).toBe(`Bearer <token, ${token.length} characters, kept on the server>`)
  })

  it('401 and 403 are inferred, never checked, and name no check the gateway did not report', async () => {
    for (const [status, failing] of [[401, 'authenticated'], [403, 'grant']]) {
      const { flow } = flowWith(reply(status, { error: 'denied' }))
      const out = await call(flow)
      const t = out.gatewayTrace[0].trace
      expect(assertTrace(t)).toEqual([])
      expect(t.decisions.find((d) => d.outcome === 'fail').id).toBe(failing)
      expect(t.decisions.every((d) => d.basis !== 'checked')).toBe(true)
      expect(out.ok).toBe(false)
    }
  })

  it('an event-stream reply is shown whole in the trace, though the lab cannot parse it', async () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n\n'
    const { flow } = flowWith(reply(200, sse, 'text/event-stream'))
    const out = await call(flow)
    expect(out.response).toEqual({})
    expect(out.gatewayTrace[0].trace.response.body).toBe(sse)
    expect(assertTrace(out.gatewayTrace[0].trace)).toEqual([])
  })

  it('a reply that echoes the token has it scrubbed', async () => {
    const { flow } = flowWith(reply(403, { error: `bad ${token}` }))
    const out = await call(flow)
    expect(JSON.stringify(out.gatewayTrace)).not.toContain(token)
    expect(JSON.stringify(out.gatewayTrace)).toContain('<kept on the server>')
  })

  it('the door cannot be reached: a request, no response, one observed failure', async () => {
    const { flow } = flowWith(() => { throw new Error(`refused for ${token}`) })
    const out = await call(flow)
    expect(out.status).toBe(502)
    const t = out.gatewayTrace[0].trace
    expect(assertTrace(t)).toEqual([])
    expect(t.response).toBeNull()
    expect(t.decisions).toHaveLength(1)
    expect(t.decisions[0]).toMatchObject({ outcome: 'fail', basis: 'observed' })
    expect(JSON.stringify(t)).not.toContain(token)
  })

  it('the lab refuses first, or no door URL is set: nothing is sent, there is no trace, and a note says why', async () => {
    const { flow, calls } = flowWith(reply(200, {}))
    const refused = await call(flow, { tool: 'take_guest_payment' })
    expect(refused.refused.status).toBe(403)
    expect(refused.gatewayTrace).toBeUndefined()
    expect(refused.traceNote).toMatch(/before anything was sent/)
    delete process.env.MERIDIAN_MCP_DOOR_PAYOUTS_URL
    const local = await call(flow)
    expect(local.gatewayTrace).toBeUndefined()
    expect(local.traceNote).toMatch(/nothing was sent to the gateway/)
    expect(calls).toHaveLength(0)
  })
})
