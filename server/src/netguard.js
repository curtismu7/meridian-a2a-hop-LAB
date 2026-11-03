// The netguard: the one fetch this app is allowed to use. Every outbound request goes through fetchImpl().
//  - Mock mode: nothing leaves the process. Every request is refused before a socket opens and the real fetch is never called.
//  - Real mode (Phase 2): only the configured PingOne issuer and the Privilege doors may be reached, no redirects, time-capped.
// It counts attempts, so the self-test, the doctor and the tests can prove "zero".
export class NetguardRefused extends Error {}

export const LIVE_TIMEOUT_MS = 10_000

export function createNetguard({ mode, liveOrigins = () => [], realFetch = globalThis.fetch, timeoutMs = LIVE_TIMEOUT_MS }) {
  const stats = { realAttempts: 0, refused: 0 }
  const refuse = (why) => {
    stats.refused += 1
    throw new NetguardRefused(why)
  }

  async function fetchImpl(url, init = {}) {
    if (mode() !== 'real') refuse('Mock mode: no outbound calls')
    let target
    try {
      target = new URL(typeof url === 'string' ? url : url.url ?? String(url))
    } catch {
      return refuse('Not a URL')
    }
    const origins = liveOrigins()
    if (!origins.includes(target.origin)) refuse('Real mode: only the configured PingOne issuer and doors may be called')
    if (target.username || target.password) refuse('Outbound URLs must not carry credentials')
    stats.realAttempts += 1
    return realFetch(target.toString(), { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(timeoutMs) })
  }

  // Proves the guard holds without touching the network. Returns { ok, checks }; counters are restored.
  async function selfTest() {
    const before = { ...stats }
    const checks = []
    const refused = async (url) => {
      try {
        await fetchImpl(url, { method: 'GET' })
        return false
      } catch (e) {
        return e instanceof NetguardRefused
      }
    }
    checks.push({ name: 'a URL on another origin is refused', ok: await refused('https://other.invalid/') })
    checks.push({ name: 'mock mode refuses a loopback URL too', ok: mode() !== 'real' ? await refused('http://127.0.0.1:9/') : true })
    checks.push({ name: 'the real fetch was never called', ok: stats.realAttempts === before.realAttempts })
    Object.assign(stats, before)
    return { ok: checks.every((c) => c.ok), checks }
  }

  return { fetchImpl, selfTest, stats }
}
