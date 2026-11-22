// The vendored run-observability files (rule 27) match run-observability.sha256 byte for byte, and the canonical hashes. They come from
// curtismu7/AI-DEMO-Standalone shared/run-observability: change them there, re-pin, re-vendor; never edit them here. The pin lists the
// server file as plain runObservability.js; it is vendored at server/src/runObservability.js.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const WEB = path.join(process.cwd(), 'src', 'run-observability')
const SERVER = path.join(process.cwd(), '..', 'server', 'src')
const WHERE = {
  'RunObservability.jsx': WEB,
  'run-observability.css': WEB,
  'run-observability.test.jsx': WEB,
  'fixtures.js': WEB,
  'runObservability.js': SERVER,
}
const CANONICAL = {
  'RunObservability.jsx': '30dbd3e4a42f7d2645cb43aebf74470cbc3f7a4e8cec060d8878895157a429b4',
  'run-observability.css': '8d4f66b85181407f4a60b2ce2c828e0aae875d395abafeda9f793ded2a149808',
  'run-observability.test.jsx': 'b31c3e4240112929f79def31059d7294ad6edc16862ed418faef0792a5535c72',
  'runObservability.js': '6128e1cf7cc1481f5addf47e53737908be69fb1c344f6be78d6383401d2ad68d',
  'fixtures.js': 'ac99fb874d20c2d66e747fb38c381089bf6a648669c14331f39ac69d9d5a6ea1',
}
const sha = (file) => createHash('sha256').update(fs.readFileSync(path.join(WHERE[file], file))).digest('hex')

describe('vendored run-observability', () => {
  const pins = fs.readFileSync(path.join(WEB, 'run-observability.sha256'), 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}\s/.test(l)).map((l) => l.split(/\s+/))

  it('all five files are pinned, and each matches its pin and the canonical hash', () => {
    expect(pins.map(([, f]) => f).sort()).toEqual(Object.keys(WHERE).sort())
    for (const [hash, file] of pins) {
      expect(sha(file), `${file} differs from run-observability.sha256 (hand-edited, or re-vendored without re-pinning)`).toBe(hash)
      expect(sha(file), `${file} canonical`).toBe(CANONICAL[file])
    }
  })

  it('the server collector is vendored once, beside the other server modules', () => {
    expect(fs.existsSync(path.join(SERVER, 'runObservability.js'))).toBe(true)
    expect(fs.existsSync(path.join(WEB, 'runObservability.js'))).toBe(false)
  })
})
