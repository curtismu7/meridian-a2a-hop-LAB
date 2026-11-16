// "What Privilege did" for the payouts door (rule 25): turns the one door call (step mcp-payouts) into the record GatewayTrace.jsx draws,
// using the shared builder server/src/gatewayTrace.js (vendored byte for byte, never edited; trace.js would be the W3C helper, not this).
//
//   MOCK: the lab's own simulated door (stub-issuer/doors.mjs checkDoorDetailed) computed each check, in the order it ran them, so those
//   decisions are `checked`; a check after the first refusal never ran and is listed as not reached. The simulation has no JSON-RPC message:
//   the request it takes is the lab's own body ({door, tool, arguments}; the token rides as the Authorization line), shown as it is.
//   REAL: the lab POSTs a JSON-RPC call to the live door. The gateway answers with a status and a body, not a per-check breakdown, so every
//   decision is `inferred` or `observed`, never `checked`. A refusal the lab's own claim pre-check makes before any call, and the answer from
//   local backends when no door URL is set, send nothing to the gateway, so they have no trace (the page says so instead).
//   The wording avoids "tool grants": this is a call between agents (the concierge's delegated token to a specialist), so `grant` renames it.
//
// A trace never holds the token: the mock one is shortened, the PingOne one is shown only by its length.
import { bearerForDisplay, failureTrace, mockTrace, realTrace } from './gatewayTrace.js'

const GRANT = {
  label: 'Delegation policy',
  pass: 'the door let this delegated call through to the specialist agent',
  fail: 'the door\'s policy refused this delegated call (the reply does not say which of act.sub, audience, client or call it was)',
}

const NO_AUTH = '(none: the request carries no Authorization header)'
const TOKEN_NOTE = '<token>' // a placeholder that never equals the real token, so bearerForDisplay shows only a length

function scrub(value, secret) {
  if (typeof secret !== 'string' || secret.length < 8) return value
  const walk = (v) => {
    if (typeof v === 'string') return v.split(secret).join('<kept on the server>')
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value)
}

// ---- Mock -----------------------------------------------------------------------------------------------------------------------------
// detail: what doors.checkDoorDetailed returned. outcome: { status, body } the lab answered. extra: a further decision the simulation computed.
export function mockDoorExchange({ step, doorId, token, tool, args, detail, status, body, extra }) {
  const decisions = [...detail.checks]
  if (extra) decisions.push(extra)
  const trace = mockTrace({
    url: `https://mcpgw.meridian.invalid/${encodeURIComponent(doorId ?? '')}/mcp`,
    authorization: token ? bearerForDisplay(token) : NO_AUTH,
    rpc: { door: doorId, tool, arguments: args },
    status,
    body,
    requestHeaders: { accept: null }, // the in-process call sends no Accept
    decisions,
    record: `door=${doorId} tool=${tool} status=${status} ${decisions.filter((d) => d.outcome === 'fail').map((d) => d.id).join(',') || 'allowed'}`,
  })
  return { step: step.n, title: `Privilege door call: ${tool ?? 'no call named'}`, status, trace }
}

// ---- Real -----------------------------------------------------------------------------------------------------------------------------
const SHOWN_HEADERS = ['content-type', 'www-authenticate'] // an allowlist: the rest of a real reply's headers is never copied

const parse = (text) => {
  if (text === '') return null
  try { return JSON.parse(text) } catch { return text }
}

// rpc: the JSON-RPC message exactly as sent. res/text: the reply and its body text, read once.
export function realDoorExchange({ step, url, token, rpc, res, text }) {
  const headers = {}
  for (const name of SHOWN_HEADERS) if (res.headers.get(name) != null) headers[name] = scrub(res.headers.get(name), token)
  const body = scrub(parse(text), token)
  const trace = realTrace({
    url,
    authorization: bearerForDisplay(TOKEN_NOTE, () => token),
    rpc,
    status: res.status,
    headers,
    body,
    credential: 'workload-token',
    grant: GRANT,
    at: new Date().toISOString(),
  })
  return { step: step.n, title: `Privilege door call: ${rpc.params.name}`, status: res.status, trace }
}

// The door could not be reached (the netguard refused, the call timed out, the network failed).
export function failedDoorExchange({ step, url, token, rpc, error }) {
  const trace = failureTrace({ url, authorization: bearerForDisplay(TOKEN_NOTE, () => token), rpc, error: scrub(error?.message ?? String(error), token) })
  return { step: step.n, title: `Privilege door call: ${rpc.params.name}`, status: null, trace }
}
