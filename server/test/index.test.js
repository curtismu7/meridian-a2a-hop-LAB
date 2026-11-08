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

  it('shelf: /api/shelf returns SHELF_URL (slash trimmed) with no web build, and POST is not 200', async () => {
    const prev = process.env.SHELF_URL
    process.env.SHELF_URL = 'https://shelf.example:8443/'
    try {
      const res = await request(createApp()).get('/api/shelf')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ shelfUrl: 'https://shelf.example:8443' })
      expect((await request(createApp()).post('/api/shelf').send({})).status).not.toBe(200)
    } finally {
      if (prev === undefined) delete process.env.SHELF_URL
      else process.env.SHELF_URL = prev
    }
  })
})
