import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App.jsx'

describe('App', () => {
  it('shows the hop walkthrough title and simulation banner', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: /one hop at a time/i })).toBeInTheDocument()
    expect(screen.getByText(/Simulation: every issuer, door and tool/i)).toBeInTheDocument()
  })
})
