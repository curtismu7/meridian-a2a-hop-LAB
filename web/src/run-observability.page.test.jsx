// The run observability panel (rule 27) on the lab's page: empty state before a run, the Mock record, the other-mode record refused,
// a failed collection shown as an alert, and a Mock/Real switch that re-reads the record for the new mode.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App.jsx'
import { setJsonView } from './components/JsonPane.jsx'
import { mockRecord, realRecord } from './run-observability/fixtures.js'

let info
let obs // { status, body } the run-observability route answers
let calls
beforeEach(() => {
  setJsonView('raw')
  window.history.replaceState(null, '', '/')
  info = { mode: 'mock', realAvailable: true }
  obs = { status: 204, body: {} }
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push(`${opts?.method || 'GET'} ${url}`)
    if (url === '/api/mode') { info = { ...info, mode: JSON.parse(opts.body).mode }; return { status: 200, json: async () => ({ mode: info.mode }) } }
    if (url === '/api/run-observability') return { status: obs.status, json: async () => (typeof obs.body === 'function' ? obs.body() : obs.body) }
    const body = url === '/api/flow/steps' ? { steps: [] } : url === '/api/info' ? info : url === '/api/flow/captured' ? { tokens: [] } : {}
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
