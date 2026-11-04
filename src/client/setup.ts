/** Derive the callback displayed in setup instructions from the staged public URL.
 * @param publicUrl - External application base entered in the form.
 * @returns Exact runtime callback, or undefined until the base is a valid HTTPS mount.
 */
export function setupCallback(publicUrl: string): string | undefined {
  let base: URL
  try { base = new URL(publicUrl) }
  catch (_error) { return undefined } // Incomplete form input has no usable callback.
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || !base.pathname.endsWith('/') || /%|\/\/|\/(?:\.|\.\.)(?:\/|$)/.test(base.pathname)) return undefined
  return new URL('auth/oidc/callback', base).href
}

/** Suggest the current HTTPS application mount without carrying launch tokens or navigation state.
 * @param documentBase - Browser document.baseURI, including the Host's base element.
 * @returns Clean HTTPS mount, or undefined if it cannot be used as a public URL.
 */
export function suggestedPublicUrl(documentBase: string): string | undefined {
  let base: URL
  try { base = new URL(documentBase) }
  catch (_error) { return undefined } // A missing or malformed document base cannot seed configuration.
  base.search = ''
  base.hash = ''
  return setupCallback(base.href) ? base.href : undefined
}

/** Non-secret form values used to generate the setup table. */
export interface SetupValues {
  publicUrl: string
  clientSecretRef: string
  groupsClaim: string
  scopes: string
}

/** Derive copyable protocol values and current drafts without inventing provider credentials.
 * @param values - Current staged deployment values, excluding the write-only secret.
 * @returns Ordered, nonlocalized table values; missing or invalid values cannot be copied.
 */
export function setupRows(values: SetupValues) {
  return [
    { label: 'publicUrl', value: setupCallback(values.publicUrl) ? values.publicUrl : undefined },
    { label: 'callbackLabel', value: setupCallback(values.publicUrl) },
    { label: 'setupClientType', value: 'Confidential' },
    { label: 'setupRedirectMode', value: 'Strict' },
    { label: 'setupFlow', value: 'authorization_code' },
    { label: 'setupPkce', value: 'S256' },
    { label: 'setupTokenAuth', value: 'client_secret_basic' },
    { label: 'clientSecretRef', value: values.clientSecretRef || undefined },
    { label: 'scopes', value: values.scopes.split(/[\s,]+/).filter(Boolean).join(' ') || undefined },
    { label: 'groupsClaim', value: values.groupsClaim || undefined },
  ] as const
}
