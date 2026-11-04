/** Real cross-site OIDC navigation through Connection's trust checks and Strict session cookies. */
import { ServerResponse, type OutgoingHttpHeaders, type OutgoingHttpHeader } from 'node:http'
import { createServer } from 'node:https'
import { Context, Service } from '@deepseek-ai/cordis'
import * as connection from '@deepseek-ai/dsh-client-connection'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { WebRoute, WebResourceRoute } from '@deepseek-ai/dsh-host-webserver'
import { chromium } from 'playwright'
import { generate } from 'selfsigned'
import { expect, it, onTestFinished } from 'vitest'
import * as oidc from '../src/index.ts'
import { clientId, clientSecret, close, listen, startIdp } from './fixtures/idp.ts'

it.each([false, true])('finishes cross-site login with a committed callback document (force HTTP redirect: %s)', async (forceRedirect) => {
  const idp = await startIdp({ authorizationPage: true })
  onTestFinished(() => idp.dispose())
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const routes = new Map<string, WebRoute>()
  const requests: { path: string; site: string | undefined; cookie: string | undefined; status: number }[] = []
  let record: CredentialRecord | undefined
  class CredentialsStub extends Service {
    constructor(owner: Context) { super(owner, 'credentials') }
    async resolve() { return { value: clientSecret, source: 'test' } }
    async modifyRecord(
      _key: string,
      mutate: (current: CredentialRecord | undefined) => CredentialRecord | undefined | Promise<CredentialRecord | undefined>,
    ) {
      record = await mutate(record) ?? record
      return record
    }
  }
  new CredentialsStub(ctx)
  const certificate = generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048, days: 1, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }],
  })
  class CallbackResponse extends ServerResponse {
    override writeHead(
      statusCode: number,
      statusMessage?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
      headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
    ): this {
      // Preserve the actual browser request and session cookies while reproducing a redirect-only callback.
      if (forceRedirect && statusCode === 200 && this.req.url?.startsWith('/mount/auth/oidc/callback?')) {
        this.setHeader('location', publicUrl)
        statusCode = 303
      }
      return typeof statusMessage === 'string'
        ? super.writeHead(statusCode, statusMessage, headers)
        : super.writeHead(statusCode, statusMessage)
    }
  }
  const app = createServer({ key: certificate.private, cert: certificate.cert, ServerResponse: CallbackResponse }, (request, response) => {
    const path = new URL(request.url ?? '/', 'https://localhost').pathname
    response.on('finish', () => requests.push({
      path, site: typeof request.headers['sec-fetch-site'] === 'string' ? request.headers['sec-fetch-site'] : undefined,
      cookie: request.headers.cookie, status: response.statusCode,
    }))
    const route = routes.get(path.replace(/^\/mount/, ''))
    if (route) {
      void Promise.resolve(route.handler(request, response)).catch(() => {
        response.writeHead(500)
        response.end('Test route failed')
      })
    } else if (path === '/mount/') {
      if (ctx.connection.authorizeIndex(request, response)) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>DSH owner page</title><h1>Authenticated DSH owner</h1>')
      }
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  onTestFinished(() => close(app))
  const authority = await listen(app)
  const publicUrl = `https://localhost:${new URL(`https://${authority}`).port}/mount/`
  ctx.provide('webServer', {
    host: '127.0.0.1', port: Number(new URL(publicUrl).port), protocol: 'https:',
    register(route: WebRoute | WebResourceRoute) {
      if (!('handler' in route)) throw new Error('Expected a raw HTTP route')
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  } as WebServer)
  const connectionFiber = ctx.plugin(connection)
  onTestFinished(() => connectionFiber.dispose())
  await connectionFiber.await()
  const oidcFiber = ctx.plugin(oidc, {
    issuer: idp.issuer, publicUrl, clientId, clientSecretRef: 'OIDC_TEST_SECRET', allowedSubjects: ['owner-subject'], allowedGroups: [],
    groupsClaim: 'groups', scopes: ['openid', 'profile'], loginMaxAgeSeconds: 300, sessionMaxAgeSeconds: 120,
    maxPendingLogins: 4, maxSessions: 4, requestTimeoutSeconds: 10,
  })
  onTestFinished(() => oidcFiber.dispose())
  await oidcFiber.await()
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await page.goto(publicUrl)
  await page.getByRole('link', { name: 'Sign in to DSH' }).waitFor()
  expect(new URL(page.url()).origin).toBe(idp.issuer)
  const callbackResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/mount/auth/oidc/callback')
  await Promise.all([
    page.waitForURL(publicUrl, { waitUntil: 'load' }),
    page.getByRole('link', { name: 'Sign in to DSH' }).click(),
  ])
  const callback = await callbackResponse
  const callbackRequest = requests.find(request => request.path === '/mount/auth/oidc/callback')
  expect(callbackRequest?.site).toBe('cross-site')
  expect(callbackRequest?.cookie).toContain('__Secure-dsh_oidc_login_')
  expect(idp.state.tokenRequests).toBe(1)
  const landing = requests.filter(request => request.path === '/mount/').at(-1)
  expect(landing).toBeDefined()
  if (forceRedirect) {
    expect(callback.status()).toBe(303)
    expect(callbackRequest?.status).toBe(303)
    expect(landing?.site).toBe('cross-site')
    expect(landing?.cookie).toBeUndefined()
    expect(landing?.status).toBe(403)
  } else {
    expect(callback.status()).toBe(200)
    expect(callback.headers()['cache-control']).toBe('no-store')
    expect(callback.headers()['content-security-policy']).toContain("default-src 'none'")
    expect(landing?.site).toBe('same-origin')
    expect(landing?.cookie).toMatch(/__Secure-dsh_oidc_[^=;]+=.+/)
    expect(landing?.cookie).not.toContain('_login_')
    expect(landing?.status).toBe(200)
    expect(await page.getByRole('heading', { name: 'Authenticated DSH owner' }).count()).toBe(1)
    const sessions = (await context.cookies(publicUrl)).filter(cookie => cookie.name.startsWith('__Secure-dsh_oidc_'))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ sameSite: 'Strict', secure: true, httpOnly: true, path: '/mount/' })
  }
}, 30_000)
