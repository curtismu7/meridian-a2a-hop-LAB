// Real-mode flow: mirrors the mock step list, but every exchange hits real PingOne and every tool call
// goes through the live Privilege doors. The same step ids, the same refusal teaching points.
import { createPingOne } from '../pingone.js'
import { createDoors } from '../../../stub-issuer/doors.mjs' // reuse the same required-claims policy checks on real tokens
import { createKeys } from '../../../stub-issuer/keys.mjs'

const ISSUER = 'https://issuer.meridian.example' // only used to label mock tokens; real tokens carry PingOne iss

function decode(raw) {
  try {
    const [, p] = raw.split('.')
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function createRealFlow({ netguard }) {
  let pingone = null
  function getPingOne() {
    if (!pingone) {
      const envId = process.env.MERIDIAN_PINGONE_ENV_ID
      pingone = createPingOne({
        envId,
        fetchImpl: netguard.fetchImpl,
        externalSigner: realExternalSigner(),
      })
    }
    return pingone
  }
  // Real tokens come from PingOne (RS256) - we cannot verify them locally without the JWKS. For the demo
  // door checks we decode claims and enforce the policy rules (the gateway does cryptographic verification).
  const doors = createDoors({ platformKeys: localVerifierKeys(), iss: `https://auth.pingone.com/${process.env.MERIDIAN_PINGONE_ENV_ID || 'unset'}/as` })
  // In real mode client_id is the PingOne app UUID; map the door policy onto the live ids.
  const CLIENT_IDS = {
    'meridian-payouts': process.env.MERIDIAN_PAYOUTS_CLIENT_ID,
    'meridian-payments': process.env.MERIDIAN_PAYMENTS_CLIENT_ID,
    'meridian-concierge': process.env.MERIDIAN_CONCIERGE_CLIENT_ID,
  }
  for (const d of Object.values(doors.doors)) d.requiredClientId = CLIENT_IDS[d.requiredClientId] || d.requiredClientId
  // Patch verify to decode-only in real mode (signature verified by PingOne at issuance; doors re-verified live).
  doors.checkDoorReal = (doorId, token, tool) => checkDoorClaims(doors.doors[doorId], decode(token), tool)

  const captured = []
  const state = { tokens: {}, piFlow: null }

  function capture(label, raw) {
    const decoded = decode(raw)
    const prev = captured.at(-1)?.decoded
    const changed = []
    if (prev && decoded) {
      for (const k of ['sub', 'aud', 'scope', 'client_id']) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(decoded[k])) changed.push(k)
      }
      if (JSON.stringify(prev.act) !== JSON.stringify(decoded.act)) changed.push('act')
    }
    captured.push({ hop: captured.length + 1, label, raw, decoded, changed })
    return captured.at(-1)
  }

  function checkDoorClaims(door, p, tool) {
    if (!p) return { status: 401, error: 'invalid_token', reason: 'The token did not decode.' }
    if (!p.act || !p.act.sub) {
      // act.sub null is what PingOne issues when no actor rode the exchange (measured live) - same refusal.
      return {
        status: 401,
        error: 'missing_act_sub',
        reason: `Privilege requires act.sub on this door. A person's own token is refused: it checks the person, not the chain. (test H-4)`,
      }
    }
    const scopeName = door.tools.includes('query_account_payouts') ? 'mp:payouts' : 'mp:payments'
    const scopedOk = (p.scope || '').includes(scopeName)
    if (!scopedOk) {
      return {
        status: 403,
        error: 'insufficient_scope',
        reason: `This token is not scoped for this specialist's door (aud ${JSON.stringify(p.aud)}, scope ${p.scope || 'none'}). (test H-7)`,
      }
    }
    if (p.client_id !== door.requiredClientId) {
      return {
        status: 403,
        error: 'not_scoped_for_specialist',
        reason: `This token was issued to another client (client_id ${p.client_id ?? 'absent'}); the policy lists only ${door.requiredClientId}'s tools. (test H-3)`,
      }
    }
    if (tool && !door.tools.includes(tool)) {
      return {
        status: 403,
        error: 'tool_not_allowed',
        reason: `Privilege refuses: the policy lists only this specialist's tools, and ${tool} is not one. (test H-5)`,
      }
    }
    return null
  }

  async function runStep(stepId, overrides = {}) {
    const C = (n) => process.env[`MERIDIAN_${n}_CLIENT_ID`]
    const S = (n) => process.env[`MERIDIAN_${n}_CLIENT_SECRET`]

    if (stepId === 'sign-in') {
      // pi.flow native sign-in: open the flow and hand the UI its state. The UI collects credentials and
      // calls /api/flow/real/sign-in-submit, then resume+exchange happens server-side.
      const opened = await getPingOne().openFlow({
        clientId: C('WEB'),
        clientSecret: S('WEB'),
        redirectUri: process.env.MERIDIAN_WEB_REDIRECT_URI || 'http://127.0.0.1:6600/api/auth/callback',
        loginHint: 'jordan.ellis',
      })
      if (!opened.flow?.id) return { ok: false, step: stepId, status: opened.status, response: opened.flow }
      state.piFlow = { flowId: opened.flow.id, cookies: opened.cookies, codeVerifier: opened.codeVerifier }
      return { ok: true, step: stepId, piFlow: { id: opened.flow.id, status: opened.flow.status, _embedded: opened.flow._embedded } }
    }

    if (stepId === 'external-agent') {
      const { subject, actor } = await getPingOne().mintExternalTokens({ aud: process.env.MERIDIAN_RESOURCE_AUD || 'meridian-api' })
      state.externalSubjectToken = subject
      state.externalActorToken = actor
      return { ok: true, step: stepId, external: { subject, actor }, response: { note: 'Platform-signed JWTs minted; trusted issuer is registered in PingOne.' } }
    }

    if (stepId === 'third-party-exchange') {
      const res = await getPingOne().thirdPartyExchange({
        clientId: C('CONCIERGE'),
        clientSecret: S('CONCIERGE'),
        subjectToken: state.externalSubjectToken,
        actorToken: state.externalActorToken,
        scope: 'mp:concierge',
      })
      if (res.json.access_token) capture('Third-party exchange: external agent -> domain token', res.json.access_token)
      return { ok: res.status < 400, step: stepId, status: res.status, response: res.json }
    }

    if (stepId === 'concierge-decides') {
      // Same deterministic router (the Real LLM toggle is a v1.1 item); the decision inputs are the intent only.
      const { decide } = await import('./router.js')
      return { ok: true, step: stepId, decision: decide(overrides.intent ?? 'Show my recent payouts') }
    }

    if (stepId === 'exchange-payouts') {
      const person = state.tokens.person
      if (!person) return { ok: false, step: stepId, status: 400, response: { error: 'no_person_token', error_description: 'Sign in first.' } }
      // The third-party agent token rides as actor_token (jwt type): the resource's act attribute maps
      // actorToken.sub, so the specialist token carries act.sub = the external agent. (MEASURED live:
      // without an actor, PingOne issues act.sub = null.)
      const res = await getPingOne().specialistExchange({
        clientId: C('PAYOUTS'),
        clientSecret: S('PAYOUTS'),
        subjectToken: person,
        scope: 'mp:payouts',
        actorToken: state.externalActorToken, // third-party jwt: act.sub maps from its sub (measured live)
      })
      if (res.json.access_token) {
        state.tokens.payouts = res.json.access_token
        capture('Exchange: concierge -> payouts', res.json.access_token)
      }
      return { ok: res.status < 400, step: stepId, status: res.status, response: res.json }
    }

    if (stepId === 'mcp-payouts') {
      // Honor the same override shape as mock mode: overrides.body { door, token, tool } (the refusal chips use it).
      const body = overrides.body || {}
      const doorId = body.door || 'meridian-payouts'
      const token = body.token ? resolveTokenRef(body.token) : state.tokens.payouts
      if (!token) return { ok: false, step: stepId, status: 400, response: { error: 'no_payouts_token', error_description: 'Exchange for payouts first.' } }
      const doorCheck = doors.checkDoorReal(doorId, token, body.tool || overrides.tool || 'query_account_payouts')
      if (doorCheck) return { ok: true, step: stepId, refused: doorCheck }
      // Live door: POST the tools/call to the configured Privilege door URL. Until doors are registered,
      // return the tool result from the local backends and say so (honest banner covers mode).
      const doorUrl = process.env.MERIDIAN_MCP_DOOR_PAYOUTS_URL
      if (!doorUrl) {
        const { createBackends } = await import('../../../stub-issuer/backends.mjs')
        if (!state.backends) state.backends = createBackends()
        return { ok: true, step: stepId, result: { status: 200, payouts: state.backends.queryAccountPayouts(overrides.arguments || { pageSize: 5 }), via: 'local backends (doors not registered yet)' } }
      }
      const res = await netguard.fetchImpl(doorUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: overrides.tool || 'query_account_payouts', arguments: overrides.arguments || { pageSize: 5 } } }),
      })
      return { ok: res.status < 400, step: stepId, status: res.status, response: await res.json().catch(() => ({})) }
    }

    return { ok: false, status: 404, error: 'unknown_step' }
  }

  async function signInSubmit({ username, password }) {
    if (!state.piFlow) return { ok: false, error: 'no_flow' }
    const submit = await getPingOne().submitFlow({
      flowId: state.piFlow.flowId,
      cookies: state.piFlow.cookies,
      // The vendor content-type selects the credential-check action; plain application/json is refused.
      contentType: 'application/vnd.pingidentity.usernamePassword.check+json',
      body: { username, password },
    })
    const status = submit.flow?.status
    if (submit.status >= 400 || !status) {
      return { ok: false, status: submit.status, flow: submit.flow }
    }
    state.piFlow.cookies = submit.cookies
    state.piFlow.flowId = submit.flow?.id || state.piFlow.flowId
    if (status !== 'COMPLETED') {
      return { ok: true, flow: submit.flow, needsMore: true }
    }
    const resume = await getPingOne().resumeFlow({ flowId: state.piFlow.flowId, cookies: state.piFlow.cookies })
    if (!resume.code) return { ok: false, status: resume.status, error: 'no_code' }
    const C = (n) => process.env[`MERIDIAN_${n}_CLIENT_ID`]
    const S = (n) => process.env[`MERIDIAN_${n}_CLIENT_SECRET`]
    const exchanged = await getPingOne().exchangeCode({
      code: resume.code,
      codeVerifier: state.piFlow.codeVerifier,
      redirectUri: process.env.MERIDIAN_WEB_REDIRECT_URI || 'http://127.0.0.1:6600/api/auth/callback',
      clientId: C('WEB'),
      clientSecret: S('WEB'),
    })
    if (exchanged.json.access_token) {
      state.tokens.person = exchanged.json.access_token
      capture('Sign in', exchanged.json.access_token)
    }
    return { ok: exchanged.status < 400, status: exchanged.status, response: exchanged.json }
  }

  function resolveTokenRef(ref) {
    // '{token:person}' / '{token:payouts}' -> the captured token of that hop's key.
    const m = /^\{token:(\w+)\}$/.exec(ref || '')
    if (m) return state.tokens[m[1]] ?? null
    return ref || null
  }

  function reset() {
    captured.length = 0
    state.tokens = {}
    state.piFlow = null
    state.externalSubjectToken = null
    state.externalActorToken = null
  }

  return { runStep, signInSubmit, reset, get captured() { return captured } }
}

// The external signer: real mode signs with the SAME keypair registered as the trusted issuer's JWKS in PingOne
// (private key from the shared env, base64-encoded JWK).
import { createPrivateKey, sign } from 'node:crypto'

function realExternalSigner() {
  const b64 = process.env.MERIDIAN_EXTERNAL_PRIVATE_JWK_B64
  if (!b64) return null
  const jwk = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  return (payload) => {
    const key = createPrivateKey({ key: jwk, format: 'jwk' })
    const b64u = (b) => Buffer.from(b).toString('base64url')
    const header = { alg: 'ES256', typ: 'JWT', kid: jwk.kid }
    const now = Math.floor(Date.now() / 1000)
    const full = { iss: process.env.MERIDIAN_TRUSTED_ISSUER || 'https://agents.northbridge.example', iat: now, exp: now + 600, ...payload }
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(full))}`
    const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
    return `${input}.${b64u(sig)}`
  }
}

// Real-mode door checks decode claims (PingOne verified the signature at issuance; the real gateway re-verifies live).
function localVerifierKeys() {
  // keys.mjs verifyJwt needs a KeyObject; in real mode we never call it (checkDoorReal decodes only).
  return createKeys()
}
