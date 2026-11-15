import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import Hop from './Hop.jsx'
import CapturedTokens from './CapturedTokens.jsx'
import { setJsonView } from './components/JsonPane.jsx'

const step = {
  id: 'mcp-payouts',
  n: 6,
  title: 'Call the payouts door',
  actors: ['concierge', 'door'],
  blurb: 'The door checks the required claims.',
  refusals: [],
  request: {
    method: 'POST',
    url: 'https://door.example/mcp',
    headers: { Accept: 'application/json' },
    body: { door: 'meridian-payouts', tool: 'query_account_payouts', arguments: { pageSize: 5 } },
  },
}

describe('Hop JSON panes (Rule 24: shared JsonPane, Form | JSON, full view)', () => {
  beforeEach(() => setJsonView('form'))

  it('shows the request body as a Form | JSON pane, not a scrolling textarea', () => {
    const { container } = render(<Hop step={step} state={undefined} onSend={() => {}} />)
    expect(container.querySelector('textarea')).toBeNull()
    const pane = screen.getByRole('group', { name: 'Request body' })
    expect(within(pane).getByText('query_account_payouts')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    expect(screen.getByLabelText('Request body').tagName).toBe('PRE')
    expect(screen.getByLabelText('Request body').textContent).toContain('"tool": "query_account_payouts"')
  })

  it('shows a result as JSON text in the JSON view, with the lab keys marked hot', () => {
    setJsonView('raw')
    const state = { request: step.request, result: { status: 200, payouts: [{ id: 'p1' }] } }
    const { container } = render(<Hop step={step} state={state} onSend={() => {}} />)
    const pane = screen.getByTestId('result-mcp-payouts')
    expect(pane.tagName).toBe('PRE')
    expect(pane.textContent).toContain('"status": 200')
    expect(container.querySelector('.response pre')).toBe(pane)
  })

  it('shows a refusal with its error and reason, and the request tab as JSON', () => {
    const refused = { status: 403, error: 'tool_not_allowed', reason: 'The policy lists only this specialist\'s tools.' }
    render(<Hop step={step} state={{ request: step.request, refused }} onSend={() => {}} />)
    const pane = screen.getByTestId('result-mcp-payouts')
    expect(pane).toHaveTextContent('tool_not_allowed')
    expect(pane).toHaveTextContent("The policy lists only this specialist's tools.")
    fireEvent.click(screen.getByRole('tab', { name: 'request' }))
    expect(screen.getByRole('group', { name: 'Request' })).toHaveTextContent('https://door.example/mcp')
  })
})

describe('CapturedTokens JSON panes', () => {
  beforeEach(() => setJsonView('form'))

  const jwt = `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ sub: 'jordan', act: { sub: 'meridian-concierge' } })).replace(/=+$/, '')}.sig12345`

  it('shows the decoded claims and the raw token through Json, with no textarea', () => {
    const tokens = [{ hop: 3, label: 'Concierge token', raw: jwt, decoded: { sub: 'jordan', aud: 'meridian-payouts-rs', scope: 'mp:payouts', act: { sub: 'meridian-concierge' } }, changed: ['aud', 'act'] }]
    const { container } = render(<CapturedTokens tokens={tokens} />)
    expect(container.querySelector('textarea')).toBeNull()
    const claims = screen.getByRole('group', { name: 'Token 3 claims' })
    expect(claims).toHaveTextContent('meridian-concierge')
    expect(claims).toHaveTextContent('meridian-payouts-rs')
    expect(screen.getByLabelText('Raw token 3')).toHaveTextContent('eyJhbGciOiJub25lIn0')
    expect(screen.getByText('aud, act')).toBeInTheDocument()
  })
})
