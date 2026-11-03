// Captured tokens panel: one chip per hop, raw + decoded sub/act, what changed.
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
          <dl>
            <dt>sub</dt>
            <dd>{t.decoded?.sub}</dd>
            <dt>aud</dt>
            <dd>{t.decoded?.aud}</dd>
            <dt>scope</dt>
            <dd>{t.decoded?.scope || '—'}</dd>
            <dt>client_id</dt>
            <dd>{t.decoded?.client_id || '—'}</dd>
            <dt>act</dt>
            <dd>{t.decoded?.act ? JSON.stringify(t.decoded.act) : '—'}</dd>
            {t.changed?.length > 0 && (
              <>
                <dt>changed</dt>
                <dd className="changed">{t.changed.join(', ')}</dd>
              </>
            )}
          </dl>
          <textarea readOnly value={t.raw} rows={4} aria-label={`raw token ${t.hop}`} />
        </details>
      ))}
    </aside>
  )
}
