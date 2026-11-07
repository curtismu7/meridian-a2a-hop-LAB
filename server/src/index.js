import { createApp } from './app.js'

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
