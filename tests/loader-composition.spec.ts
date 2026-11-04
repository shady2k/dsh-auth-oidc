/** Real Loader composition: credentials, Connection, WebServer, and signed OIDC owner admission. */
import { copyFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { expect, it, vi } from 'vitest'
import * as configure from '../src/configure.ts'
import type { OidcStatus } from '../src/configuration.ts'
import { cookies, location, request, startIdp } from './fixtures/idp.ts'

/** Only the served document and its protected API payload are test-owned. */
const page = {
  name: 'oidc-test-page',
  inject: ['connection', 'webServer'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: '/',
      handler(req, res) {
        if (!ctx.connection.authorizeIndex(req, res)) return
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><title>DSH owner</title><h1>DSH owner page</h1>')
      },
    }))
    ctx.connection.fetch.register({
      path: '/api/oidc-test', methods: ['GET'], requestBody: 'buffered',
      async fetch() { return Response.json({ owner: true }) },
    })
  },
}

it('boots real browser-auth services from cordis.yml and removes OIDC admissions on disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-oidc-loader-'))
  const directory = await realpath(root)
  const ctx = new Context()
  let idp: Awaited<ReturnType<typeof startIdp>> | undefined
  try {
    idp = await startIdp()
    ctx.provide('oidcTest', { issuer: idp.issuer, credentialsPath: join(directory, '.credentials.yaml') })
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.credentials = LocalCredentials
    ctx.loader.builtins.webserver = WebServer
    ctx.loader.builtins.connection = connection
    ctx.loader.builtins.oidc = process.env.DSH_OIDC_ARTIFACT_TEST === '1'
      ? await import(pathToFileURL(join(process.cwd(), 'lib/configure.js')).href)
      : configure
    ctx.loader.builtins.page = page
    // Store the test secret before mounting its consumer, using the real provider's file format.
    await writeFile(join(directory, '.credentials.yaml'), 'version: 1\nrefs:\n  OIDC_TEST_SECRET: test-only-client-secret\n', { mode: 0o600 })
    const configPath = join(directory, 'cordis.yml')
    await copyFile(new URL('./fixtures/cordis.yml', import.meta.url), configPath)
    const includeId = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.resolve(includeId).fiber!.await()
    await ctx.loader.await()
    const entries = [...ctx.loader.entries()]
    for (const id of ['credentials', 'webserver', 'connection', 'oidc', 'page']) {
      const entry = entries.find(entry => entry.options.id === id)
      expect(entry, `Loader entry ${id}`).toBeDefined()
      // Cordis declares a const enum: its ACTIVE value is 2, with no runtime enum export.
      expect(entry?.fiber?.state, `Loader entry ${id} activation`).toBe(2)
    }
    const settingsEntry = entries.find(entry => entry.options.id === 'oidc')!
    const settingsOwner = settingsEntry.fiber
    const status = () => (ctx.get('authOidc') as { status(): OidcStatus }).status()
    await vi.waitFor(() => { expect(status()).toEqual({ phase: 'active' }) })
    const origin = ctx.webServer.getOrigin()
    const headers = { host: 'dsh.example' }
    const get = (path: string, cookie?: string, extra: Record<string, string> = {}) =>
      request(`${origin}${path}`, { ...headers, ...(cookie ? { cookie } : {}), ...extra })
    const first = await get('/')
    expect(first.status).toBe(303)
    expect(location(first).href).toBe('https://dsh.example/auth/oidc/login')
    expect((await get('/api/oidc-test')).status).toBe(401)
    expect((await get('/?token=wrong')).status).toBe(401)
    const login = await get('/auth/oidc/login')
    expect(login.status).toBe(303)
    const authorize = await fetch(location(login), { redirect: 'manual' })
    expect(authorize.status).toBe(302)
    const callback = location(authorize)
    const completed = await get(callback.pathname + callback.search, cookies(login).join('; '), { 'sec-fetch-site': 'cross-site' })
    expect(completed.status).toBe(200)
    expect(await completed.text()).toContain('https://dsh.example/')
    expect(completed.headers.get('cache-control')).toBe('no-store')
    const session = cookies(completed).find(value => !value.includes('_login_'))!
    expect(session).toBeTruthy()
    expect((await get('/', session)).status).toBe(200)
    expect(await (await get('/api/oidc-test', session)).json()).toEqual({ owner: true })
    // Built-in launch credentials remain independently usable before and after OIDC disposal.
    const launch = new URL(ctx.connection.authenticatedUrl('https://dsh.example/'))
    const builtin = await get(launch.pathname + launch.search)
    expect(builtin.status).toBe(303)
    const builtinCookie = cookies(builtin).join('; ')
    expect((await get('/api/oidc-test', builtinCookie)).status).toBe(200)
    const loggedOut = await request(`${origin}/auth/oidc/logout`, { ...headers, cookie: `${session}; ${builtinCookie}`, origin: 'https://dsh.example' }, 'POST')
    expect(loggedOut.status).toBe(200)
    expect(loggedOut.headers.getSetCookie()).toHaveLength(1)
    expect(loggedOut.headers.get('set-cookie')).toContain(session.split('=')[0])
    expect((await get('/api/oidc-test', session)).status).toBe(401)
    expect((await get('/api/oidc-test', builtinCookie)).status).toBe(200)
    // Obtain another OIDC session so teardown is observed against a live credential.
    const again = await get('/auth/oidc/login')
    const authorizedAgain = await fetch(location(again), { redirect: 'manual' })
    const callbackAgain = location(authorizedAgain)
    const completedAgain = await get(callbackAgain.pathname + callbackAgain.search, cookies(again).join('; '))
    expect(completedAgain.status).toBe(200)
    const liveSession = cookies(completedAgain).find(value => !value.includes('_login_'))!
    expect((await get('/api/oidc-test', liveSession)).status).toBe(200)
    // Changing volatile deployment settings restarts only the auth child and revokes its sessions.
    await settingsEntry.update({ config: { ...settingsEntry.options.config, sessionMaxAgeSeconds: 121 } })
    await vi.waitFor(() => { expect(status()).toEqual({ phase: 'active' }) })
    expect(settingsEntry.fiber).toBe(settingsOwner)
    expect((await get('/api/oidc-test', liveSession)).status).toBe(401)
    // Reproduce an already-saved enabled form with both admission lists empty.
    const acceptedConfig = { ...settingsEntry.options.config }
    await settingsEntry.update({ config: { ...acceptedConfig, allowedSubjects: [], allowedGroups: [] } })
    await vi.waitFor(() => { expect(status()).toEqual({ phase: 'failed', issue: 'allowlist' }) })
    expect(settingsEntry.fiber).toBe(settingsOwner)
    expect(settingsOwner!.state).toBe(2)
    expect((await get('/')).status).toBe(401)
    expect((await get('/auth/oidc/login')).status).toBe(404)
    expect((await get('/api/oidc-test', builtinCookie)).status).toBe(200)
    await settingsEntry.update({ config: acceptedConfig })
    await vi.waitFor(() => { expect(status()).toEqual({ phase: 'active' }) })
    expect((await get('/')).status).toBe(303)
    // A missing saved credential fails only the runtime, not the settings owner.
    await settingsEntry.update({ config: { ...settingsEntry.options.config, clientSecretRef: 'OIDC_RETRY_SECRET' } })
    await vi.waitFor(() => { expect(status()).toEqual({ phase: 'failed', issue: 'credential' }) })
    expect(settingsOwner!.state).toBe(2)
    expect((await get('/auth/oidc/login')).status).toBe(404)
    // Saving the selected credential retries unchanged enabled settings without a manual restart.
    await ctx.credentials.set(credentialRef('OIDC_RETRY_SECRET'), 'test-only-client-secret')
    await vi.waitFor(() => { expect(status()).toEqual({ phase: 'active' }) })
    expect((await get('/')).status).toBe(303)
    await settingsEntry.update({ config: { ...settingsEntry.options.config, enabled: false } })
    await vi.waitFor(() => { expect(status()).toEqual({ phase: 'disabled' }) })
    expect(settingsEntry.fiber).toBe(settingsOwner)
    expect(settingsOwner!.state).toBe(2)
    expect((await get('/auth/oidc/login')).status).toBe(404)
    expect((await get('/auth/oidc/logout')).status).toBe(404)
    expect((await get('/', liveSession)).status).toBe(401)
    expect((await get('/api/oidc-test', liveSession)).status).toBe(401)
    expect((await get('/api/oidc-test', builtinCookie)).status).toBe(200)
    expect(idp.state.tokenRequests).toBe(2)
    await settingsOwner!.dispose()
    expect(ctx.get('authOidc')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await idp?.dispose()
    // directory is the canonical path returned by realpath for this test's freshly owned temp root.
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
