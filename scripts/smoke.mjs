#!/usr/bin/env node
// Smoke: start nothing; assert the built app + health shape exist.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const checks = [
  [`${root}web/dist/index.html`, 'web build missing (npm run build)'],
  [`${root}server/src/app.js`, 'server app missing'],
]
for (const [file, msg] of checks) {
  if (!fs.existsSync(file)) {
    console.error(msg)
    process.exit(1)
  }
}
console.log('smoke ok')
