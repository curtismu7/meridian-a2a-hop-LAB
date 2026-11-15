// Captured tokens panel: one chip per hop, raw + decoded sub/act, what changed.
import Json from './components/JsonPane.jsx'

export default function CapturedTokens({ tokens }) {
  return (
    <aside className="captured" data-testid="captured-tokens">
      <h3>Captured tokens</h3>
      {tokens.length === 0 && <p className="dim">Send the first hop to capture a token.</p>}
      {tokens.map((t) => (
        <details key={t.hop} className="token">
          <summary>
            <span className="hopnum">{t.hop}</span> {t.label}
            {t.decoded?.act && <span className="act">act</span>}
          </summary>
          {t.decoded && <Json value={t.decoded} label={`Token ${t.hop} claims`} />}
          {t.changed?.length > 0 && (
            <dl>
              <dt>changed</dt>
              <dd className="changed">{t.changed.join(', ')}</dd>
            </dl>
          )}
          <Json value={t.raw} label={`Raw token ${t.hop}`} />
        </details>
      ))}
    </aside>
  )
}
