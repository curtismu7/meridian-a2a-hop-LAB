import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createNetguard } from './netguard.js'
import { createWorkspaces, DEFAULT_WORKSPACE, WORKSPACE_HEADER } from './workspaces.js'
import { createFlow } from './flow/orchestrator.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '256kb' }))

  const mode = () => (process.env.DEMO_MODE === 'real' ? 'real' : 'mock')

  const netguard = createNetguard({ mode, liveOrigins: () => [] })
  const flow = createFlow()
  const workspaces = createWorkspaces({
    build: (id) => ({ id }),
    reset: (ws) => {
      if (ws.id === DEFAULT_WORKSPACE) flow.reset()
      return ws
    },
  })
  // Workspace scoping middleware (rule 13): every /api/* route sees req.workspaceId.
  app.use('/api', (req, _res, next) => {
    try {
      req.workspaceId = req.get(WORKSPACE_HEADER) || DEFAULT_WORKSPACE
      workspaces.get(req.workspaceId)
      next()
    } catch (e) {
      next(e)
    }
  })

  app.get('/api/health', (_req, res) => {
    res.json({ app: 'demo-health/1', state: 'ready', mode: mode() })
  })

  app.get('/api/netguard/self-test', async (_req, res) => {
    res.json(await netguard.selfTest())
  })

  app.get('/api/info', (_req, res) => {
    const realConfigured = Boolean(
      process.env.MERIDIAN_PINGONE_ENV_ID &&
        process.env.MERIDIAN_CONCIERGE_CLIENT_ID &&
        process.env.MERIDIAN_CONCIERGE_CLIENT_SECRET,
    )
    res.json({
      app: 'meridian-a2a-hop',
      mode: mode(),
      realAvailable: realConfigured,
      realConfigured,
      workspaceId: DEFAULT_WORKSPACE,
      banner:
        mode() === 'mock'
          ? 'Simulation: every issuer, door and tool on this page is local. Nothing leaves this machine.'
          : 'Real: exchanges hit your PingOne tenant; doors are the live Privilege gateway.',
    })
  })

  app.post('/api/mode', (req, res) => {
    const want = req.body && req.body.mode
    if (want !== 'mock' && want !== 'real') {
      return res.status(400).json({ error: 'mode must be "mock" or "real"' })
    }
    const realConfigured = Boolean(
      process.env.MERIDIAN_PINGONE_ENV_ID &&
        process.env.MERIDIAN_CONCIERGE_CLIENT_ID &&
        process.env.MERIDIAN_CONCIERGE_CLIENT_SECRET,
    )
    if (want === 'real' && !realConfigured) {
      return res.status(409).json({ error: 'Real mode is not configured (set MERIDIAN_* in the shared env).' })
    }
    process.env.DEMO_MODE = want
    res.json({ mode: mode() })
  })

  // ---- Flow routes ----
  app.get('/api/flow/steps', (_req, res) => res.json({ steps: flow.STEPS }))

  app.get('/api/flow/captured', (req, res) => {
    res.json({ tokens: flow.captured })
  })

  app.post('/api/flow/reset', (req, res) => {
    flow.reset()
    res.json({ ok: true })
  })

  app.post('/api/flow/external-tokens', async (_req, res) => {
    const { subject, actor } = await flow.mintExternalTokens()
    res.json({ subject, actor })
  })

  app.post('/api/flow/run', async (req, res) => {
    const { step, overrides } = req.body || {}
    const result = await flow.runStep(step, overrides)
    res.json(result)
  })

  // Static hosting: the built web app, with the API routes taking precedence.
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  if (existsSync(dist)) {
    app.use(express.static(dist))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }

  return app
}
