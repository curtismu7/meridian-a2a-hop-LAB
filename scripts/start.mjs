#!/usr/bin/env node
// Start: build web if missing, then run the server.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = `${root}web/dist/index.html`

if (!fs.existsSync(dist)) {
  console.log('web/dist missing - building web first...')
  const b = spawnSync('npm', ['run', 'build', '-w', 'web'], { stdio: 'inherit', cwd: root })
  if (b.status !== 0) process.exit(b.status ?? 1)
}

spawnSync('node', ['server/src/index.js'], { stdio: 'inherit', cwd: root })
