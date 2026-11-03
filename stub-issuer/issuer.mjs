// The stub issuer: a mock PingOne. Two keypairs, one registry.
//  - Keypair 1 ("platform"): signs the domain tokens the demo exchanges between clients.
//  - Keypair 2 ("external"): the third-party platform's key. Its tokens are NEVER issued by us; they arrive
//    as subject_token/actor_token and are verified against the trusted-issuer registry (issuer string + JWKS).
// The /as/token error table mirrors the MEASURED PingOne third-party exchange behavior (p1-third-party-exchange-LAB).
import { createKeys, signJwt } from './keys.mjs'

const EXTERNAL_ISS = 'https://agents.northbridge.example'

export function createIssuer({ now = () => Math.floor(Date.now() / 1000) } = {}) {
  const platform = createKeys()
  const external = createKeys()
  const ISSUER = 'https://issuer.meridian.example'

  const trustedIssuers = new Map([[EXTERNAL_ISS, { jwks: external.jwks, name: 'Northbridge Agents' }]])

  // Issue a domain access token (what the platform's own clients get).
  function issueAccessToken({ sub, client_id, aud, scope, act_sub, act_client_id }) {
    const claims = { sub, client_id, aud, scope }
    if (act_sub) claims.act = { sub: act_sub, ...(act_client_id ? { client_id: act_client_id } : {}) }
    return signJwt(claims, platform, ISSUER)
  }

  // Issue a third-party (platform-signed) token. The external keypair stands in for the real platform's key.
  function issueExternalToken({ sub, iss = EXTERNAL_ISS, aud, agent_id }) {
    return signJwt({ sub, agent_id, aud }, external, iss)
  }

  // The error table: exactly the refusals the demo teaches. Returns null or { error, error_description, status }.
  function validateThirdPartyExchange({ actor_token, actor_token_type }) {
    if (!actor_token) {
      return { status: 400, error: 'invalid_request', error_description: 'actor_token is required for a third-party exchange.' }
    }
    if (actor_token_type === 'urn:ietf:params:oauth:token-type:access_token') {
      return {
        status: 400,
        error: 'invalid_request',
        error_description:
          'actor_token_type must be urn:ietf:params:oauth:token-type:jwt for a third-party actor token; access_token is refused.',
      }
    }
    if (actor_token_type !== 'urn:ietf:params:oauth:token-type:jwt') {
      return { status: 400, error: 'invalid_request', error_description: 'actor_token_type must be urn:ietf:params:oauth:token-type:jwt.' }
    }
    return null
  }

  return {
    ISSUER,
    platformJwks: platform.jwks,
    platformKeys: platform,
    externalJwks: external.jwks,
    trustedIssuers,
    issueAccessToken,
    issueExternalToken,
    validateThirdPartyExchange,
    jwksFor: (iss) => trustedIssuers.get(iss)?.jwks ?? null,
  }
}
