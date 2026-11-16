// "What Privilege did" (rule 25) on the page: after Send on the door hop, the shared panel sits under the result and draws the trace the
// server returned (mock: checked decisions, real: inferred ones); when the lab sent nothing to the gateway it says so instead of a panel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.jsx'
import { setJsonView } from './components/JsonPane.jsx'

const STEPS = [
  { id: 'sign-in', n: 1, title: 'Sign in', actors: ['person'], blurb: 'x', refusals: [], request: { method: 'POST', url: '/x', headers: {}, body: {} } },
  { id: 'mcp-payouts', n: 6, title: 'Token -> door', actors: ['payouts'], blurb: 'x', refusals: [], request: { method: 'POST', url: '/x', headers: {}, body: { door: 'meridian-payouts', tool: 'query_account_payouts' } } },
]

const mockTrace = () => ({
  source: 'mock',
  request: { method: 'POST', url: 'https://mcpgw.meridian.invalid/meridian-payouts/mcp', headers: { authorization: 'Bearer eyJhbGciOiJFUzI1NiIs… (400 characters, shortened)' }, body: { door: 'meridian-payouts', tool: 'query_account_payouts' } },
  response: { status: 403, headers: { 'content-type': 'application/json' }, body: { status: 403, error: 'insufficient_scope' } },
  decisions: [
    { id: 'door', label: 'Door exists', outcome: 'pass', basis: 'checked', evidence: 'ok' },
    { id: 'aud', label: 'Audience matches this door', outcome: 'fail', basis: 'checked', evidence: 'aud is wrong' },
    { id: 'client', label: "client_id is this specialist's", outcome: 'skipped', basis: 'checked', evidence: 'not reached' },
  ],
  record: 'door=meridian-payouts status=403 aud',
})
const realTrace = () => ({
  source: 'real',
  request: { method: 'POST', url: 'https://door.example/payouts/mcp', headers: { authorization: 'Bearer <token, 900 characters, kept on the server>' }, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query_account_payouts', arguments: {} } } },
  response: { status: 200, headers: { 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, result: { content: [] } } },
  decisions: [
    { id: 'authenticated', label: 'Authentication', outcome: 'pass', basis: 'inferred', evidence: 'token accepted' },
    { id: 'grant', label: 'Delegation policy', outcome: 'pass', basis: 'inferred', evidence: 'the door let this delegated call through' },
  ],
  record: null,
})

let reply
beforeEach(() => {
  setJsonView('raw')
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const body = url === '/api/flow/steps' ? { steps: STEPS } : url === '/api/flow/run' ? reply : url === '/api/info' ? { mode: 'mock' } : url === '/api/flow/captured' ? { tokens: [] } : {}
    return { status: 200, json: async () => body }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function sendDoor() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /6 · Token -> door/ }))
  fireEvent.click(await screen.findByTestId('send-mcp-payouts'))
}

describe('What Privilege did on the door hop', () => {
  it('no panel before Send', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /6 · Token -> door/ }))
    await screen.findByTestId('send-mcp-payouts')
    expect(screen.queryByTestId('gateway-trace')).toBeNull()
  })

  it('mock: the panel shows the simulated door, its checked decisions and the exact exchange', async () => {
    const t = mockTrace()
    reply = { ok: true, step: 'mcp-payouts', refused: t.response.body, gatewayTrace: [{ step: 6, title: 'Privilege door call: query_account_payouts', status: 403, trace: t }] }
    await sendDoor()
    const panel = await screen.findByTestId('gateway-trace')
    expect(screen.getByTestId('gateway-trace-basis')).toHaveTextContent(/^Simulated/)
    const list = within(panel).getByTestId('trace-6-decisions')
    expect(list).toHaveTextContent('Audience matches this door')
    expect(within(panel).getByTestId('trace-6')).toHaveTextContent('refused at: Audience matches this door')
    expect(within(panel).getByTestId('trace-6-request-head')).toHaveTextContent('POST https://mcpgw.meridian.invalid/meridian-payouts/mcp')
    expect(within(panel).getByTestId('trace-6-response-body')).toHaveTextContent('insufficient_scope')
  })

  it('real: the panel says the gateway reports no per-check detail, and marks decisions inferred', async () => {
    const t = realTrace()
    reply = { ok: true, step: 'mcp-payouts', status: 200, response: t.response.body, gatewayTrace: [{ step: 6, title: 'Privilege door call: query_account_payouts', status: 200, trace: t }] }
    await sendDoor()
    const panel = await screen.findByTestId('gateway-trace')
    expect(screen.getByTestId('gateway-trace-basis')).toHaveTextContent(/^Real gateway/)
    expect(within(within(panel).getByTestId('trace-6-decisions')).getAllByText('inferred from the outcome')).toHaveLength(2)
    expect(within(panel).getByTestId('trace-6-request-head')).toHaveTextContent('kept on the server')
  })

  it('real, nothing sent to the gateway: no panel, a note says why', async () => {
    reply = { ok: true, step: 'mcp-payouts', refused: { status: 403, error: 'tool_not_allowed', reason: 'r' }, traceNote: "This lab's own claim check refused the call before anything was sent to the gateway, so the gateway did nothing here." }
    await sendDoor()
    await waitFor(() => expect(screen.getByTestId('gateway-trace-note')).toHaveTextContent(/before anything was sent to the gateway/))
    expect(screen.queryByTestId('gateway-trace')).toBeNull()
  })
})
