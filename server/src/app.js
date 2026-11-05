import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createNetguard } from './netguard.js'
import { createWorkspaces, DEFAULT_WORKSPACE, WORKSPACE_HEADER } from './workspaces.js'
import { createFlow } from './flow/orchestrator.js'
import { createRealFlow } from './flow/realFlow.js'
import { shelfInfo } from './shelfLink.js';

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '256kb' }))

  const mode = () => (process.env.DEMO_MODE === 'real' ? 'real' : 'mock')

  const netguard = createNetguard({
    mode,
    liveOrigins: () => {
      const envId = process.env.MERIDIAN_PINGONE_ENV_ID
      const origins = []
      if (envId) origins.push(new URL(`https://auth.pingone.com/${envId}`).origin)
      for (const k of ['MERIDIAN_MCP_DOOR_PAYOUTS_URL', 'MERIDIAN_MCP_DOOR_PAYMENTS_URL']) {
        if (process.env[k]) origins.push(new URL(process.env[k]).origin)
      }
      return origins
    },
  })
  const flow = createFlow()
  const realFlow = createRealFlow({ netguard })
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
      demoUser: process.env.MERIDIAN_USER_USERNAME || '',
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
    const active = mode() === 'real' ? realFlow.captured : flow.captured
    res.json({ tokens: active })
  })

  app.post('/api/flow/reset', (req, res) => {
    flow.reset()
    realFlow.reset()
    res.json({ ok: true })
  })

  app.post('/api/flow/external-tokens', async (_req, res) => {
    const { subject, actor } = await flow.mintExternalTokens()
    res.json({ subject, actor })
  })

  app.post('/api/flow/run', async (req, res) => {
    const { step, overrides } = req.body || {}
    const result = mode() === 'real' ? await realFlow.runStep(step, overrides) : await flow.runStep(step, overrides)
    res.json(result)
  })

  // pi.flow native sign-in: the UI collects credentials and posts them here (real mode only).
  app.post('/api/flow/sign-in-submit', async (req, res) => {
    if (mode() !== 'real') return res.status(409).json({ error: 'sign-in-submit is a real-mode route' })
    const { username, password } = req.body || {}
    res.json(await realFlow.signInSubmit({ username, password }))
  })

  // Static hosting: the built web app, with the API routes taking precedence.
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  if (existsSync(dist)) {
app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
    app.use(express.static(dist))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }

  return app
}
