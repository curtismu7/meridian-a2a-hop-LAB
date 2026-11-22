// The run observability panel (rule 27) on the lab's page: empty state before a run, the Mock record, the other-mode record refused,
// a failed collection shown as an alert, and a Mock/Real switch that re-reads the record for the new mode.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import App from './App.jsx'
import { setJsonView } from './components/JsonPane.jsx'
import { mockRecord, realRecord } from './run-observability/fixtures.js'

let info
let obs // { status, body } the run-observability route answers
let calls
let steps
let runReply
let signInReply
beforeEach(() => {
  setJsonView('raw')
  window.history.replaceState(null, '', '/')
  info = { mode: 'mock', realAvailable: true }
  obs = { status: 204, body: {} }
  calls = []
  steps = []
  runReply = { ok: true, status: 200, response: {} }
  signInReply = { ok: false, flow: { message: 'bad credentials' } }
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push(`${opts?.method || 'GET'} ${url}`)
    if (url === '/api/mode') { info = { ...info, mode: JSON.parse(opts.body).mode }; return { status: 200, json: async () => ({ mode: info.mode }) } }
    if (url === '/api/run-observability') return { status: obs.status, json: async () => (typeof obs.body === 'function' ? obs.body() : obs.body) }
    if (url === '/api/flow/run') return { status: 200, json: async () => runReply }
    if (url === '/api/flow/sign-in-submit') return { status: 200, json: async () => signInReply }
    const body = url === '/api/flow/steps' ? { steps } : url === '/api/info' ? info : url === '/api/flow/captured' ? { tokens: [] } : {}
    return { status: 200, json: async () => body }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('run observability on the page', () => {
  it('before a run: the explicit empty state, no table', async () => {
    render(<App />)
    expect(await screen.findByTestId('ro-empty')).toHaveTextContent(/Run the demo/)
    expect(screen.queryByTestId('ro-table')).toBeNull()
  })

  it('Mock: simulated rows are drawn, tagged simulated, and the page says where this lab logs', async () => {
    obs = { status: 200, body: mockRecord }
    render(<App />)
    expect(await screen.findByTestId('ro-table')).toBeInTheDocument()
    expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Simulated')
    expect(screen.getByTestId('ro-streams')).toHaveTextContent(/This lab \(server\)/)
    expect(screen.getByTestId('ro-streams')).toHaveTextContent(/cyonproxy\.log/)
  })

  it('a record from the other mode is refused on screen, not shown under the wrong label', async () => {
    obs = { status: 200, body: realRecord }
    render(<App />)
    expect(await screen.findByTestId('ro-mismatch')).toHaveTextContent(/real mode but the page is in mock mode/)
    expect(screen.queryByTestId('ro-table')).toBeNull()
  })

  it('a failed collection is an alert, never an empty table', async () => {
    obs = { status: 500, body: { error: 'run_observability_failed', message: 'The run record could not be built.' } }
    render(<App />)
    expect(await screen.findByTestId('ro-error')).toHaveTextContent(/could not be built/)
    expect(screen.queryByTestId('ro-table')).toBeNull()
  })

  it('switching Mock to Real and back re-reads the record for each mode', async () => {
    obs = { status: 200, body: () => (info.mode === 'real' ? realRecord : mockRecord) }
    render(<App />)
    await screen.findByTestId('ro-table')
    expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Simulated')
    fireEvent.change(await screen.findByTestId('mode-select'), { target: { value: 'real' } })
    await waitFor(() => expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Logged'))
    fireEvent.change(screen.getByTestId('mode-select'), { target: { value: 'mock' } })
    await waitFor(() => expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Simulated'))
    expect(calls.filter((c) => c === 'GET /api/run-observability').length).toBeGreaterThanOrEqual(3)
  })
})

const STEP = (id, n) => ({ id, n, title: `Step ${n}`, actors: [], blurb: 'x', refusals: [], request: { method: 'POST', url: '/x', headers: {}, body: {} } })
const reads = () => calls.filter((c) => c === 'GET /api/run-observability').length

describe('re-reading the logs in Real mode', () => {
  beforeEach(() => {
    info = { mode: 'real', realAvailable: true }
    obs = { status: 200, body: realRecord }
    steps = [STEP('sign-in', 1), STEP('external-agent', 2)]
  })
  afterEach(() => { vi.useRealTimers() })

  it('Real shows a Re-read logs button that reads the record again; Mock shows none', async () => {
    render(<App />)
    const button = await screen.findByTestId('ro-reread')
    await waitFor(() => expect(button).not.toBeDisabled())
    const before = reads()
    fireEvent.click(button)
    await waitFor(() => expect(reads()).toBe(before + 1))
    await waitFor(() => expect(screen.getByTestId('ro-reread')).not.toBeDisabled())
    cleanup()
    info = { mode: 'mock', realAvailable: true }
    obs = { status: 200, body: mockRecord }
    render(<App />)
    await screen.findByTestId('ro-table')
    expect(screen.queryByTestId('ro-reread')).toBeNull()
  })

  it('a failed sign-in refreshes the record (it recorded a refused person row)', async () => {
    runReply = { ok: true, step: 'sign-in', piFlow: { id: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' } }
    render(<App />)
    fireEvent.click(await screen.findByTestId('send-sign-in'))
    const form = await screen.findByTestId('sign-in-form')
    await waitFor(() => expect(screen.getByTestId('ro-reread')).not.toBeDisabled())
    const before = reads()
    fireEvent.change(form.querySelector('input[name=password]'), { target: { value: 'nope' } })
    fireEvent.submit(form.querySelector('form'))
    await waitFor(() => expect(calls).toContain('POST /api/flow/sign-in-submit'))
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
  })

  it('Real reads once more about 5 seconds after a hop (a collector ships lines late); Mock does not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /2 · Step 2/ }))
    fireEvent.click(await screen.findByTestId('send-external-agent'))
    await waitFor(() => expect(calls).toContain('POST /api/flow/run'))
    await waitFor(() => expect(screen.getByTestId('ro-reread')).not.toBeDisabled())
    const afterHop = reads()
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(reads()).toBe(afterHop)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await waitFor(() => expect(reads()).toBe(afterHop + 1))
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(reads()).toBe(afterHop + 1) // one automatic re-read per hop, not a poll
    cleanup()
    // Mock: no automatic re-read
    info = { mode: 'mock', realAvailable: true }
    obs = { status: 200, body: mockRecord }
    calls = []
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /2 · Step 2/ }))
    fireEvent.click(await screen.findByTestId('send-external-agent'))
    await waitFor(() => expect(calls).toContain('POST /api/flow/run'))
    await waitFor(() => expect(reads()).toBeGreaterThanOrEqual(2))
    const mockAfter = reads()
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(reads()).toBe(mockAfter)
  })
})
