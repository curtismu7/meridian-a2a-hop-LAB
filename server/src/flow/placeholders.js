// Server-side placeholder resolution. Secrets are write-only: the page sees {basic:meridian-concierge};
// the server fills it when it sends. Only the resolved request leaves the process.
const CLIENT_SECRETS = {
  'meridian-web': () => process.env.MERIDIAN_WEB_CLIENT_SECRET || 'mock-web-secret',
  'meridian-concierge': () => process.env.MERIDIAN_CONCIERGE_CLIENT_SECRET || 'mock-concierge-secret',
  'meridian-payouts': () => process.env.MERIDIAN_PAYOUTS_CLIENT_SECRET || 'mock-payouts-secret',
  'meridian-payments': () => process.env.MERIDIAN_PAYMENTS_CLIENT_SECRET || 'mock-payments-secret',
}

export function resolvePlaceholders(value, ctx = {}) {
  if (typeof value === 'string') {
    return value.replace(/\{(basic|person|person_password|external_subject_token|external_actor_token|issuer|token):?([a-z-]*)\}/g, (_, kind, arg) => {
      switch (kind) {
        case 'issuer':
          return ctx.issuer ?? 'https://issuer.meridian.example'
        case 'person':
          return ctx.person ?? 'jordan'
        case 'person_password':
          return ctx.personPassword ?? 'demo-only'
        case 'external_subject_token':
          return ctx.externalSubjectToken ?? ''
        case 'external_actor_token':
          return ctx.externalActorToken ?? ''
        case 'token':
          return ctx.tokens?.[arg] ?? ''
        case 'basic': {
          const secret = CLIENT_SECRETS[arg]?.() ?? ''
          return `Basic ${Buffer.from(`${arg}:${secret}`).toString('base64')}`
        }
        default:
          return _
      }
    })
  }
  if (Array.isArray(value)) return value.map((v) => resolvePlaceholders(v, ctx))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePlaceholders(v, ctx)]))
  }
  return value
}
