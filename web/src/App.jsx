import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { getPresenter, setPresenter } from './presenter.js'
import { fillCast } from './cast.js'
import { loadDiagram, DIAGRAM_IDS } from './diagrams/index.js'
import DiagramView from './DiagramView.jsx'
import Hop from './Hop.jsx'
import SignInForm from './SignInForm.jsx'
import CapturedTokens from './CapturedTokens.jsx'
import ShelfLink from "./components/ShelfLink.jsx";
// Opened from Customer Agent LAB (UC2.5 routes here): strip + header Back only. This lab is one fixed walkthrough with no scenario or
// vertical to preselect, so nothing else changes.
import ReturnLink from "./return-link/ReturnLink.jsx";

const THEME_KEY = "ma2a.theme";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}

export default function App() {
  const [info, setInfo] = useState(null)
  const [theme, setTheme] = useState(initialTheme)

  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme])

  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next)
  }
  const [steps, setSteps] = useState([])
  const [tokens, setTokens] = useState([])
  const [state, setState] = useState({}) // stepId -> { request, response, refused, result }
  const [current, setCurrent] = useState('sign-in')
  const [presenter, setPresenterState] = useState(false)
  const [error, setError] = useState(null)
  const [piFlow, setPiFlow] = useState(null) // real-mode native flow state for the credential form
  const demoUser = info?.demoUser || ''

  useEffect(() => {
    api.info().then(({ body }) => setInfo(body)).catch(() => {})
    api.steps().then(({ body }) => setSteps(body.steps ?? [])).catch(() => {})
    refreshCaptured()
    const on = getPresenter()
    setPresenter(on)
    setPresenterState(on)
  }, [])

  function refreshCaptured() {
    api.captured().then(({ body }) => setTokens(body.tokens ?? [])).catch(() => {})
  }

  function togglePresenter() {
    const next = !presenter
    setPresenter(next)
    setPresenterState(next)
  }

  async function switchMode(mode) {
    const res = await api.switchMode(mode)
    if (res.status === 200) setInfo(await (await fetch('/api/info')).json())
    else setError(res.body.error || 'Mode switch refused')
  }

  async function send(step, refusalId) {
    setError(null)
    const overrides = {}
    if (step.id === 'concierge-decides') overrides.intent = 'Show my recent payouts'
    if (refusalId === 'actor-token-type-access') {
      overrides.request = { ...step.request, body: { ...step.request.body, actor_token_type: 'urn:ietf:params:oauth:token-type:access_token' } }
    } else if (refusalId === 'no-actor-token') {
      const body = { ...step.request.body }
      delete body.actor_token
      delete body.actor_token_type
      overrides.request = { ...step.request, body }
    } else if (refusalId === 'other-specialist-tool') {
      overrides.body = { ...step.request.body, tool: 'take_guest_payment' }
    } else if (refusalId === 'wrong-door') {
      overrides.body = { ...step.request.body, door: 'meridian-payments' }
    } else if (refusalId === 'skip-concierge') {
      // Present the person's own token at the payouts door (never exchanged): 401 required act.sub.
      overrides.body = { ...step.request.body, token: '{token:person}' }
    }
    const res = await api.run(step.id, overrides)
    if (res.status !== 200) {
      setError(res.body?.error || 'Request failed')
      return
    }
    if (step.id === 'sign-in' && res.body.piFlow) {
      setPiFlow(res.body.piFlow) // real mode: show the credential form instead of advancing
      setState((s) => ({ ...s, [step.id]: { ...res.body, request: res.body.request ?? step.request } }))
      return // the credential form completes this hop
    }
    setState((s) => ({ ...s, [step.id]: { ...res.body, request: res.body.request ?? step.request } }))
    refreshCaptured()
    // Stay on a refused hop so the refusal is read; advance only when the hop went through.
    const wentThrough = !res.body.refused && (res.body.status === undefined || res.body.status < 400)
    const idx = steps.findIndex((s) => s.id === step.id)
    if (wentThrough && idx >= 0 && idx < steps.length - 1) setCurrent(steps[idx + 1].id)
  }

  async function startOver() {
    await api.reset()
    setState({})
    setTokens([])
    setCurrent('sign-in')
    setError(null)
  }

  const mode = info?.mode || 'mock'
  // Map the demo's hop to the diagram's walkthrough step (null until the flow starts).
  const HOP_TO_DIAGRAM_STEP = {
    'sign-in': 0,
    'external-agent': 1,
    'third-party-exchange': 2,
    'concierge-decides': 3,
    'exchange-payouts': 3,
    'mcp-payouts': 5,
    'delegation-chain': 5,
  }
  const diagramStepIndex = state[current] != null ? (HOP_TO_DIAGRAM_STEP[current] ?? null) : null

  return (
    <main className="shell">
      <ReturnLink app="meridian-a2a-hop" />
      <header className="topbar">
        <span className="logo">wpt</span>
        <div>
          <h1>Meridian Pay A2A, one hop at a time</h1>
        <ShelfLink />
        <ReturnLink app="meridian-a2a-hop" variant="header" />
          <p>
            Every hop is a token exchange and a call through a Privilege door. Each form is prefilled from the
            step before it; change any value before you send.
          </p>
        </div>
        <span className="who" data-testid="who">
          {tokens.length > 0 ? `${fillCast('Jordan Ellis')} · signed in` : 'not signed in'}
        </span>
        <span className="mode-badge" data-testid="mode-badge">
          {mode === 'real' ? 'Real' : 'Mock'}
        </span>
        <button type="button" data-testid="mode-real" className="mode-btn" onClick={() => switchMode('real')}>
          Real
        </button>
        <button type="button" data-testid="mode-mock" className="mode-btn" onClick={() => switchMode('mock')}>
          Mock
        </button>
        <button type="button" className="mode-btn" onClick={startOver} data-testid="start-over">
          Start over
        </button>
        <label className="shell-theme">Theme
          <select value={theme} onChange={(e) => pickTheme(e.target.value)}>
            {THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="mode-btn" onClick={togglePresenter}>
          Presenter {presenter ? 'on' : 'off'}
        </button>
      </header>

      <section className="banner simulation">{fillCast(info?.banner || 'Simulation: every issuer, door and tool on this page is local. Nothing leaves this machine.')}</section>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <DiagramView id={DIAGRAM_IDS[0]} stepIndex={diagramStepIndex} />

      <div className="columns">
        <nav className="stepnav" aria-label="Steps">
          {steps.map((s) => (
            <button key={s.id} type="button" className={`stepnav-item ${state[s.id] ? 'done' : ''} ${current === s.id ? 'current' : ''}`} onClick={() => setCurrent(s.id)}>
              {state[s.id] ? '✓' : s.n} · {fillCast(s.title)}
            </button>
          ))}
          <CapturedTokens tokens={tokens} />
        </nav>

        <div className="main-pane">
          {current === 'sign-in' && piFlow && !state['sign-in']?.response?.access_token && (
            <SignInForm
              flowStatus={piFlow.status}
              demoUser={demoUser}
              onSubmit={async ({ username, password }) => {
                const res = await fetch('/api/flow/sign-in-submit', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username, password }),
                })
                const body = await res.json()
                if (body.ok && body.response?.access_token) {
                  setPiFlow(null)
                  setState((s) => ({ ...s, 'sign-in': { ok: true, response: body.response, status: 200 } }))
                  refreshCaptured()
                  setCurrent('external-agent')
                } else {
                  setError(body.flow?.message || body.error || 'Sign-in failed')
                }
              }}
            />
          )}
          {steps
            .filter((s) => s.id === current)
            .map((s) => (
              <Hop key={s.id} step={s} state={state[s.id]} onSend={send} />
            ))}
          {current === 'delegation-chain' && <DelegationChain tokens={tokens} />}
        </div>
      </div>
    </main>
  )
}

function DelegationChain({ tokens }) {
  return (
    <section className="hop" data-testid="delegation-chain">
      <h2>Every token, side by side</h2>
      <table>
        <thead>
          <tr>
            <th>Hop</th>
            <th>sub</th>
            <th>act</th>
            <th>aud</th>
            <th>scope</th>
            <th>changed</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.hop}>
              <td>{t.hop}</td>
              <td>{t.decoded?.sub}</td>
              <td>{t.decoded?.act?.sub || '—'}</td>
              <td>{t.decoded?.aud}</td>
              <td>{t.decoded?.scope || '—'}</td>
              <td>{t.changed?.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
