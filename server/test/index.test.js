import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('scaffold', () => {
  it('health returns demo-health/1 ready', async () => {
    const res = await request(createApp()).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.app).toBe('demo-health/1')
    expect(res.body.state).toBe('ready')
  })

  it('info reports mock mode with an honest banner', async () => {
    const res = await request(createApp()).get('/api/info')
    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('mock')
    expect(res.body.banner).toMatch(/Simulation/)
  })
})
