/** Fixed diagnostics shared by configuration, activation, and the settings UI. */
export const issueCodes = ['issuer', 'publicUrl', 'clientId', 'groupsClaim', 'clientSecretRef', 'allowlist', 'scopes',
  'credential', 'discovery', 'issuerMismatch', 'runtime'] as const

/** Safe diagnostic identifiers; never include upstream messages, claims, or credentials. */
export type OidcIssue = typeof issueCodes[number]

/** Expected activation failure retaining only a fixed diagnostic code. */
export class OidcFailure extends Error {
  constructor(readonly issue: OidcIssue) { super(`OIDC: ${issue}`) }
}
