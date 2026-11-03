import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

let app

beforeEach(() => {
  app = createApp()
})

const run = (body) => request(app).post('/api/flow/run').send(body)
const steps = () => request(app).get('/api/flow/steps')

async function signIn() {
  const res = await run({ step: 'sign-in' })
  expect(res.status).toBe(200)
  expect(res.body.ok).toBe(true)
  return res.body
}

async function mintExternal() {
  const res = await request(app).post('/api/flow/external-tokens').send()
  expect(res.status).toBe(200)
  return res.body
}

describe('flow steps list', () => {
  it('exposes the 7 steps in order', async () => {
    const res = await steps()
    expect(res.body.steps.map((s) => s.id)).toEqual([
      'sign-in',
      'external-agent',
      'third-party-exchange',
      'concierge-decides',
      'exchange-payouts',
      'mcp-payouts',
      'delegation-chain',
    ])
  })
})

describe('sign-in', () => {
  it('issues a person token with aud=meridian-web', async () => {
    await signIn()
    const cap = await request(app).get('/api/flow/captured')
    const first = cap.body.tokens.at(-1)
    expect(first.decoded.aud).toBe('meridian-web')
    expect(first.decoded.sub).toBe('jordan')
    expect(first.decoded.act).toBeUndefined()
  })
})

describe('third-party exchange (external agent)', () => {
  it('mints a domain token with act.sub set from the external agent', async () => {
    await signIn()
    const ext = await mintExternal()
    const res = await run({ step: 'third-party-exchange' })
    expect(res.body.status).toBe(200)
    const cap = await request(app).get('/api/flow/captured')
    const tok = cap.body.tokens.at(-1)
    expect(tok.decoded.act).toBeDefined()
    expect(tok.decoded.act.sub).toBe('northbridge-runner-01')
    expect(ext.subject).toMatch(/\./)
  })

  it('refuses actor_token_type=access_token (measured PingOne behavior)', async () => {
    await mintExternal()
    const res = await run({
      step: 'third-party-exchange',
      overrides: {
        request: {
          method: 'POST',
          url: '{issuer}/as/token',
          headers: { Authorization: '{basic:meridian-concierge}' },
          body: {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: '{external_subject_token}',
            subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
            actor_token: '{external_actor_token}',
            actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          },
        },
      },
    })
    expect(res.body.status).toBe(400)
    expect(res.body.response.error).toBe('invalid_request')
    expect(res.body.response.error_description).toMatch(/must be urn:ietf:params:oauth:token-type:jwt/)
  })

  it('refuses a missing actor_token', async () => {
    await mintExternal()
    const res = await run({
      step: 'third-party-exchange',
      overrides: {
        request: {
          method: 'POST',
          url: '{issuer}/as/token',
          headers: { Authorization: '{basic:meridian-concierge}' },
          body: {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: '{external_subject_token}',
            subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
          },
        },
      },
    })
    expect(res.body.status).toBe(400)
    expect(res.body.response.error_description).toMatch(/actor_token is required/)
  })

  it('refuses an unknown issuer (no trusted-issuer row)', async () => {
    // mint, then override the subject token with one from an untrusted iss
    await mintExternal()
    const res = await run({
      step: 'third-party-exchange',
      overrides: {
        request: {
          method: 'POST',
          url: '{issuer}/as/token',
          headers: { Authorization: '{basic:meridian-concierge}' },
          body: {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: 'header.' + Buffer.from(JSON.stringify({ iss: 'https://evil.example', sub: 'jordan' })).toString('base64url') + '.sig',
            subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
            actor_token: 'x',
            actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
          },
        },
      },
    })
    expect(res.body.status).toBe(400)
    expect(res.body.response.error_description).toMatch(/Unknown issuer/)
  })
})

describe('concierge decision', () => {
  it('routes payouts intents to the payouts specialist', async () => {
    const res = await run({ step: 'concierge-decides', overrides: { intent: 'Show my recent payouts' } })
    expect(res.body.decision.specialist).toBe('meridian-payouts')
    expect(res.body.decision.tool).toBe('query_account_payouts')
  })
})

describe('specialist exchange + MCP door', () => {
  async function fullFlowToDoor() {
    await signIn()
    await mintExternal()
    await run({ step: 'third-party-exchange' })
    await run({ step: 'concierge-decides', overrides: { intent: 'Show my recent payouts' } })
    const ex = await run({ step: 'exchange-payouts' })
    expect(ex.body.status).toBe(200)
    return ex
  }

  it('exchanges for a payouts token with act.sub=meridian-concierge', async () => {
    await fullFlowToDoor()
    const cap = await request(app).get('/api/flow/captured')
    const tok = cap.body.tokens.at(-1)
    expect(tok.decoded.aud).toBe('meridian-payouts-rs')
    expect(tok.decoded.scope).toBe('mp:payouts')
    expect(tok.decoded.act.sub).toBe('meridian-concierge')
    expect(tok.changed).toContain('aud')
    expect(tok.changed).toContain('act')
  })

  it('the payouts door allows query_account_payouts and returns payouts', async () => {
    await fullFlowToDoor()
    const res = await run({ step: 'mcp-payouts' })
    expect(res.body.refused).toBeUndefined()
    expect(res.body.result.status).toBe(200)
    expect(res.body.result.payouts.length).toBeGreaterThan(0)
    expect(res.body.result.payouts[0].payoutId).toMatch(/^po_/)
  })

  it('refuses another specialist\'s tool (H-5)', async () => {
    await fullFlowToDoor()
    const res = await run({
      step: 'mcp-payouts',
      overrides: { body: { door: 'meridian-payouts', token: '{token:payouts}', tool: 'take_guest_payment', arguments: {} } },
    })
    expect(res.body.refused.status).toBe(403)
    expect(res.body.refused.reason).toMatch(/only this specialist's tools/)
  })

  it('refuses the payouts token at the payments door (H-7)', async () => {
    await fullFlowToDoor()
    const res = await run({
      step: 'mcp-payouts',
      overrides: { body: { door: 'meridian-payments', token: '{token:payouts}', tool: 'take_guest_payment', arguments: {} } },
    })
    expect(res.body.refused.status).toBe(403)
    expect(res.body.refused.reason).toMatch(/not scoped for this specialist/)
  })

  it('refuses a person token with no act.sub (H-4)', async () => {
    await signIn()
    const res = await run({
      step: 'mcp-payouts',
      overrides: { body: { door: 'meridian-payouts', token: '{token:person}', tool: 'query_account_payouts', arguments: {} } },
    })
    expect(res.body.refused.status).toBe(401)
    expect(res.body.refused.reason).toMatch(/act\.sub/)
  })
})

describe('reset', () => {
  it('clears captured tokens', async () => {
    await signIn()
    await request(app).post('/api/flow/reset').send()
    const cap = await request(app).get('/api/flow/captured')
    expect(cap.body.tokens).toHaveLength(0)
  })
})
