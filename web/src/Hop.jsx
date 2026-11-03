// One hop: explainer, request editor (placeholders prefilled; secrets stay server-side), Send, response tabs.
import { useMemo, useState } from 'react'
import { fillCast } from './cast.js'

export default function Hop({ step, state, onSend }) {
  const [tab, setTab] = useState('result')
  const request = state?.request ?? step.request
  const response = state?.response
  const refused = state?.refused
  const result = state?.result

  const bodyText = useMemo(() => (request?.body ? JSON.stringify(request.body, null, 2) : ''), [request])

  return (
    <section className="hop" data-testid={`hop-${step.id}`}>
      <header className="hop-head">
        {step.actors.map((a, i) => (
          <span key={i} className="chip actor">
            {fillCast(a)}
          </span>
        ))}
        <h2>
          {step.n}. {fillCast(step.title)}
        </h2>
      </header>
      <p className="hop-blurb">{fillCast(step.blurb)}</p>

      {step.refusals.length > 0 && (
        <div className="refusals">
          {step.refusals.map((r) => (
            <button key={r.id} type="button" className="refusal-chip" onClick={() => onSend(step, r.id)}>
              Try a refusal: {fillCast(r.label)} — Expected: {fillCast(r.expected)}
            </button>
          ))}
        </div>
      )}

      {request && (
        <div className="request">
          <div className="req-row">
            <select value={request.method} readOnly aria-label="Method">
              <option>{request.method}</option>
            </select>
            <input value={request.url} readOnly aria-label="URL" />
          </div>
          {Object.entries(request.headers ?? {}).map(([k, v]) => (
            <div className="req-row" key={k}>
              <input value={k} readOnly aria-label="Header name" />
              <input value={typeof v === 'string' ? v : JSON.stringify(v)} readOnly aria-label="Header value" />
            </div>
          ))}
          {bodyText && <textarea value={bodyText} readOnly rows={Math.min(12, bodyText.split('\n').length)} aria-label="Body" />}
          <button type="button" className="send" onClick={() => onSend(step)} data-testid={`send-${step.id}`}>
            Send
          </button>
        </div>
      )}

      {(response || refused || result) && (
        <div className="response" data-testid={`response-${step.id}`}>
          <div className="tabs" role="tablist">
            {['result', 'tokens', 'request'].filter(Boolean).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab on' : 'tab'} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
            {response?.status && <span className={`status ${response.status < 400 ? 'ok' : 'bad'}`}>{response.status}</span>}
            {refused && <span className="status bad">{refused.status}</span>}
            {result?.status === 200 && <span className="status ok">200</span>}
          </div>
          {tab === 'result' && (
            <pre data-testid={`result-${step.id}`}>
              {refused
                ? `REFUSED (${refused.status} ${refused.error})\n\n${refused.reason}`
                : result
                  ? JSON.stringify(result, null, 2)
                  : JSON.stringify(response, null, 2)}
            </pre>
          )}
          {tab === 'tokens' && <pre>{state?.tokenView ?? 'No token captured on this hop.'}</pre>}
          {tab === 'request' && <pre>{JSON.stringify(request, null, 2)}</pre>}
        </div>
      )}
    </section>
  )
}
