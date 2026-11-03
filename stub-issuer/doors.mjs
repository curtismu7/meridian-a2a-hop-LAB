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

  // Returns null (allowed) or { status, error, reason } - the refusal matrix.
  function checkDoor(doorId, token, tool) {
    const door = doors[doorId]
    if (!door) return { status: 404, error: 'unknown_door', reason: `No door named ${doorId}.` }

    const v = verify(token)
    if (!v.ok) {
      return { status: 401, error: 'invalid_token', reason: 'The token signature or issuer did not verify at the door.' }
    }
    const p = v.payload

    // H-4: a person's own token has no act at all - the door checks the chain, not just the person.
    // H-7: a specialist token (act present) at the wrong door fails on aud, not act.
    if (!p.act) {
      return {
        status: 401,
        error: 'missing_act_sub',
        reason: `Privilege requires act.sub = ${door.requiredActSub} on this door. A person's own token is refused: it checks the person, not the chain. (test H-4)`,
      }
    }
    if (p.aud !== door.tokenAudience) {
      return {
        status: 403,
        error: 'insufficient_scope',
        reason: `This token is not scoped for this specialist's MCP endpoint (aud says ${p.aud ?? 'nothing'}, the door wants ${door.tokenAudience}). (test H-7)`,
      }
    }
    if (p.act.sub !== door.requiredActSub) {
      return {
        status: 401,
        error: 'missing_act_sub',
        reason: `Privilege requires act.sub = ${door.requiredActSub} on this door. A person's own token is refused: it checks the person, not the chain. (test H-4)`,
      }
    }
    if (p.client_id !== door.requiredClientId) {
      return {
        status: 403,
        error: 'not_scoped_for_specialist',
        reason: `This token was loaded for another specialist (client_id ${p.client_id ?? 'absent'}); the policy lists only ${door.requiredClientId}'s tools. (test H-3)`,
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

  return { doors, checkDoor }
}
