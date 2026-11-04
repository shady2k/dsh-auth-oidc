/** Native OIDC browser login; admitted identities share Connection's full-owner browser Peer. */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ConnectionTrustRequest, ConnectionIndexResponse } from '@deepseek-ai/dsh-client-connection'
import { requireBrowserAuth } from './compatibility.ts'
import type {} from '@deepseek-ai/dsh-host-webserver'
import * as oidc from 'openid-client'
import { OidcFailure } from './issues.ts'

/** Loader plugin name. */
export const name = 'host-auth-oidc'
/** Required authentication, credential-resolution, and HTTP route providers. */
export const inject = ['connection', 'credentials', 'webServer']

/** HTTPS deployment, OIDC client, explicit owner allowlist, and bounded session budgets. */
export interface Config {
  /** Issuer identifier, not its discovery-document URL. HTTPS only. */
  issuer: string
  /** External application base URL, including its trailing slash and any proxy mount. HTTPS only. */
  publicUrl: string
  /** Confidential OAuth client identifier. */
  clientId: string
  /** Credential reference for the client secret, resolved again for each token exchange. */
  clientSecretRef: string
  /** Exact issuer-local subject identifiers permitted to become DSH owners. */
  allowedSubjects: string[]
  /** Exact group names permitted to become DSH owners; ORed with allowedSubjects. */
  allowedGroups: string[]
  /** Signed ID-token claim containing an array of group names. */
  groupsClaim: string
  /** Requested scopes; must include openid. */
  scopes: string[]
  /** Lifetime of each browser-bound, single-use login transaction. */
  loginMaxAgeSeconds: number
  /** Absolute session lifetime, additionally capped by ID-token expiration. */
  sessionMaxAgeSeconds: number
  /** Maximum simultaneous pending login transactions. */
  maxPendingLogins: number
  /** Maximum simultaneous authenticated browser sessions. */
  maxSessions: number
  /** Per-request discovery, token, and signing-key HTTP deadline. */
  requestTimeoutSeconds: number
}

/** Validated OIDC configuration; empty owner admission is rejected at activation. */
export const Config: z<Config> = z.object({
  issuer: z.string().required(),
  publicUrl: z.string().required(),
  clientId: z.string().required(),
  clientSecretRef: z.string().required(),
  allowedSubjects: z.array(z.string()).default([]),
  allowedGroups: z.array(z.string()).default([]),
  groupsClaim: z.string().default('groups'),
  scopes: z.array(z.string()).default(['openid', 'profile']),
  loginMaxAgeSeconds: z.number().step(1).min(1).max(600).default(300),
  sessionMaxAgeSeconds: z.number().step(1).min(1).default(28800),
  maxPendingLogins: z.number().step(1).min(1).default(256),
  maxSessions: z.number().step(1).min(1).default(1024),
  requestTimeoutSeconds: z.number().min(1).max(120).default(15),
})

interface LoginTransaction {
  binding: string
  verifier: string
  nonce: string
  expiresAt: number
}

function httpsUrl(value: string, field: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`auth-oidc: ${field} must be an HTTPS URL without credentials, query, or fragment`)
  }
  return url
}

function header(request: ConnectionTrustRequest, key: string): string | undefined {
  const headers = request.headers
  if (headers instanceof Headers) return headers.get(key) ?? undefined
  const value = headers[key]
  return typeof value === 'string' ? value : undefined
}

function cookie(request: ConnectionTrustRequest, name: string): string | undefined {
  const values = (header(request, 'cookie') ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`))
  return values.length === 1 ? values[0]?.slice(name.length + 1) : undefined
}

function random(): string { return randomBytes(32).toString('base64url') }
function digest(value: string): string { return createHash('sha256').update(value).digest('base64url') }

function reply(response: ConnectionIndexResponse, status: number, text: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  })
  response.end(text)
}

/**
 * Register native OIDC login and local sessions without changing launch-token authentication.
 * @param ctx - injected Connection, credentials, and Web carrier.
 * @param config - validated HTTPS deployment and explicit full-owner admission settings.
 * @returns completion after issuer discovery and lifecycle-owned route registration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const browserAuth = requireBrowserAuth(ctx.connection)
  const issuer = httpsUrl(config.issuer, 'issuer')
  const base = httpsUrl(config.publicUrl, 'publicUrl')
  if (!base.pathname.endsWith('/') || /%|\/\/|\/(?:\.|\.\.)(?:\/|$)/.test(base.pathname)) {
    throw new Error('auth-oidc: publicUrl must have a canonical trailing-slash mount path')
  }
  if (!config.clientId.trim() || !config.groupsClaim.trim() || !config.scopes.includes('openid')
    || config.scopes.some(scope => !scope || /\s/.test(scope))
    || ![...config.allowedSubjects, ...config.allowedGroups].some(value => value.length > 0)
    || [...config.allowedSubjects, ...config.allowedGroups].some(value => value.length === 0)) {
    throw new Error('auth-oidc: require clientId, groupsClaim, openid scope, and explicit allowedSubjects or allowedGroups')
  }
  const secretRef = credentialRef(config.clientSecretRef)
  const controller = new AbortController()
  const pending = new Map<string, LoginTransaction>()
  const sessions = new Map<string, number>()
  const operations = new Set<Promise<void>>()
  ctx.effect(() => async () => {
    controller.abort()
    pending.clear()
    sessions.clear()
    await Promise.allSettled(operations)
  })
  let credentialAvailable: boolean
  try {
    credentialAvailable = await ctx.credentials.resolve(secretRef) !== undefined
  } catch (error) {
    // Credential-provider errors can include credential material or backing-store content.
    void error
    throw new OidcFailure('credential')
  }
  if (!credentialAvailable) {
    throw new OidcFailure('credential')
  }
  const isAborted = (): boolean => controller.signal.aborted
  if (isAborted()) return
  const transport: oidc.CustomFetch = (url, options) => fetch(url, {
    ...options,
    body: options.body instanceof Uint8Array ? new Uint8Array(options.body) : options.body ?? null,
    signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]),
  })
  let discovered: oidc.Configuration
  try {
    discovered = await oidc.discovery(issuer, config.clientId, undefined, oidc.None(), {
      timeout: config.requestTimeoutSeconds, [oidc.customFetch]: transport,
    })
  } catch (error) {
    // Discovery errors can contain upstream response bodies; do not expose them in logs.
    void error
    throw new OidcFailure('discovery')
  }
  if (isAborted()) return
  if (discovered.serverMetadata().issuer !== config.issuer) {
    throw new OidcFailure('issuerMismatch')
  }
  const callback = new URL('auth/oidc/callback', base)
  const login = new URL('auth/oidc/login', base)
  const suffix = digest(`${issuer.href}\n${base.href}\n${config.clientId}`).slice(0, 16)
  const sessionCookie = `__Secure-dsh_oidc_${suffix}`
  const loginCookie = `__Secure-dsh_oidc_login_${suffix}`
  const serialize = (key: string, value: string, seconds: number, sameSite: 'Lax' | 'Strict'): string =>
    `${key}=${value}; Path=${base.pathname}; Max-Age=${seconds}; HttpOnly; Secure; SameSite=${sameSite}`
  const sameHost = (request: ConnectionTrustRequest): boolean => header(request, 'host') === base.host
  const authenticated = (request: ConnectionTrustRequest): boolean => {
    if (controller.signal.aborted || !sameHost(request)) return false
    const id = cookie(request, sessionCookie)
    if (!id) return false
    const key = digest(id)
    const expiry = sessions.get(key)
    if (expiry === undefined) return false
    if (expiry <= Date.now()) { sessions.delete(key); return false }
    return true
  }
  const prune = (): void => {
    const now = Date.now()
    for (const [key, transaction] of pending) if (transaction.expiresAt <= now) pending.delete(key)
    for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key)
  }
  const redirect = (response: ConnectionIndexResponse, location: string): void => {
    response.writeHead(303, { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
    response.end()
  }
  browserAuth.register({
    authenticate: authenticated,
    authorizeIndex(request, response) {
      if (!sameHost(request)) return undefined
      if (request.method !== 'GET') { reply(response, 405, 'OIDC login requires GET.'); return false }
      redirect(response, login.href)
      return false
    },
  })

  const route = (path: string, method: 'GET' | 'POST', handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler(req, res) {
      const operation = (async () => {
        if (!sameHost(req)) { reply(res, 403, 'OIDC request Host does not match publicUrl.'); return }
        if (controller.signal.aborted) { reply(res, 503, 'OIDC login is restarting.'); return }
        if (req.method !== method) { res.setHeader('allow', method); reply(res, 405, `OIDC route requires ${method}.`); return }
        try { await handler(req, res) } catch (error) {
          // Keep tokens, codes, claims, and provider response bodies out of diagnostics.
          void error
          if (!res.headersSent) reply(res, 502, 'OIDC login failed. Check provider availability and client configuration, then start a new login.')
        }
      })()
      operations.add(operation)
      void operation.then(() => operations.delete(operation), () => operations.delete(operation))
      return operation
    } }))
  }
  route('/auth/oidc/login', 'GET', async (req, res) => {
    if (header(req, 'sec-fetch-site') === 'cross-site'
      || (header(req, 'origin') !== undefined && header(req, 'origin') !== base.origin)) {
      reply(res, 403, 'Start OIDC login from the DSH application.'); return
    }
    if (authenticated(req)) { redirect(res, base.href); return }
    prune()
    const state = random()
    const binding = random()
    const verifier = oidc.randomPKCECodeVerifier()
    const nonce = oidc.randomNonce()
    const challenge = await oidc.calculatePKCECodeChallenge(verifier)
    if (controller.signal.aborted) { reply(res, 503, 'OIDC login is restarting.'); return }
    if (pending.size >= config.maxPendingLogins) { reply(res, 503, 'Too many pending logins. Retry after existing logins expire.'); return }
    const authorization = oidc.buildAuthorizationUrl(discovered, {
      redirect_uri: callback.href, scope: config.scopes.join(' '), response_type: 'code',
      response_mode: 'query', code_challenge_method: 'S256', code_challenge: challenge, state, nonce,
    })
    pending.set(state, { binding: digest(binding), verifier, nonce, expiresAt: Date.now() + config.loginMaxAgeSeconds * 1000 })
    res.setHeader('set-cookie', serialize(loginCookie, binding, config.loginMaxAgeSeconds, 'Lax'))
    redirect(res, authorization.href)
  })
  route('/auth/oidc/callback', 'GET', async (req, res) => {
    // Only the registered route supplies the path. The public origin never comes from forwarded headers.
    const received = new URL(req.url ?? '/', base)
    const url = new URL(callback)
    url.search = received.search
    const states = url.searchParams.getAll('state')
    const state = states.length === 1 ? states[0] : undefined
    if (!state) { reply(res, 400, 'Invalid OIDC login transaction. Start a new login.'); return }
    const transaction = pending.get(state)
    const binding = cookie(req, loginCookie)
    if (!transaction || !binding || transaction.binding !== digest(binding)) {
      reply(res, 400, 'Invalid OIDC login transaction. Start a new login.'); return
    }
    pending.delete(state)
    res.setHeader('set-cookie', serialize(loginCookie, '', 0, 'Lax'))
    if (transaction.expiresAt <= Date.now()) { reply(res, 400, 'OIDC login expired. Start a new login.'); return }
    const secret = await ctx.credentials.resolve(secretRef)
    if (secret === undefined) { reply(res, 503, 'OIDC client credential is unavailable.'); return }
    const client = new oidc.Configuration(discovered.serverMetadata(), config.clientId, undefined, oidc.ClientSecretBasic(secret.value))
    client[oidc.customFetch] = transport
    client.timeout = config.requestTimeoutSeconds
    oidc.enableNonRepudiationChecks(client)
    const tokens = await oidc.authorizationCodeGrant(client, url, {
      pkceCodeVerifier: transaction.verifier, expectedState: state, expectedNonce: transaction.nonce, idTokenExpected: true,
    })
    const claims = tokens.claims()
    const groups = claims?.[config.groupsClaim]
    const allowed = claims !== undefined && (config.allowedSubjects.includes(claims.sub)
      || (Array.isArray(groups) && groups.some(group => typeof group === 'string' && config.allowedGroups.includes(group))))
    if (!allowed) { reply(res, 403, 'This identity is not permitted to own this DSH instance.'); return }
    if (controller.signal.aborted) { reply(res, 503, 'OIDC login is restarting.'); return }
    prune()
    if (sessions.size >= config.maxSessions) { reply(res, 503, 'Browser session capacity reached. Retry after sessions expire.'); return }
    const expiresAt = Math.min(Date.now() + config.sessionMaxAgeSeconds * 1000, claims.exp * 1000)
    const seconds = Math.floor((expiresAt - Date.now()) / 1000)
    if (seconds <= 0) { reply(res, 403, 'OIDC identity token expired. Start a new login.'); return }
    const id = random()
    const previous = cookie(req, sessionCookie)
    if (previous) sessions.delete(digest(previous))
    sessions.set(digest(id), expiresAt)
    res.setHeader('set-cookie', [serialize(loginCookie, '', 0, 'Lax'), serialize(sessionCookie, id, seconds, 'Strict')])
    // A committed same-origin document ends the IdP redirect chain before Strict cookies and trust checks apply.
    const target = base.href.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    })
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>DSH sign-in complete</title></head><body><a href="${target}">Continue to DSH</a></body></html>`)
  })
  route('/auth/oidc/logout', 'POST', (req, res) => {
    if (header(req, 'origin') !== base.origin || header(req, 'sec-fetch-site') === 'cross-site') {
      reply(res, 403, 'OIDC logout requires a same-origin request.'); return
    }
    const id = cookie(req, sessionCookie)
    if (id) sessions.delete(digest(id))
    res.setHeader('set-cookie', serialize(sessionCookie, '', 0, 'Strict'))
    reply(res, 200, 'OIDC browser session ended. Close existing DSH tabs to disconnect active sessions.')
  })
}
