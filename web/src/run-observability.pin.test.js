// The vendored run-observability files (rule 27) match run-observability.sha256 byte for byte. They come from
// curtismu7/AI-DEMO-Standalone shared/run-observability: change them there, re-pin, re-vendor; never edit them here. The pin lists the
// server file as plain runObservability.js; it is vendored at server/src/runObservability.js.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const WEB = path.join(process.cwd(), 'src', 'run-observability')
const SERVER = path.join(process.cwd(), '..', 'server', 'src')
// The pin lists every vendored file; the server modules (runObservability*.js) live in server/src, everything else beside the pin.
// No hash is hard-coded here: a re-vendor from the canonical (files and pin copied together) needs no edit to this test.
const dirOf = (file) => (/^runObservability[\w.-]*\.js$/.test(file) ? SERVER : WEB)
const sha = (file) => createHash('sha256').update(fs.readFileSync(path.join(dirOf(file), file))).digest('hex')

describe('vendored run-observability', () => {
  const pins = fs.readFileSync(path.join(WEB, 'run-observability.sha256'), 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}\s/.test(l)).map((l) => l.split(/\s+/))

  it('the pin lists the panel, its css and test, the fixtures and the server collector', () => {
    const names = pins.map(([, f]) => f)
    for (const f of ['RunObservability.jsx', 'run-observability.css', 'run-observability.test.jsx', 'fixtures.js', 'runObservability.js']) expect(names).toContain(f)
  })

  it('every pinned file exists where it is vendored and matches its pin (an edited copy fails)', () => {
    expect(pins.length).toBeGreaterThan(0)
    for (const [hash, file] of pins) {
      expect(fs.existsSync(path.join(dirOf(file), file)), `${file} is pinned but not vendored`).toBe(true)
      expect(sha(file), `${file} differs from run-observability.sha256 (hand-edited, or re-vendored without its pin)`).toBe(hash)
    }
  })

  it('the server collector is vendored once, beside the other server modules', () => {
    expect(fs.existsSync(path.join(SERVER, 'runObservability.js'))).toBe(true)
    expect(fs.existsSync(path.join(WEB, 'runObservability.js'))).toBe(false)
  })
})
