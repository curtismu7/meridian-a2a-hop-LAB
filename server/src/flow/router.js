// The deterministic concierge router (mock). Same decision every time, fully scriptable.
// The Real-mode LLM toggle (Phase 2) hands the same decision to the Privilege LLM gateway.
const RULES = [
  { match: /payout/i, specialist: 'meridian-payouts', tool: 'query_account_payouts', say: 'Recent payouts live in the payouts domain; the payouts specialist owns that door.' },
  { match: /payment|pay someone|charge/i, specialist: 'meridian-payments', tool: 'take_guest_payment', say: 'Making or taking a payment is the payments specialist.' },
  { match: /balance|account/i, specialist: 'meridian-payouts', tool: 'query_account_payouts', say: 'Account questions resolve to payout records; the payouts specialist reads them.' },
]

export function decide(intent) {
  const rule = RULES.find((r) => r.match.test(String(intent || '')))
  if (!rule) {
    return { specialist: null, tool: null, say: 'No specialist covers that intent; the concierge asks the person to rephrase.', matched: false }
  }
  return { specialist: rule.specialist, tool: rule.tool, say: rule.say, matched: true }
}
