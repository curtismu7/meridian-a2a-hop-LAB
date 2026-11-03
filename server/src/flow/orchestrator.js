// The flow orchestrator: runs a step's request server-side, captures the token, decodes it,
// and records what changed vs the previous hop. In mock mode the "issuer" is in-process;
// no socket opens (the netguard proves it).
import { createIssuer } from '../../../stub-issuer/issuer.mjs'
import { createDoors } from '../../../stub-issuer/doors.mjs'
import { createBackends } from '../../../stub-issuer/backends.mjs'
import { resolvePlaceholders } from './placeholders.js'
import { decide } from './router.js'
import { STEPS, stepById } from './steps.js'

export function createFlow() {
  const issuer = createIssuer()
  const doors = createDoors({ platformKeys: issuer.platformKeys, iss: issuer.ISSUER })
  const backends = createBackends()

  // Captured tokens, in hop order. Each: { hop, label, raw, decoded, changed }.
  const captured = []
  const state = {}

  function decode(raw) {
    try {
      const [, p] = raw.split('.')
      return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    } catch {
      return null
    }
  }

  function capture(label, raw) {
    const decoded = decode(raw)
    const prev = captured[captured.length - 1]?.decoded
    const changed = []
    if (prev && decoded) {
      for (const k of ['sub', 'aud', 'scope', 'client_id']) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(decoded[k])) changed.push(k)
      }
      if (JSON.stringify(prev.act) !== JSON.stringify(decoded.act)) changed.push('act')
    }
    captured.push({ hop: captured.length + 1, label, raw, decoded, changed })
    return captured[captured.length - 1]
  }

  async function sendJson({ method, url, headers, body }) {
    // Mock mode: the only URLs are the in-process issuer routes and internal flow routes. No fetch.
    if (url.endsWith('/as/token')) return tokenEndpoint(body, headers)
    if (url.endsWith('/jwks-external')) return { status: 200, json: issuer.externalJwks }
    return { status: 404, json: { error: 'unknown route' } }
  }

  async function tokenEndpoint(form, headers) {
    const grant = form.grant_type
    if (grant === 'urn:ietf:params:oauth:grant-type:token-exchange') {
      return exchange(form, headers)
    }
    if (grant === 'password') {
      const at = await issuer.issueAccessToken({
        sub: form.username || 'jordan',
        client_id: 'meridian-web',
        aud: 'meridian-web',
        scope: 'openid mp:concierge',
      })
      return { status: 200, json: { access_token: at, token_type: 'Bearer', expires_in: 300 } }
    }
    return { status: 400, json: { error: 'unsupported_grant_type' } }
  }

  async function exchange(form, _headers) {
    const isThirdParty = form.subject_token_type === 'urn:ietf:params:oauth:token-type:jwt'
    if (isThirdParty) {
      const problem = issuer.validateThirdPartyExchange(form)
      if (problem) return { status: problem.status, json: { error: problem.error, error_description: problem.error_description } }
      // Registry check: the issuer string must be a trusted issuer row.
      const decodedExt = decode(form.subject_token)
      if (!decodedExt || !issuer.trustedIssuers.has(decodedExt.iss)) {
        return { status: 400, json: { error: 'invalid_grant', error_description: 'Unknown issuer: no trusted-issuer row for it.' } }
      }
      const decodedActor = decode(form.actor_token)
      const at = await issuer.issueAccessToken({
        sub: decodedExt.sub,
        client_id: 'meridian-concierge',
        aud: form.audience || 'meridian-concierge',
        scope: form.scope || '',
        act_sub: decodedActor?.agent_id || 'external-agent',
        act_client_id: decodedExt.iss,
      })
      return { status: 200, json: { access_token: at, token_type: 'Bearer', expires_in: 300, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token' } }
    }
    // Same-domain exchange (concierge -> specialist).
    const decoded = decode(form.subject_token)
    if (!decoded) return { status: 400, json: { error: 'invalid_grant', error_description: 'subject_token did not decode.' } }
    const audienceMap = { 'meridian-payouts-rs': 'meridian-payouts', 'meridian-payments-rs': 'meridian-payments' }
    const clientForAud = audienceMap[form.audience]
    if (!clientForAud) return { status: 400, json: { error: 'invalid_target', error_description: `Unknown audience ${form.audience}.` } }
    const at = await issuer.issueAccessToken({
      sub: decoded.sub,
      client_id: clientForAud,
      aud: form.audience,
      scope: form.scope || '',
      act_sub: 'meridian-concierge',
      act_client_id: 'meridian-concierge',
    })
    return { status: 200, json: { access_token: at, token_type: 'Bearer', expires_in: 300, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token' } }
  }

  // Run one step: fill placeholders, send, capture tokens. Returns everything the UI renders.
  async function runStep(stepId, overrides = {}, ws = {}) {
    const step = stepById(stepId)
    if (!step) return { ok: false, status: 404, error: 'unknown_step' }

    if (stepId === 'concierge-decides') {
      const decision = decide(overrides.intent ?? 'Show my recent payouts')
      return { ok: true, step: stepId, decision }
    }

    if (stepId === 'external-agent') {
      // The external agent presents its platform-signed JWTs: mint them (stub for the real platform's key)
      // and stash them so the next hop's placeholders {external_subject_token}/{external_actor_token} resolve.
      if (!state.externalSubjectToken) await mintExternalTokens()
      const req = resolvePlaceholders({ ...step.request, ...overrides.request }, ctx())
      const res = await sendJson(req)
      return { ok: res.status < 400, step: stepId, status: res.status, response: res.json, request: req, external: { subject: state.externalSubjectToken, actor: state.externalActorToken } }
    }

    if (stepId === 'mcp-payouts') {
      const body = resolvePlaceholders(overrides.body ?? step.request.body, { ...ctx(), tokens: state.tokens ?? {} })
      const doorCheck = await doors.checkDoor(body.door, body.token, body.tool)
      if (doorCheck) return { ok: true, step: stepId, refused: doorCheck }
      if (body.tool === 'query_account_payouts') {
        return { ok: true, step: stepId, result: { status: 200, payouts: backends.queryAccountPayouts(body.arguments) } }
      }
      return { ok: true, step: stepId, refused: { status: 403, error: 'tool_not_allowed', reason: `The policy lists only this specialist's tools, and ${body.tool} is not one.` } }
    }

    const req = resolvePlaceholders({ ...step.request, ...overrides.request }, { ...ctx(), tokens: state.tokens ?? {} })
    const res = await sendJson(req)

    if (res.status === 200 && res.json?.access_token) {
      const tokenKey = stepId === 'sign-in' ? 'person' : stepId === 'third-party-exchange' ? 'concierge' : 'payouts'
      state.tokens = { ...(state.tokens ?? {}), [tokenKey]: res.json.access_token }
      capture(step.title, res.json.access_token)
    }
    return { ok: res.status < 400, step: stepId, status: res.status, response: res.json, request: req }
  }

  function ctx() {
    return {
      issuer: issuer.ISSUER,
      externalSubjectToken: state.externalSubjectToken,
      externalActorToken: state.externalActorToken,
    }
  }

  function setExternalTokens({ subject, actor }) {
    state.externalSubjectToken = subject
    state.externalActorToken = actor
  }

  async function mintExternalTokens() {
    const subject = await issuer.issueExternalToken({ sub: 'jordan', agent_id: 'northbridge-runner-01', aud: 'meridian-concierge' })
    const actor = await issuer.issueExternalToken({ sub: 'northbridge-runner-01', agent_id: 'northbridge-runner-01', aud: 'meridian-concierge' })
    setExternalTokens({ subject, actor })
    return { subject, actor }
  }

  function reset() {
    captured.length = 0
    for (const k of Object.keys(state)) delete state[k]
    backends.reset()
  }

  return { STEPS, runStep, mintExternalTokens, reset, get captured() { return captured }, issuer, doors, backends }
}
