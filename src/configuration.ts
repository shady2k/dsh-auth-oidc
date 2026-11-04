/** Deployment settings shared as data types, never secret literals. */
import type { Config as RuntimeConfig } from './index.ts'
import { OidcFailure, type OidcIssue } from './issues.ts'
export { issueCodes, type OidcIssue } from './issues.ts'

/** Persisted settings; enabling is separate from the bundle's activation. */
export interface OidcSettings extends RuntimeConfig { enabled: boolean }

/** Safe defaults leave login disabled until the owner explicitly enables it. */
export const defaults: OidcSettings = {
  enabled: false, issuer: '', publicUrl: '', clientId: '', clientSecretRef: 'DSH_OIDC_CLIENT_SECRET',
  allowedSubjects: [], allowedGroups: [], groupsClaim: 'groups', scopes: ['openid', 'profile'],
  loginMaxAgeSeconds: 300, sessionMaxAgeSeconds: 28800, maxPendingLogins: 256,
  maxSessions: 1024, requestTimeoutSeconds: 15,
}

/** Reject incomplete enabled configurations without admitting anyone.
 * @param config - candidate plain settings.
 */
export function validateEnabled(config: OidcSettings): void {
  const issue = configurationIssue(config)
  if (issue) throw new OidcFailure(issue)
}

/** Return the first actionable configuration defect without exposing input values.
 * @param config - effective settings, including staged form values.
 * @returns a fixed issue code, or undefined for disabled or valid settings.
 */
export function configurationIssue(config: OidcSettings): OidcIssue | undefined {
  if (!config.enabled) return
  for (const field of ['issuer', 'publicUrl'] as const) {
    let url: URL
    try { url = new URL(config[field]) } catch (_error) { return field }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return field
    if (field === 'publicUrl' && (!url.pathname.endsWith('/') || /%|\/\/|\/(?:\.|\.\.)(?:\/|$)/.test(url.pathname))) return field
  }
  if (!config.clientId.trim()) return 'clientId'
  if (!config.groupsClaim.trim()) return 'groupsClaim'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.clientSecretRef)) return 'clientSecretRef'
  if ((!config.allowedSubjects.length && !config.allowedGroups.length)
    || [...config.allowedSubjects, ...config.allowedGroups].some(value => !value.trim())) return 'allowlist'
  if (!config.scopes.includes('openid') || config.scopes.some(value => !value || /\s/.test(value))) return 'scopes'
}

/** Actual lifecycle state; enabled configuration alone never means active login. */
export interface OidcStatus {
  phase: 'disabled' | 'starting' | 'active' | 'waiting' | 'failed'
  /** Fixed owner-actionable problem; absent when none is known. */
  issue?: OidcIssue
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    authOidc: { status(): Promise<import('@deepseek-ai/dsh-typert-protocol').RemoteResult<OidcStatus>> }
  }
}
