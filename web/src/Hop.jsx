// One hop: explainer, request editor (placeholders prefilled; secrets stay server-side), Send, response tabs.
import { useState } from 'react'
import { fillCast } from './cast.js'
import Json from './components/JsonPane.jsx'

// Keys that matter in this lab's payloads (the shared defaults - sub, act, aud, scope, grant_type, tokens - are already hot).
const HOT = ['door', 'tool', 'audience', 'subject_token_type', 'actor_token_type']

export default function Hop({ step, state, onSend }) {
  const [tab, setTab] = useState('result')
  const request = state?.request ?? step.request
  const response = state?.response
  const refused = state?.refused
  const result = state?.result

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
          {request.body && <Json value={request.body} label="Request body" hot={HOT} />}
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
          {tab === 'result' && <Json value={refused ?? result ?? response} label={refused ? 'Refused' : 'Result'} testId={`result-${step.id}`} hot={HOT} />}
          {tab === 'tokens' && <Json value={state?.tokenView ?? 'No token captured on this hop.'} label="Tokens" />}
          {tab === 'request' && <Json value={request} label="Request" hot={HOT} />}
        </div>
      )}
    </section>
  )
}
