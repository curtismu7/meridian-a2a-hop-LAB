// Run observability (rule 27), the lab's own half. The shared collector (runObservability.js, vendored byte for byte) is never edited.
//
//   1. createRunLog keeps the decisions THIS lab made on the current run (in memory) and writes each one as ONE timestamped stdout line:
//      actor and outcome, never a token. That line is what a collector can ship and the Real record can read back.
//   2. observeStep turns what a step actually returned into those decisions. Mock: from what the in-process issuer, door and backend
//      computed (doors.checkDoorDetailed via the gateway trace). Real: only what the lab holds as an API response (PingOne's answer, the
//      door's HTTP status). Nothing is added that the step did not compute or receive.
//   3. buildRunRecord hands them to the shared collector: Mock rows are `simulated`; Real rows are `response` plus whatever the
//      Elasticsearch reader finds `logged` (never invented, `not-logged` when absent).
//
// Wording of the stdout lines: `[<iso>] INFO: ...`. The family's MCP-server matchers (UNVERIFIED shape) read that prefix, so only the
// resource-layer lines use the words "served" / "refused"; every other layer's line avoids the words those matchers look for, so a line
// can never land on the wrong layer.
import { createRunObservability, readersFromEnv } from './runObservability.js'

const CAP = 200
const text = (v, n = 240) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, n)

export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = () => Date.now() } = {}) {
  let events = []
  let seq = 0

  function record(e) {
    const at = new Date(clock()).toISOString()
    const ev = { ...e, at, id: ++seq }
    events.push(ev)
    if (events.length > CAP) events = events.slice(-CAP)
    const level = ev.outcome === 'allowed' ? 'INFO' : 'WARN'
    write(`[${at}] ${level}: meridian-a2a-hop ${ev.line} actor=${text(ev.actor, 80) || 'unknown'} outcome=${ev.outcome} mode=${ev.source}`)
    return ev
  }

  return {
    record,
    forSource: (source) => events.filter((e) => e.source === source),
    reset: () => { events = [] },
  }
}

// ---- Step results -> decisions ---------------------------------------------------------------------------------------------------
const doorDecisions = (result) => result?.gatewayTrace?.[0]?.trace?.decisions ?? []

// who: { sub, actor } read from the newest captured token (a decoded claim set, never the token). Returns the events to record.
export function observeStep({ source, stepId, result, who = {} }) {
  const out = []
  const actor = who.actor || who.sub || 'unknown'
  const base = { source, actor, sub: who.sub }
  if (!result || typeof result !== 'object') return out

  if (stepId === 'sign-in' && source === 'mock' && typeof result.status === 'number') {
    const ok = result.status === 200
    out.push({ ...base, layer: 'person', outcome: ok ? 'allowed' : 'refused', product: 'lab mock issuer', actor: who.sub || 'unknown',
      line: `sign-in layer=person ${ok ? 'accepted' : 'rejected'}`,
      message: ok ? `Mock sign-in of ${text(who.sub, 60)}: the mock issuer issued a person token` : `Mock sign-in was rejected (HTTP ${result.status})`,
      detail: { status: result.status, ...(who.sub ? { sub: who.sub } : {}) } })
  }

  if ((stepId === 'third-party-exchange' || stepId === 'exchange-payouts') && typeof result.status === 'number' && !['no_person_token', 'no_payouts_token'].includes(result.response?.error)) {
    const ok = result.status < 400
    const what = stepId === 'third-party-exchange' ? 'external agent to a domain token' : 'concierge to the payouts specialist'
    const err = result.response?.error
    out.push({ ...base, layer: 'agent', outcome: ok ? 'allowed' : 'refused', product: source === 'mock' ? 'lab mock issuer' : 'PingOne token endpoint',
      line: `exchange layer=agent step=${stepId} ${ok ? 'issued' : 'rejected'}`,
      message: ok ? `Exchange ${what}: issued, acting for ${text(who.sub, 60)}` : `Exchange ${what} was rejected: ${text(err || `HTTP ${result.status}`, 120)}`,
      detail: { step: stepId, status: result.status, ...(err ? { error: err } : {}), ...(who.sub ? { sub: who.sub } : {}), ...(who.actor ? { act: who.actor } : {}) } })
  }

  if (stepId === 'mcp-payouts') {
    if (source === 'mock') {
      const decisions = doorDecisions(result)
      const failed = decisions.find((d) => d.outcome === 'fail')
      const doorFailed = failed && failed.id !== 'backend'
      const passed = decisions.filter((d) => d.outcome === 'pass').length
      if (doorFailed) {
        const status = result.refused?.status
        out.push({ ...base, layer: 'gateway', outcome: 'refused', product: 'lab mock Privilege door',
          line: `door layer=gateway verdict=deny check=${decisions.indexOf(failed) + 1} status=${status}`,
          message: `The mock door refused: check "${failed.id}" failed (HTTP ${status}, ${text(result.refused?.error, 60)})`,
          detail: { check: failed.id, status, error: result.refused?.error, checksPassed: passed } })
      } else if (decisions.length) {
        out.push({ ...base, layer: 'gateway', outcome: 'allowed', product: 'lab mock Privilege door',
          line: `door layer=gateway verdict=pass checks=${passed}`,
          message: `The mock door let the call through: ${passed} checks passed`,
          detail: { checksPassed: passed } })
        const tool = result.gatewayTrace?.[0]?.trace?.request?.body?.tool
        if (failed) {
          out.push({ ...base, layer: 'resource', outcome: 'refused', product: 'lab mock payouts backend',
            line: `tool ${text(tool, 60)} refused layer=resource`,
            message: `The payouts backend refused the call: ${text(failed.evidence, 160)}`,
            detail: { tool, status: result.refused?.status } })
        } else if (result.result?.status === 200) {
          const n = Array.isArray(result.result.payouts) ? result.result.payouts.length : 0
          out.push({ ...base, layer: 'resource', outcome: 'allowed', product: 'lab mock payouts backend',
            line: `tool ${text(tool, 60)} served layer=resource rows=${n}`,
            message: `The payouts backend served ${text(tool, 60)}: ${n} rows`,
            detail: { tool, rows: n } })
        }
      }
    } else {
      const ex = result.gatewayTrace?.[0]
      if (ex && typeof ex.status === 'number') {
        const ok = ex.status < 400
        const refusedStatus = ex.status === 401 || ex.status === 403
        out.push({ ...base, layer: 'gateway', outcome: ok ? 'allowed' : refusedStatus ? 'refused' : 'info', product: 'Privilege door reply',
          line: `door layer=gateway reply status=${ex.status}`,
          message: `The door replied HTTP ${ex.status}. This is the reply the lab received, not a gateway log line`,
          detail: { status: ex.status } })
      } else if (ex) {
        out.push({ ...base, layer: 'gateway', outcome: 'info', product: 'Privilege door reply',
          line: 'door layer=gateway reply none',
          message: 'The call to the door did not complete, so there is no reply to show',
          detail: {} })
      } else if (result.traceNote) {
        // The lab's own claim check, or the local-backends fallback: nothing reached the gateway, so no layer owns this decision.
        out.push({ ...base, layer: null, outcome: result.refused ? 'refused' : 'allowed', product: 'lab', line: 'lab check layer=none', message: text(result.traceNote, 280), detail: {} })
      }
    }
  }
  return out
}

// Real sign-in finishes in /api/flow/sign-in-submit (PingOne's answer), not in the step reply.
export function observeSignIn({ source, outcome, who = {} }) {
  if (source !== 'real') return []
  const ok = outcome?.ok === true
  return [{ source, sub: who.sub, actor: who.sub || 'unknown', layer: 'person', outcome: ok ? 'allowed' : 'refused', product: 'PingOne sign-in reply',
    line: `sign-in layer=person ${ok ? 'accepted' : 'rejected'}`,
    message: ok ? 'PingOne accepted the sign-in and the code exchange answered with a token. This is a reply the lab received, not an audit entry' : `PingOne did not complete the sign-in (HTTP ${outcome?.status ?? 'unknown'})`,
    detail: { status: outcome?.status } }]
}

// ---- The record ------------------------------------------------------------------------------------------------------------------
const NO_AUTHORIZE = 'This lab does not call PingOne Authorize, so there is no Authorize decision to show.'
const NO_PRIVILEGE_MOCK = "The lab mock has one simulated door that reports on the gateway layer; it has no separate Privilege policy, AI Guard or approval event."
const NOT_YET = {
  person: 'The sign-in step has not run in this mode yet.',
  agent: 'No token exchange has run in this mode yet.',
  gateway: 'The door step has not run in this mode yet.',
  resource: "The payouts backend was not reached on this run: the door step has not run, or the door refused first.",
}

const pick = (events, layer) => events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: e.product, outcome: e.outcome, message: e.message, detail: e.detail }))

export async function buildRunRecord({ source, events, who = {}, readers = readersFromEnv(), clock = () => Date.now() }) {
  const obs = createRunObservability({ readers, clock })
  const first = events[0]?.at
  const labNote = [...events].reverse().find((e) => e.layer === null)
  let layers
  if (source === 'mock') {
    layers = [
      { layer: 'person', simulated: pick(events, 'person'), reason: NOT_YET.person },
      { layer: 'agent', simulated: pick(events, 'agent'), reason: NOT_YET.agent },
      { layer: 'authorize', simulated: [], reason: NO_AUTHORIZE },
      { layer: 'privilege', simulated: [], reason: NO_PRIVILEGE_MOCK },
      { layer: 'gateway', simulated: pick(events, 'gateway'), reason: NOT_YET.gateway },
      { layer: 'resource', simulated: pick(events, 'resource'), reason: NOT_YET.resource },
    ]
  } else {
    layers = [
      { layer: 'person', products: [], responses: pick(events, 'person'), reason: 'PingOne sign-in is in the PingOne audit activity API, which this panel does not read yet. The reply the lab received is shown as a response row, never as logged.' },
      { layer: 'agent', products: ['privilege-gateway'], responses: pick(events, 'agent') },
      { layer: 'authorize', products: [], reason: NO_AUTHORIZE },
      { layer: 'privilege', products: ['privilege-siem', 'privilege-gateway'] },
      { layer: 'gateway', products: ['privilege-gateway'], responses: pick(events, 'gateway') },
      { layer: 'resource', products: ['mcp-server'] },
    ]
  }
  const record = await obs.collectRun({
    runId: `run-${Date.parse(first) || clock()}`,
    startedAt: first,
    endedAt: new Date(clock()).toISOString(),
    correlation: { sub: who.sub, actClientId: who.actor },
    layers,
    source,
  })
  // A decision the lab made before anything reached the gateway belongs to no layer: say so where the gateway would be.
  if (labNote && record.coverage.gateway !== 'response') {
    record.reasons.gateway = `${labNote.message} ${record.reasons.gateway ?? ''}`.trim()
  }
  return record
}
