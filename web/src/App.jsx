import { useEffect, useState } from 'react'
import { getPresenter, setPresenter } from './presenter.js'
import { fillCast } from './cast.js'

export default function App() {
  const [info, setInfo] = useState(null)
  const [presenter, setPresenterState] = useState(false)

  useEffect(() => {
    fetch('/api/info').then((r) => r.json()).then(setInfo).catch(() => {})
    const on = getPresenter()
    setPresenter(on)
    setPresenterState(on)
  }, [])

  function togglePresenter() {
    const next = !presenter
    setPresenter(next)
    setPresenterState(next)
  }

  async function switchMode(mode) {
    const res = await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (res.ok) setInfo(await (await fetch('/api/info')).json())
    else console.warn(await res.json())
  }

  const mode = info?.mode || 'mock'
  return (
    <main className="shell">
      <header className="topbar">
        <span className="logo">wpt</span>
        <div>
          <h1>Meridian Pay A2A, one hop at a time</h1>
          <p>
            Every hop is a token exchange and a call through a Privilege door. Each form is
            prefilled from the step before it; change any value before you send.
          </p>
        </div>
        <span className="mode-badge" data-testid="mode-badge">{mode === 'real' ? 'Real' : 'Mock'}</span>
        <button type="button" data-testid="mode-real" className="mode-btn" onClick={() => switchMode('real')}>
          Real
        </button>
        <button type="button" data-testid="mode-mock" className="mode-btn" onClick={() => switchMode('mock')}>
          Mock
        </button>
      </header>
      <section className="banner simulation">{fillCast(info?.banner || 'Simulation: every issuer, door and tool on this page is local. Nothing leaves this machine.')}</section>
      <p className="placeholder-note">
        Phase 1 builds the hop flow here.{' '}
        <button type="button" className="mode-btn" onClick={togglePresenter}>
          Presenter {presenter ? 'on' : 'off'}
        </button>
      </p>
    </main>
  )
}
