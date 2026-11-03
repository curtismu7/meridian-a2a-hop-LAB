// Real-mode PingOne client. Every outbound call goes through the netguard's fetchImpl (mock mode refuses
// before a socket opens; real mode only reaches the configured PingOne auth host).
// Exchange shapes follow the MEASURED live runs (p1-third-party-exchange-LAB setup.md + this demo's live test).
import { createHash, randomBytes } from 'node:crypto'

function generateCodeVerifier() {
  return randomBytes(48).toString('base64url')
}

function formEncode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
}

export function createPingOne({ envId, fetchImpl, externalSigner }) {
  if (!envId) throw new Error('real mode needs MERIDIAN_PINGONE_ENV_ID')
  const authBase = `https://auth.pingone.com/${envId}`
  const liveOrigin = new URL(authBase).origin

  async function tokenEndpoint(form, basicAuth) {
    const res = await fetchImpl(`${authBase}/as/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: formEncode(form),
    })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
  }

  const basic = (id, secret) => Buffer.from(`${id}:${secret}`).toString('base64')

  // Person sign-in via pi.flow native: open the flow (PKCE), then the UI submits credentials through us.
  async function openFlow({ clientId, clientSecret, redirectUri, scope = 'openid mp:concierge', loginHint }) {
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      response_mode: 'pi.flow',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    if (loginHint) params.set('login_hint', loginHint)
    const res = await fetchImpl(`${authBase}/as/authorize?${params}`, { headers: { Accept: '*/*' } })
    const flow = await res.json().catch(() => null)
    const setCookies = res.headers?.getSetCookie?.() ?? []
    return { status: res.status, flow, cookies: setCookies, codeVerifier }
  }

  async function submitFlow({ flowId, cookies, body, contentType = 'application/json' }) {
    const res = await fetchImpl(`${authBase}/flows/${flowId}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Accept: '*/*', Cookie: cookies.join('; ') },
      body: JSON.stringify(body),
    })
    const flow = await res.json().catch(() => null)
    const setCookies = res.headers?.getSetCookie?.() ?? []
    return { status: res.status, flow, cookies: [...cookies, ...setCookies] }
  }

  async function resumeFlow({ flowId, cookies }) {
    const res = await fetchImpl(`${authBase}/as/resume?flowId=${flowId}`, {
      headers: { Accept: '*/*', Cookie: cookies.join('; ') },
    })
    const text = await res.text()
    let code = ''
    const ct = res.headers?.get('content-type') || ''
    if (ct.includes('json')) {
      try {
        code = JSON.parse(text)?.authorizeResponse?.code || ''
      } catch {
        /* fall through */
      }
    }
    if (!code && res.headers?.get('location')) {
      try {
        code = new URL(res.headers.get('location')).searchParams.get('code') || ''
      } catch {
        /* not a URL */
      }
    }
    return { status: res.status, code }
  }

  async function exchangeCode({ code, codeVerifier, redirectUri, clientId, clientSecret }) {
    return tokenEndpoint(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      },
      basic(clientId, clientSecret),
    )
  }

  // Third-party exchange (MEASURED live): third-party signed JWTs as subject AND actor; actor_token_type must be jwt.
  async function thirdPartyExchange({ clientId, clientSecret, subjectToken, actorToken, scope }) {
    return tokenEndpoint(
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        actor_token: actorToken,
        actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        scope,
      },
      basic(clientId, clientSecret),
    )
  }

  // Same-domain exchange (person -> specialist). PingOne scopes by the resource of the requested scope.
  // An optional third-party actor_token (jwt type) carries the act chain through the exchange (measured live).
  async function specialistExchange({ clientId, clientSecret, subjectToken, scope, actorToken }) {
    const form = {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope,
    }
    if (actorToken) {
      form.actor_token = actorToken
      form.actor_token_type = 'urn:ietf:params:oauth:token-type:jwt'
    }
    return tokenEndpoint(form, basic(clientId, clientSecret))
  }

  // Mint the external platform JWTs (the stub stands in for the real platform; same private key as the trusted issuer's JWKS).
  async function mintExternalTokens({ agentId = 'northbridge-runner-01', person = 'jordan.ellis', aud }) {
    if (!externalSigner) throw new Error('no external signer configured')
    return {
      subject: externalSigner({ sub: person, agent_id: agentId, aud }),
      actor: externalSigner({ sub: agentId, agent_id: agentId, aud }),
    }
  }

  return {
    authBase,
    liveOrigin,
    openFlow,
    submitFlow,
    resumeFlow,
    exchangeCode,
    thirdPartyExchange,
    specialistExchange,
    mintExternalTokens,
  }
}
