import { readFileSync } from 'node:fs'
import { createApp } from './app.js'

// The shared-env overlay (docker-compose.shared-env.yml) mounts the one shared settings
// file at STANDALONE_ENV; this loader reads only the keys this app allows (MERIDIAN_*,
// DEMO_MODE) and never overrides real environment variables.
const ALLOWED = /^(MERIDIAN_[A-Z0-9_]+|DEMO_MODE)$/;
if (process.env.STANDALONE_ENV) {
  try {
    for (const line of readFileSync(process.env.STANDALONE_ENV, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || !ALLOWED.test(m[1]) || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch (e) {
    console.error(`Could not read the shared settings file at ${process.env.STANDALONE_ENV}: ${e.message}`)
  }
}

const host = process.env.HOST || '127.0.0.1'
if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(host)) {
  console.error(`Refusing to bind ${host}: this app is loopback-only (standalone rules).`)
  process.exit(1)
}

const port = Number(process.env.PORT || 7720)
createApp().listen(port, host, () => {
  const mode = process.env.DEMO_MODE === 'real' ? 'real' : 'mock'
  console.log(`meridian-a2a-hop listening on http://127.0.0.1:${port} (mode: ${mode})`)
})
