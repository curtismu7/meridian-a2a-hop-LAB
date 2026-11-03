// Stories (rule 10): the demo story beats, with {{cast.*}} tokens filled at render time.
export const stories = [
  {
    id: 'S01',
    title: '{{cast.person}} asks {{cast.agent}} about payouts',
    say: 'The person never sees a token. The agent holds it, and every hop it makes is checked.',
  },
  {
    id: 'S02',
    title: 'An external agent from {{cast.platform}} joins',
    say: 'The platform-signed agent is outside the trust domain. Trust is established once at the authorization server, not by registering an app.',
  },
  {
    id: 'S03',
    title: 'The concierge exchanges, not passes',
    say: 'A specialist gets its own token, scoped to its own door. The person token never reaches the tools.',
  },
]

export function fillStories(list) {
  return list.map((s) => ({ ...s, title: fillCast(s.title), say: fillCast(s.say) }))
}
