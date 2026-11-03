// Client for the flow API.
const base = ''

async function jfetch(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...opts,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

export const api = {
  info: () => jfetch('/api/info'),
  steps: () => jfetch('/api/flow/steps'),
  captured: () => jfetch('/api/flow/captured'),
  reset: () => jfetch('/api/flow/reset', { method: 'POST' }),
  mintExternal: () => jfetch('/api/flow/external-tokens', { method: 'POST' }),
  run: (step, overrides) => jfetch('/api/flow/run', { method: 'POST', body: JSON.stringify({ step, overrides }) }),
  switchMode: (mode) => jfetch('/api/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
}
