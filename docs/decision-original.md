# Standalone OIDC security rationale

This is the current security rationale for the unofficial standalone [dsh-auth-oidc package](<../README.md>), not a historical monorepo decision or an official DSH ownership claim.

## Authority and scope

The purpose is to open a remote DSH browser using authentik without transferring a launch-token URL or trusting proxy-injected identity headers. An admitted OIDC identity becomes the **same full owner** as the shared DSH browser Peer: files, commands, credentials, and configuration are all in scope. This is not multi-user isolation, role-based authorization, or a per-user sandbox.

Admission is **additive**, not exclusive. Launch-token URLs, built-in browser cookies, and API operator credentials remain independently authoritative. Deployments requiring mandatory IdP enforcement for every access path need a separate policy design; enabling this plugin does not supply one.

## Standalone boundary and compatibility

The plugin owns authentik configuration, credentials references, OIDC protocol handling, allowlist policy, transactions, and local sessions. A provider-neutral, caller-scoped Connection browser-auth registration admits those sessions. Connection retains Host/Origin/Fetch-Metadata trust checks, built-in token precedence, and protected HTTP/WebSocket admission. WebServer only carries exact raw routes. The bundle must not replace these services or embed authentik-specific branches into them.

The verified target is DSH `0.2.2-rc.1` with the separately patched Connection `0.2.2-rc.1+browser-auth.1` and matching Cordis `4.1.0`. Unmodified published rc1 Connection lacks the extension. The declared `engines.dsh` version is necessary but insufficient: activation also rejects a missing `connection.browserAuth.register` before credential access, discovery, or route registration. Installing the plugin cannot upgrade Connection. See [integration verification](<development.md#real-integration-prerequisite>).

The bundle installs the always-active `auth-oidc-settings` owner with `enabled: false`. Configure it through the GUI; enabling starts a separate disposable authentication child. Failure of that child leaves the settings owner editable. Secrets remain in the credentials provider, and profile settings contain only a `clientSecretRef` reference. Local build/pack and plugin-manager installation do not publish a package.

## Protocol and owner admission

A maintained OIDC library performs confidential-client authorization code flow with PKCE S256, state, nonce, `client_secret_basic`, and cryptographically verified signed ID tokens. Discovery metadata must report the **exact configured HTTPS issuer**, including trailing slash. The issuer identifier is not the discovery-document URL.

The only authorization criteria are exact issuer-local subjects or exact group strings in a configured **signed ID-token array claim**, ORed together. At least one explicit allowlist must be nonempty. UserInfo-only groups, unsigned data, email similarity, and proxy identity headers do not establish ownership. Scope/property mappings must actually put the selected groups claim in the signed ID token.

Single-use login transactions bind state, nonce, and PKCE to a random HttpOnly, Secure, SameSite=Lax browser cookie. The transaction is consumed before token exchange, including when exchange subsequently fails. Client credentials are resolved at activation and again on every exchange; raw secrets are not configuration fields or retained session credentials. Fixed error messages avoid returning provider response bodies, authorization codes, tokens, or claims. Pending/session capacity and upstream deadlines bound retained work, not an unlimited login service.

## Deployment trust and cookie paths

Both `issuer` and `publicUrl` require HTTPS. A canonical trailing-slash `publicUrl` defines the external callback URI, cookie mount, and exact Host comparison. Forwarded identity, host, and scheme headers never define authority. Configuring `publicUrl` does not trust its authority in Connection: use an independent trusted-host setting and preserve the external Host, including a non-default port when applicable.

For an external `/ui/` mount, the reverse proxy strips that prefix before forwarding raw routes, preserves external Host, and forwards WebSocket upgrades. The upstream listener must be reachable only through the trusted proxy/network. OIDC cookies already carry `Secure` and the external mount path even over an HTTP upstream. Do not apply built-in DSH cookie path rewrites to OIDC cookies; built-in cookies have their own separate Secure/path requirements.

OIDC session cookies are opaque random bearers, HttpOnly, Secure, SameSite=Strict, host-only, and mount-scoped. Only their hashes and absolute expirations are retained in Host memory. A local session expires at the earlier of its configured absolute budget and the signed ID token's expiry; tokens are not persisted or refreshed.

## Why callback HTML 200 is required

The exact raw callback route intentionally accepts a cross-site IdP return, but only for the configured Host and a valid browser-bound transaction. This narrow route is not a global exception to Connection's application trust checks.

A successful callback sets the Strict session cookie and commits a minimal **application-origin HTML 200 document** with restrictive CSP, no-store, and no-referrer headers. That document navigates to the fixed configured application base, with a fallback link. Committing it ends the cross-site IdP redirect chain before the subsequent same-origin request sends its Strict cookie and passes Fetch-Metadata checks. An HTTP redirect alone does not provide that boundary. Do not solve the redirect-chain problem by relaxing SameSite or globally allowing cross-site application requests. Real browser verification, including a redirect-only negative control, protects this requirement.

## Lifecycle, logout, and revocation limits

Disposal aborts upstream requests, clears in-memory transactions/sessions, removes route/provider registrations, and awaits active route operations. Restart and disposal therefore require a new login; there is no shared session store for multiple Host processes.

Logout requires a same-origin POST with an exact matching Origin and clears only that local OIDC session cookie. It does **not** end authentik SSO, invalidate built-in DSH cookies/API credentials, or disconnect an already admitted socket. Existing sockets also survive session expiry or plugin disposal. Close tabs/disconnect sockets or restart the Host when immediate revocation is required.

Allowlist and authentik account/group changes affect new logins, not existing local sessions. There is no periodic group revalidation, refresh-token renewal, UserInfo-based authorization, IdP-initiated/back-channel logout, or logout button. Short absolute session budgets reduce future reconnect authority but do not revoke live sockets.

## Alternatives deliberately not adopted

- **Proxy forward-auth with identity headers:** creates a separate proxy identity trust boundary instead of native application-owned OIDC verification.
- **Provider-specific Connection/WebServer behavior:** puts credentials and authentik policy in generic carriers rather than this optional plugin.
- **Replacing launch-token/API authority:** changes recovery and automation policy and would require explicit exclusive-authentication design.
- **Persisting or refreshing IdP tokens:** adds durable/renewable authority where a bounded in-memory local bearer suffices; the tradeoff is re-login after restart and no immediate IdP revocation.

These boundaries and limitations remain deployment obligations, not promises that the plugin turns DSH into a multi-tenant service.
