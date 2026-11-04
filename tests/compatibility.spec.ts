import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { requireBrowserAuth, UnsupportedConnectionError } from '../src/compatibility.ts'

it.each([{}, { browserAuth: null }, { browserAuth: {} }, { browserAuth: { register: false } }])('rejects hosts missing the registration API before side effects', (host) => {
  expect(() => requireBrowserAuth(host)).toThrow(UnsupportedConnectionError)
  expect(() => requireBrowserAuth(host)).toThrow('this DSH Connection lacks browserAuth.register')
})

it('fails plugin activation before touching credentials or routes on an old host', async () => {
  const ctx = new Context()
  try {
    ctx.provide('connection', {})
    ctx.provide('credentials', { resolve() { throw new Error('credentials must not be read') } })
    ctx.provide('webServer', { register() { throw new Error('routes must not be registered') } })
    const fiber = ctx.plugin(plugin, {
      issuer: 'https://auth.example/application/o/dsh/', publicUrl: 'https://dsh.example/',
      clientId: 'dsh', clientSecretRef: 'TEST_SECRET', allowedSubjects: ['owner'],
    })
    await expect(fiber.await()).rejects.toThrow('this DSH Connection lacks browserAuth.register')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('retains the actual caller-scoped registry', () => {
  const browserAuth = { register: () => async () => {} }
  expect(requireBrowserAuth({ browserAuth })).toBe(browserAuth)
})
