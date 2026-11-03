#!/usr/bin/env node
// Doctor: quick environment check. Exit 0 when the app can run.
import { spawnSync } from 'node:child_process'

const major = Number(process.versions.node.split('.')[0])
if (major < 26) {
  console.error(`Node 26+ required (found ${process.versions.node})`)
  process.exit(1)
}
console.log(`node ${process.versions.node} ok`)

for (const ws of ['server', 'web']) {
  const r = spawnSync('node', ['--eval', '""'], { cwd: new URL(`../${ws}`, import.meta.url).pathname })
  if (r.error) {
    console.error(`${ws}: missing`)
    process.exit(1)
  }
}
console.log('workspaces ok')
console.log('mock mode needs no settings; real mode reads MERIDIAN_* from the shared env (owner-run)')
