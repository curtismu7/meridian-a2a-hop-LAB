// The vendored run-observability files (rule 27) match run-observability.sha256 byte for byte. They come from curtismu7/AI-DEMO-Standalone
// shared/run-observability: change them there, re-vendor (every file, the pin and scripts/run-observability-checkPin.mjs together); never edit
// them here. The one pin check is the shared helper, itself vendored byte for byte; no hash and no file list is hard-coded in this test.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { checkPin } from '../../scripts/run-observability-checkPin.mjs'

const labRoot = path.join(process.cwd(), '..')

describe('vendored run-observability', () => {
  it('the pin check finds no problem (an edited, missing-from-the-pin or unreadable file fails)', () => {
    expect(checkPin(labRoot)).toEqual([])
  })

  it('this lab reads logs in Real, so it vendors both server files, and nothing else named runObservability*', () => {
    expect(fs.existsSync(path.join(labRoot, 'server/src/runObservability.js'))).toBe(true)
    expect(fs.existsSync(path.join(labRoot, 'server/src/runObservabilityReaders.js'))).toBe(true)
    expect(fs.existsSync(path.join(labRoot, 'web/src/run-observability/runObservability.js'))).toBe(false)
  })
})
