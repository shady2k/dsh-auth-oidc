/** Real HTTPS discovery, PKCE code exchange, signed claims, and browser-session lifecycle. */
import { createServer as httpServer, type Server } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import type { BrowserAuthProvider as ConnectionBrowserAuthProvider } from '../src/compatibility.ts'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { WebRoute, WebResourceRoute } from '@deepseek-ai/dsh-host-webserver'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { clientId, clientSecret, listen, close, cookies, location, request as rawRequest, startIdp } from './fixtures/idp.ts'

const publicUrl = 'https://dsh.example/mount/'
const publicHost = 'dsh.example'
describe('native OIDC browser authentication', () => {
  let idp: Awaited<ReturnType<typeof startIdp>>
  let app: Server | undefined
  let appUrl: string
  let ctx: Context | undefined
  let fiber: ReturnType<Context['plugin']> | undefined
  let provider: ConnectionBrowserAuthProvider | undefined
  let removed: number
  const routes = new Map<string, WebRoute>()

  beforeAll(async () => { idp = await startIdp() })
  afterAll(async () => { await idp?.dispose() })

  beforeEach(async () => {
    removed = 0
    idp.state.subject = 'owner-subject'
    idp.state.groups = ['dsh-owners']
    idp.state.wrongNonce = false
    idp.state.wrongSignature = false
    idp.state.tokenRequests = 0
    idp.state.codes.clear()
    routes.clear()
    provider = undefined
    ctx = new Context()
    class CredentialsStub extends Service {
      constructor(owner: Context) { super(owner, 'credentials') }
      async resolve() { return { value: clientSecret, source: 'test' } }
    }
    new CredentialsStub(ctx)
    class ConnectionStub extends Service {
      constructor(owner: Context) { super(owner, 'connection') }
      get browserAuth() {
        const owner = this.ctx
        return { register(value: ConnectionBrowserAuthProvider) {
          return owner.effect(() => {
            provider = value
            return () => { provider = undefined; removed++ }
          })
        } }
      }
    }
    new ConnectionStub(ctx)
    ctx.provide('webServer', {
      register(route: WebRoute | WebResourceRoute) {
        if (!('handler' in route)) throw new Error('OIDC routes must own their raw response')
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    } as WebServer)
    app = httpServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/^\/mount/, '')
      const route = routes.get(path)
      if (!route) { response.writeHead(404); response.end(); return }
      void Promise.resolve(route.handler(request, response)).catch(() => {
        response.writeHead(500)
        response.end()
      })
    })
    appUrl = `http://${await listen(app)}`
    fiber = ctx.plugin(plugin, {
      issuer: idp.issuer, publicUrl, clientId, clientSecretRef: 'OIDC_TEST_SECRET', allowedSubjects: [], allowedGroups: ['dsh-owners'],
      groupsClaim: 'groups', scopes: ['openid', 'profile'], loginMaxAgeSeconds: 300, sessionMaxAgeSeconds: 120,
      maxPendingLogins: 4, maxSessions: 4, requestTimeoutSeconds: 10,
    })
    await fiber.await()
    expect(provider).toBeDefined()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fiber?.dispose()
    await ctx?.fiber.dispose()
    await close(app)
    fiber = undefined
    app = undefined
    ctx = undefined
  })

  function request(path: string, cookie?: string, host = publicHost, extraHeaders: Record<string, string> = {}, method = 'GET'): Promise<Response> {
    return rawRequest(`${appUrl}${path}`, { host, ...extraHeaders, ...(cookie ? { cookie } : {}) }, method)
  }

  async function start(): Promise<{ callback: URL; binding: string; authorization: URL }> {
    const login = await request('/mount/auth/oidc/login')
    expect(login.status).toBe(303)
    expect(login.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax')
    expect(login.headers.get('set-cookie')).toContain('Path=/mount/')
    const authorization = location(login)
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${publicUrl}auth/oidc/callback`)
    const authorized = await fetch(authorization, { redirect: 'manual' })
    expect(authorized.status).toBe(302)
    return { callback: location(authorized), binding: cookies(login)[0]!, authorization }
  }

  async function finish(transaction: Awaited<ReturnType<typeof start>>, binding = transaction.binding): Promise<Response> {
    return request(transaction.callback.pathname + transaction.callback.search, binding, publicHost, { 'sec-fetch-site': 'cross-site' })
  }

  function authenticate(cookie: string, host = publicHost): boolean {
    if (!provider) throw new Error('Expected registered provider')
    return provider.authenticate({ headers: { host, cookie } })
  }

  it('rejects a discovery-document URL whose metadata identifies a different issuer', async () => {
    await fiber!.dispose()
    fiber = ctx!.plugin(plugin, {
      issuer: `${idp.issuer}/.well-known/openid-configuration`, publicUrl, clientId,
      clientSecretRef: 'OIDC_TEST_SECRET', allowedSubjects: ['owner-subject'], allowedGroups: [],
      groupsClaim: 'groups', scopes: ['openid'], loginMaxAgeSeconds: 300, sessionMaxAgeSeconds: 120,
      maxPendingLogins: 4, maxSessions: 4, requestTimeoutSeconds: 10,
    })
    await expect(fiber.await()).rejects.toMatchObject({ issue: 'issuerMismatch' })
    expect(provider).toBeUndefined()
    expect(routes.size).toBe(0)
  })

  it('exchanges a browser-bound PKCE code and grants an opaque owner session under the proxy mount', async () => {
    const transaction = await start()
    const completed = await finish(transaction)
    expect(completed.status).toBe(200)
    expect(await completed.text()).toContain(publicUrl)
    expect(completed.headers.get('cache-control')).toBe('no-store')
    const session = cookies(completed).find(cookie => !cookie.includes('_login_'))!
    expect(session).toMatch(/^__Secure-dsh_oidc_[A-Za-z0-9_-]+=([A-Za-z0-9_-]+)$/)
    expect(completed.headers.getSetCookie().some(cookie => cookie.includes('SameSite=Strict'))).toBe(true)
    expect(authenticate(session)).toBe(true)
    expect(authenticate(session, 'attacker.example')).toBe(false)
    expect(authenticate(`${session}; ${session}`)).toBe(false)
    expect(idp.state.tokenRequests).toBe(1)
    expect((await finish(transaction)).status).toBe(400)
    expect(idp.state.tokenRequests).toBe(1)
  })

  it('refuses callbacks relayed without the initiating browser cookie and rejects mismatched state', async () => {
    const transaction = await start()
    expect((await finish(transaction, 'unrelated=browser')).status).toBe(400)
    const changed = new URL(transaction.callback)
    changed.searchParams.set('state', 'wrong-state')
    expect((await finish({ ...transaction, callback: changed })).status).toBe(400)
    expect(idp.state.tokenRequests).toBe(0)
    expect((await finish(transaction)).status).toBe(200)
  })

  it('rejects a signed ID token with the wrong nonce without granting a session', async () => {
    idp.state.wrongNonce = true
    const transaction = await start()
    const completed = await finish(transaction)
    expect(completed.status).toBe(502)
    expect(cookies(completed).some(cookie => !cookie.includes('_login_'))).toBe(false)
    expect((await finish(transaction)).status).toBe(400)
    expect(idp.state.tokenRequests).toBe(1)
  })

  it('rejects a claimed owner whose ID token signature does not match issuer signing keys', async () => {
    idp.state.wrongSignature = true
    const completed = await finish(await start())
    expect(completed.status).toBe(502)
    expect(cookies(completed).some(cookie => !cookie.includes('_login_'))).toBe(false)
    expect(idp.state.tokenRequests).toBe(1)
  })

  it('rejects valid identities outside the explicit owner groups', async () => {
    idp.state.groups = ['ordinary-users']
    const completed = await finish(await start())
    expect(completed.status).toBe(403)
    expect(cookies(completed).some(cookie => !cookie.includes('_login_'))).toBe(false)
    expect(idp.state.tokenRequests).toBe(1)
  })

  it('rejects an authorization code whose PKCE challenge does not match the initiating transaction', async () => {
    const transaction = await start()
    const code = transaction.callback.searchParams.get('code')!
    const grant = idp.state.codes.get(code)!
    idp.state.codes.set(code, { ...grant, challenge: 'unrelated-challenge' })
    const completed = await finish(transaction)
    expect(completed.status).toBe(502)
    expect(cookies(completed).some(cookie => !cookie.includes('_login_'))).toBe(false)
    expect(idp.state.tokenRequests).toBe(1)
  })

  it('expires transactions and sessions according to their absolute lifetimes', async () => {
    const transaction = await start()
    const completed = await finish(transaction)
    const session = cookies(completed).find(cookie => !cookie.includes('_login_'))!
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 121_000)
    expect(authenticate(session)).toBe(false)
    vi.restoreAllMocks()
    const pending = await start()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301_000)
    expect((await finish(pending)).status).toBe(400)
    expect(idp.state.tokenRequests).toBe(1)
  })

  it('rejects spoofed Host and cross-site login initiation but allows the bound IdP callback', async () => {
    expect((await request('/mount/auth/oidc/login', undefined, 'attacker.example')).status).toBe(403)
    expect((await request('/mount/auth/oidc/login', undefined, publicHost, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await request('/mount/auth/oidc/login', undefined, publicHost, { origin: 'https://attacker.example' })).status).toBe(403)
    const transaction = await start()
    expect((await request(transaction.callback.pathname + transaction.callback.search, transaction.binding, 'attacker.example')).status).toBe(403)
    expect(idp.state.tokenRequests).toBe(0)
    expect((await finish(transaction)).status).toBe(200)
  })

  it('requires exact same-origin POST logout and clears only the selected OIDC session', async () => {
    const session = cookies(await finish(await start())).find(cookie => !cookie.includes('_login_'))!
    const otherSession = cookies(await finish(await start())).find(cookie => !cookie.includes('_login_'))!
    const path = '/mount/auth/oidc/logout'
    expect((await request(path, session)).status).toBe(405)
    expect((await request(path, session, publicHost, {}, 'POST')).status).toBe(403)
    expect((await request(path, session, publicHost, { origin: 'https://attacker.example' }, 'POST')).status).toBe(403)
    expect((await request(path, session, publicHost, { origin: 'https://dsh.example', 'sec-fetch-site': 'cross-site' }, 'POST')).status).toBe(403)
    expect(authenticate(session)).toBe(true)
    const loggedOut = await request(path, `${session}; dsh_builtin=unrelated`, publicHost, { origin: 'https://dsh.example', 'sec-fetch-site': 'same-origin' }, 'POST')
    expect(loggedOut.status).toBe(200)
    expect(loggedOut.headers.getSetCookie()).toHaveLength(1)
    expect(loggedOut.headers.get('set-cookie')).toContain(`${session.split('=')[0]}=;`)
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(loggedOut.headers.get('set-cookie')).toContain('SameSite=Strict')
    expect(loggedOut.headers.has('location')).toBe(false)
    expect(authenticate(session)).toBe(false)
    expect(authenticate(otherSession)).toBe(true)
    expect(idp.state.tokenRequests).toBe(2)
  })

  it('bounds pending browser transactions and does not discard existing owner sessions when full', async () => {
    const transactions = []
    for (let index = 0; index < 4; index++) transactions.push(await start())
    expect((await request('/mount/auth/oidc/login')).status).toBe(503)
    const sessions = []
    for (const transaction of transactions) {
      const completed = await finish(transaction)
      expect(completed.status).toBe(200)
      sessions.push(cookies(completed).find(cookie => !cookie.includes('_login_'))!)
    }
    const overflow = await finish(await start())
    expect(overflow.status).toBe(503)
    expect(cookies(overflow).every(cookie => cookie.includes('_login_'))).toBe(true)
    for (const session of sessions) expect(authenticate(session)).toBe(true)
  })

  it('removes routes and provider sessions when the plugin fiber is disposed', async () => {
    const completed = await finish(await start())
    const session = cookies(completed).find(cookie => !cookie.includes('_login_'))!
    const captured = provider!
    expect(authenticate(session)).toBe(true)
    await fiber!.dispose()
    expect(routes.size).toBe(0)
    expect(provider).toBeUndefined()
    expect(removed).toBe(1)
    expect(captured.authenticate({ headers: { host: publicHost, cookie: session } })).toBe(false)
    expect((await request('/mount/auth/oidc/login')).status).toBe(404)
  })
})
