/** Optional Connection extension, kept local until DSH publishes the provider API. */
import type { ConnectionIndexRequest, ConnectionIndexResponse, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection'

/** Browser-session admission; all accepted identities share the DSH owner. */
export interface BrowserAuthProvider {
  /** Authenticate from synchronous local state after Connection's trust checks. */
  authenticate(request: ConnectionTrustRequest): boolean
  /** Answer an unauthenticated index request, or delegate with undefined. */
  authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean | undefined
}

/** Activation stops without credential, network, or registration effects; upgrade Connection before retrying. */
export class UnsupportedConnectionError extends Error {
  readonly code = 'OIDC_UNSUPPORTED_CONNECTION'

  constructor() {
    super('auth-oidc: this DSH Connection lacks browserAuth.register; use a DSH build with the browser-auth-provider extension. Installing this plugin cannot upgrade Connection.')
    this.name = 'UnsupportedConnectionError'
  }
}

/** Singleton registration owned by the caller's Cordis effect. */
interface BrowserAuthRegistry {
  register(provider: BrowserAuthProvider): () => Promise<void>
}

/**
 * Reject released hosts without the additive browser-auth capability before discovery or credentials access.
 * @param connection - Host-supplied Connection service.
 * @returns its browser-auth registration API.
 */
export function requireBrowserAuth(connection: object): BrowserAuthRegistry {
  if (!('browserAuth' in connection) || typeof connection.browserAuth !== 'object' || connection.browserAuth === null
    || !('register' in connection.browserAuth) || typeof connection.browserAuth.register !== 'function') {
    throw new UnsupportedConnectionError()
  }
  return connection.browserAuth as BrowserAuthRegistry
}
