// The step flow: the demo's hops, in order, with the request template each one prefills.
// Placeholders like {basic:meridian-concierge} are filled by the server when it sends; the secret never reaches the page.
export const STEPS = [
  {
    id: 'sign-in',
    n: 1,
    title: 'Sign in',
    actors: ['Jordan', 'meridian-web'],
    blurb:
      'Jordan signs in to Meridian Pay. The journey authenticates the person and runs the access check; the access token says aud=meridian-web - only the Meridian web app identity accepts it at the concierge.',
    request: {
      method: 'POST',
      url: '{issuer}/as/token',
      headers: { Authorization: '{basic:meridian-web}', Accept: 'application/json' },
      body: { grant_type: 'password', username: '{person}', password: '{person_password}' },
    },
    refusals: [],
  },
  {
    id: 'external-agent',
    n: 2,
    title: 'External agent arrives',
    actors: ['Northbridge Agents', 'external agent'],
    blurb:
      'The platform-signed agent ({{cast.platform}}) presents its JWT. It is not from our issuer: trust was established once at the authorization server (issuer string + JWKS). This replaces registering an "Agent App" inside the platform.',
    request: {
      method: 'GET',
      url: '{issuer}/jwks-external',
      headers: { Accept: 'application/json' },
      body: null,
    },
    refusals: [
      {
        id: 'unknown-iss',
        label: 'Trust an issuer that was never registered',
        expected: 'refused: unknown issuer (no trusted-issuer row for it)',
      },
    ],
  },
  {
    id: 'third-party-exchange',
    n: 3,
    title: 'Third-party exchange: external agent -> domain token',
    actors: ['external agent', 'authorization server'],
    blurb:
      'The external agent exchanges: subject_token = the platform JWT, actor_token = the platform agent JWT (actor_token_type must be jwt - access_token is refused). Out comes a domain token with act.sub set to the agent identity.',
    request: {
      method: 'POST',
      url: '{issuer}/as/token',
      headers: { Authorization: '{basic:meridian-concierge}', Accept: 'application/json' },
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: '{external_subject_token}',
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        actor_token: '{external_actor_token}',
        actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'meridian-concierge',
        scope: 'mp:concierge',
      },
    },
    refusals: [
      {
        id: 'actor-token-type-access',
        label: "Send actor_token_type=access_token",
        expected: "refused: must be urn:ietf:params:oauth:token-type:jwt for a third-party actor token",
      },
      {
        id: 'no-actor-token',
        label: 'Omit the actor_token',
        expected: 'refused: actor_token is required for a third-party exchange',
      },
    ],
  },
  {
    id: 'concierge-decides',
    n: 4,
    title: 'Intent -> concierge decides',
    actors: ['Jordan', 'concierge', 'LLM'],
    blurb:
      'Carries {{cast.person}}\'s intent. The concierge decides which specialist handles it. In mock mode the router is deterministic; the Real-mode toggle hands the same decision to the LLM gateway.',
    request: {
      method: 'POST',
      url: '/api/flow/concierge-decide',
      headers: { Accept: 'application/json' },
      body: { intent: 'Show my recent payouts' },
    },
    refusals: [],
  },
  {
    id: 'exchange-payouts',
    n: 5,
    title: 'Exchange: concierge -> payouts',
    actors: ['concierge', 'authorization server'],
    blurb:
      "The concierge never hands the person's token onward. It exchanges it (its client secret) for one only Meridian Payouts accepts: RFC 8693 at the authorization server. Scope mp:payouts, aud meridian-payouts-rs, act.sub = meridian-concierge.",
    request: {
      method: 'POST',
      url: '{issuer}/as/token',
      headers: { Authorization: '{basic:meridian-concierge}', Accept: 'application/json' },
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: '{token:person}',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: 'meridian-payouts-rs',
        scope: 'mp:payouts',
      },
    },
    refusals: [
      {
        id: 'skip-concierge',
        label: "Skip the concierge: exchange the person's own token",
        expected: 'refused at the door next step: 401 (required act.sub, test H-4)',
      },
    ],
  },
  {
    id: 'mcp-payouts',
    n: 6,
    title: 'Token -> MCP: query_account_payouts',
    actors: ['payouts', 'Privilege door', 'payouts MCP'],
    blurb:
      "The exchanged token is presented to Meridian Payouts's Privilege door with the call its LLM chose: query_account_payouts (page size 5). The door checks the required claims; the MCP server checks the actor and scope every result.",
    request: {
      method: 'POST',
      url: '/api/flow/mcp-call',
      headers: { Accept: 'application/json' },
      body: {
        door: 'meridian-payouts',
        token: '{token:payouts}',
        tool: 'query_account_payouts',
        arguments: { pageSize: 5 },
      },
    },
    refusals: [
      {
        id: 'other-specialist-tool',
        label: "Another specialist's tool (take_guest_payment)",
        expected: 'refused: the policy lists only this specialist\'s tools (test H-5)',
      },
      {
        id: 'wrong-door',
        label: 'This token at another specialist\'s MCP endpoint (meridian-payments)',
        expected: 'refused: 403 (aud is not scoped for that door, test H-7)',
      },
    ],
  },
  {
    id: 'delegation-chain',
    n: 7,
    title: 'The delegation chain',
    actors: [],
    blurb: 'Every token, side by side: sub and act per hop, what each exchange changed.',
    request: null,
    refusals: [],
  },
]

export const stepById = (id) => STEPS.find((s) => s.id === id)
