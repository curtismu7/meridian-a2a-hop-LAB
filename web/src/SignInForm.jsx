// Real-mode pi.flow credential form: the person types their credentials; they go to OUR server,
// which drives the PingOne flow server-side (the browser never talks to PingOne directly).
export default function SignInForm({ flowStatus, onSubmit }) {
  return (
    <section className="hop" data-testid="sign-in-form">
      <header className="hop-head">
        <h2>Sign in to Meridian Pay</h2>
      </header>
      <p className="hop-blurb">
        Native PingOne flow ({flowStatus}). Your credentials go to this app's server, which drives the
        PingOne flow; the browser never talks to the authorization server directly.
      </p>
      <form
        className="request"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.target)
          onSubmit({ username: f.get('username'), password: f.get('password') })
        }}
      >
        <div className="req-row">
          <input name="username" placeholder="Username" defaultValue="jordan.ellis" autoComplete="username" />
        </div>
        <div className="req-row">
          <input name="password" type="password" placeholder="Password" autoComplete="current-password" />
        </div>
        <button type="submit" className="send">
          Sign in
        </button>
      </form>
    </section>
  )
}
