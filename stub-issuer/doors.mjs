// Mock privilege door: the one entry to the tools. Validates the bearer like the gateway does:
// signature (against the platform key), issuer, audience, required claims (act.sub, client_id), then
// the per-door tool policy. Refusal texts match the demo's refusal matrix.
import { verifyJwt } from './keys.mjs'

export function createDoors({ platformKeys, iss }) {
  const doors = {
    'meridian-payouts': {
      audience: 'https://mcpgw.meridian.example/meridian-payouts/mcp',
      tokenAudience: 'meridian-payouts-rs',
      requiredActSub: 'meridian-concierge',
      requiredClientId: 'meridian-payouts',
      tools: ['query_account_payouts'],
    },
    'meridian-payments': {
      audience: 'https://mcpgw.meridian.example/meridian-payments/mcp',
      tokenAudience: 'meridian-payments-rs',
      requiredActSub: 'meridian-concierge',
      requiredClientId: 'meridian-payments',
      tools: ['take_guest_payment'],
    },
  }

  function verify(token) {
    try {
      const payload = verifyJwt(token, platformKeys)
      if (payload.iss !== iss) return { ok: false, code: 'bad_issuer' }
      return { ok: true, payload }
    } catch (e) {
      return { ok: false, code: e.code || 'bad_token' }
    }
  }

  // The checks in the order they run. checkDoorDetailed returns the list with each check's outcome (a check after the
  // first refusal never ran: 'skipped'), so the "What Privilege did" panel can show what this simulated door computed.
  const CHECKS = [
    ['door', 'Door exists'],
    ['token', 'Token verifies (signature and issuer)'],
    ['act', 'Actor chain present (act)'],
    ['aud', 'Audience matches this door'],
    ['act-sub', 'act.sub is the concierge'],
    ['client', "client_id is this specialist's"],
    ['tool', "Tool is in this door's policy"],
  ]

  // Returns { refusal, checks }: refusal is null (allowed) or { status, error, reason } - the refusal matrix.
  function checkDoorDetailed(doorId, token, tool) {
    const checks = []
    const pass = (id, evidence) => checks.push({ id, label: CHECKS.find(([i]) => i === id)[1], outcome: 'pass', evidence })
    const refuse = (id, refusal) => {
      checks.push({ id, label: CHECKS.find(([i]) => i === id)[1], outcome: 'fail', evidence: refusal.reason })
      for (const [sid, label] of CHECKS) if (!checks.some((c) => c.id === sid)) checks.push({ id: sid, label, outcome: 'skipped', evidence: 'not reached: an earlier check refused' })
      return { refusal, checks }
    }
    const door = doors[doorId]
    if (!door) return refuse('door', { status: 404, error: 'unknown_door', reason: `No door named ${doorId}.` })
    pass('door', `${doorId} is a registered door`)

    const v = verify(token)
    if (!v.ok) {
      return refuse('token', { status: 401, error: 'invalid_token', reason: 'The token signature or issuer did not verify at the door.' })
    }
    pass('token', 'the signature verified against the platform key and the issuer matched')
    const p = v.payload

    // H-4: a person's own token has no act at all - the door checks the chain, not just the person.
    // H-7: a specialist token (act present) at the wrong door fails on aud, not act.
    if (!p.act) {
      return refuse('act', {
        status: 401,
        error: 'missing_act_sub',
        reason: `Privilege requires act.sub = ${door.requiredActSub} on this door. A person's own token is refused: it checks the person, not the chain. (test H-4)`,
      })
    }
    pass('act', 'the token carries an act claim')
    if (p.aud !== door.tokenAudience) {
      return refuse('aud', {
        status: 403,
        error: 'insufficient_scope',
        reason: `This token is not scoped for this specialist's MCP endpoint (aud says ${p.aud ?? 'nothing'}, the door wants ${door.tokenAudience}). (test H-7)`,
      })
    }
    pass('aud', `aud is ${door.tokenAudience}`)
    if (p.act.sub !== door.requiredActSub) {
      return refuse('act-sub', {
        status: 401,
        error: 'missing_act_sub',
        reason: `Privilege requires act.sub = ${door.requiredActSub} on this door. A person's own token is refused: it checks the person, not the chain. (test H-4)`,
      })
    }
    pass('act-sub', `act.sub is ${door.requiredActSub}`)
    if (p.client_id !== door.requiredClientId) {
      return refuse('client', {
        status: 403,
        error: 'not_scoped_for_specialist',
        reason: `This token was loaded for another specialist (client_id ${p.client_id ?? 'absent'}); the policy lists only ${door.requiredClientId}'s tools. (test H-3)`,
      })
    }
    pass('client', `client_id is ${door.requiredClientId}`)
    if (tool && !door.tools.includes(tool)) {
      return refuse('tool', {
        status: 403,
        error: 'tool_not_allowed',
        reason: `Privilege refuses: the policy lists only this specialist's tools, and ${tool} is not one. (test H-5)`,
      })
    }
    pass('tool', tool ? `${tool} is in this door's policy` : 'no tool named, nothing to check')
    return { refusal: null, checks }
  }

  // Returns null (allowed) or { status, error, reason } - the refusal matrix.
  const checkDoor = (doorId, token, tool) => checkDoorDetailed(doorId, token, tool).refusal

  return { doors, checkDoor, checkDoorDetailed }
}
