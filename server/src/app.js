import express from 'express'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '256kb' }))

  const mode = () => (process.env.DEMO_MODE === 'real' ? 'real' : 'mock')

  app.get('/api/health', (_req, res) => {
    res.json({ app: 'demo-health/1', state: 'ready', mode: mode() })
  })

  app.get('/api/info', (_req, res) => {
    res.json({
      app: 'meridian-a2a-hop',
      mode: mode(),
      realConfigured: false,
      banner:
        mode() === 'mock'
          ? 'Simulation: every issuer, door and tool on this page is local. Nothing leaves this machine.'
          : 'Real: exchanges hit your PingOne tenant; doors are the live Privilege gateway.',
    })
  })

  return app
}
