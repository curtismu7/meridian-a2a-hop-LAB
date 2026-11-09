// Opened from Customer Agent LAB: the strip and the header Back button show; nothing is preselected (one fixed walkthrough).
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import App from './App.jsx'

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })

describe('return link', () => {
  it('?from=customer-agent shows the strip and two Back buttons that name the use case', () => {
    window.history.replaceState(null, '', '/?from=customer-agent&uc=UC2.5&vertical=banking')
    render(<App />)
    expect(screen.getByRole('note', { name: 'Opened from Customer Agent LAB' }).textContent).toContain('UC2.5')
    expect(screen.getAllByRole('button', { name: /Back to Customer Agent LAB/ })).toHaveLength(2)
    const strip = screen.getByRole('note', { name: 'Opened from Customer Agent LAB' })
    expect(strip.previousElementSibling).toHaveClass('banner') // banner first, strip right below
    const headerBack = document.querySelector('header.topbar > button.return-link--header')
    expect(headerBack).not.toBeNull() // in the shell bar's actions, not inside the title block
  })

  it('no from, an unknown from or a bad id: no strip, no button', () => {
    for (const q of ['/', '/?from=elsewhere&uc=UC2.5', '/?from=customer-agent&uc=a%20b']) {
      window.history.replaceState(null, '', q)
      render(<App />)
      expect(screen.queryByRole('button', { name: /Back to/ })).toBeNull()
      cleanup()
    }
  })

  it('the vendored files match return-link.sha256, which names the parent commit', () => {
    const dir = path.join(process.cwd(), 'src', 'return-link')
    const text = fs.readFileSync(path.join(dir, 'return-link.sha256'), 'utf8')
    expect(text.split('\n')[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/)
    const pins = text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/))
    expect(pins.map(([, f]) => f).sort()).toEqual(['ReturnLink.jsx', 'ReturnLink.test.jsx', 'returnTargets.js'])
    for (const [h, f] of pins) expect(createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'), f).toBe(h)
  })
})
