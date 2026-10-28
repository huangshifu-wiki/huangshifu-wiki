import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { csrfMiddleware } from '../../src/server/middleware/csrf'

function createApp(authSource: 'api_key' | 'cookie') {
  const app = express()
  app.use((req, _res, next) => {
    const authReq = req as express.Request & {
      authUser?: { uid: string }
      authSource?: 'api_key' | 'cookie'
    }
    authReq.authUser = { uid: 'user-1' }
    authReq.authSource = authSource
    next()
  })
  app.use(csrfMiddleware)
  app.get('/read', (_req, res) => res.json({ ok: true }))
  app.post('/write', (_req, res) => res.json({ ok: true }))
  return app
}

describe('CSRF authentication sources', () => {
  it('allows API-key requests without setting or requiring an XSRF cookie', async () => {
    const app = createApp('api_key')

    const read = await request(app).get('/read')
    const write = await request(app).post('/write')

    expect(read.status).toBe(200)
    expect(read.headers['set-cookie']).toBeUndefined()
    expect(write.status).toBe(200)
    expect(write.headers['set-cookie']).toBeUndefined()
  })

  it('continues requiring double-submit CSRF for cookie sessions', async () => {
    const response = await request(createApp('cookie')).post('/write')

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('CSRF_MISSING')
  })
})
