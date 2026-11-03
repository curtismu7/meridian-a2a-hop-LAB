export default function App() {
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
        <span className="mode-badge">Mock</span>
      </header>
      <section className="banner simulation">
        Simulation: every issuer, door and tool on this page is local. Nothing leaves this
        machine.
      </section>
      <p className="placeholder-note">Phase 1 builds the hop flow here.</p>
    </main>
  )
}
