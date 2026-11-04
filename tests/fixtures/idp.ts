/** Isolated HTTPS OIDC issuer with real signed tokens and PKCE validation. */
import { createHash, randomBytes } from 'node:crypto'
import { type Server, request as httpRequest } from 'node:http'
import { createServer } from 'node:https'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { generate } from 'selfsigned'

export const clientId = 'dsh-test-client'
export const clientSecret = 'test-only-client-secret'

interface Authorization {
  nonce: string
  challenge: string
  redirect: string
  subject: string
  groups: string[]
}

/** Bind a loopback test listener atomically and return its authority. */
export async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test listener')
  return `127.0.0.1:${address.port}`
}

/** Release listener and keep-alive sockets. */
export async function close(server: Server | undefined): Promise<void> {
  if (!server?.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error)
    else resolve()
  }))
}

/** Send real raw HTTP headers without fetch's forbidden Host rewriting. */
export function request(url: string, headers: Record<string, string>, method = 'GET'): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: unknown) => {
        if (typeof chunk === 'string') chunks.push(Buffer.from(chunk))
        else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
        else reject(new TypeError('Expected a byte or text HTTP response chunk'))
      })
      response.once('error', reject)
      response.once('end', () => {
        const headers = new Headers()
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!)
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode!, headers }))
      })
    })
    req.once('error', reject)
    req.end()
  })
}

/** Select the name/value pairs from a browser response. */
export function cookies(response: Response): string[] {
  return response.headers.getSetCookie().map(value => value.split(';', 1)[0]!)
}

/** Read an absolute redirect, failing with the observed status when absent. */
export function location(response: Response): URL {
  const value = response.headers.get('location')
  if (!value) throw new Error(`Expected redirect, received ${response.status}`)
  return new URL(value)
}

/** Owns signing keys, per-flow codes, HTTPS trust, and its listener; optionally commits an interactive authorization document. */
export async function startIdp(options: { authorizationPage?: boolean } = {}) {
  const previousCAs = getCACertificates('default')
  const certificate = generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048, days: 1, algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
    ],
  })
  setDefaultCACertificates([...previousCAs, certificate.cert])
  let server: Server | undefined
  try {
    const keyPair = await generateKeyPair('RS256', { extractable: true })
    const otherKeyPair = await generateKeyPair('RS256')
    const jwk = { ...await exportJWK(keyPair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
    const state = {
      subject: 'owner-subject', groups: ['dsh-owners'], wrongNonce: false, wrongSignature: false,
      tokenRequests: 0, codes: new Map<string, Authorization>(),
    }
    server = createServer({ key: certificate.private, cert: certificate.cert }, (request, response) => {
      void (async () => {
        const url = new URL(request.url ?? '/', issuer)
        response.setHeader('content-type', 'application/json')
        if (url.pathname === '/.well-known/openid-configuration') {
          response.end(JSON.stringify({
            issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'], subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic'], authorization_response_iss_parameter_supported: true,
          }))
        } else if (url.pathname === '/jwks') {
          response.end(JSON.stringify({ keys: [jwk] }))
        } else if (url.pathname === '/authorize') {
          if (url.searchParams.get('client_id') !== clientId || url.searchParams.get('response_type') !== 'code'
            || url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('Invalid authorization parameters')
          const code = randomBytes(24).toString('base64url')
          state.codes.set(code, {
            nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!,
            redirect: url.searchParams.get('redirect_uri')!, subject: state.subject, groups: [...state.groups],
          })
          const redirect = new URL(url.searchParams.get('redirect_uri')!)
          redirect.searchParams.set('code', code)
          redirect.searchParams.set('state', url.searchParams.get('state')!)
          redirect.searchParams.set('iss', issuer)
          if (options.authorizationPage) {
            const target = redirect.href.replaceAll('&', '&amp;')
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            response.end(`<!doctype html><title>Test identity provider</title><a href="${target}">Sign in to DSH</a>`)
          } else {
            response.writeHead(302, { location: redirect.href })
            response.end()
          }
        } else if (url.pathname === '/token') {
          state.tokenRequests++
          const chunks: Buffer[] = []
          for await (const received of request) {
            const chunk: unknown = received
            if (typeof chunk === 'string') chunks.push(Buffer.from(chunk))
            else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
            else throw new TypeError('Expected a byte or text HTTP request chunk')
          }
          const body = new URLSearchParams(Buffer.concat(chunks).toString())
          const authorization = state.codes.get(body.get('code') ?? '')
          state.codes.delete(body.get('code') ?? '')
          const verifier = body.get('code_verifier')
          if (!authorization || !verifier
            || request.headers.authorization !== `Basic ${Buffer.from(`${clientId.replaceAll('-', '%2D')}:${clientSecret.replaceAll('-', '%2D')}`).toString('base64')}`
            || body.get('grant_type') !== 'authorization_code' || body.get('redirect_uri') !== authorization.redirect
            || createHash('sha256').update(verifier).digest('base64url') !== authorization.challenge) {
            response.writeHead(400)
            response.end(JSON.stringify({ error: 'invalid_grant' }))
            return
          }
          const idToken = await new SignJWT({ nonce: state.wrongNonce ? 'wrong-nonce' : authorization.nonce, groups: authorization.groups })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(clientId)
            .setSubject(authorization.subject).setIssuedAt().setExpirationTime('5m').sign(state.wrongSignature ? otherKeyPair.privateKey : keyPair.privateKey)
          response.end(JSON.stringify({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 300, id_token: idToken }))
        } else { response.writeHead(404); response.end('{}') }
      })().catch((error: unknown) => {
        response.writeHead(500)
        response.end(JSON.stringify({ error: String(error) }))
      })
    })
    const issuer = `https://${await listen(server)}`
    return { issuer, state, async dispose() {
      try { await close(server) } finally { setDefaultCACertificates(previousCAs) }
    } }
  } catch (error) {
    try { await close(server) } finally { setDefaultCACertificates(previousCAs) }
    throw error
  }
}
