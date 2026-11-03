#!/usr/bin/env node
// E2E: Playwright happy path over the running app (Phase 1 fills in the hop steps).
import { chromium } from 'playwright'

const base = process.env.BASE_URL || 'http://127.0.0.1:6600'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(base)
await page.waitForLoadState('networkidle')
const title = await page.textContent('h1')
if (!/one hop at a time/i.test(title)) {
  console.error(`unexpected h1: ${title}`)
  process.exit(1)
}
console.log(`e2e ok: ${title}`)
await browser.close()
