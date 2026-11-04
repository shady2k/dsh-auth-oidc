---
description: "Unofficial standalone authentik OIDC browser login for DSH with explicit full-owner admission."
kind: "package-reference"
---

# dsh-auth-oidc

English | [中文](<README.zh.md>)

## Summary

**Unofficial, experimental DSH plugin** for native authentik OpenID Connect browser login, maintained by [shady2k](https://github.com/shady2k/dsh-auth-oidc). Requires the separate Connection browser-auth extension described below; **unmodified DSH `0.2.2-rc.1` is not supported**. Configure authentik and owner admission through the DSH GUI without copying launch-token URLs between devices.

An admitted identity receives the shared DSH owner's complete authority, including files, commands, credentials, and configuration. **This is not multi-user isolation.** Admission is additive: launch-token URLs, built-in browser cookies, and API operator credentials remain valid alternatives. Enabling OIDC does not require every connection to pass through authentik.

## Table of Contents

- [Compatibility prerequisite](#compatibility-prerequisite)
- [Build and install locally](#build-and-install-locally)
- [Configure authentik](#configure-authentik)
- [Configure DSH](#configure-dsh)
- [Configuration reference](#configuration-reference)
- [Session behavior](#session-behavior)
- [Development](#development)
- [Model experience](#model-experience)
- [Known limitations](#known-limitations)

## Compatibility prerequisite

The integration target is official DSH **`0.2.2-rc.1`** with a temporary, provider-neutral Connection fork **`0.2.2-rc.1+browser-auth.1`** exposing `connection.browserAuth.register`. The unmodified published Connection does not expose that API. This plugin does not replace DSH or embed an authentication proxy.

The package declares `engines.dsh: 0.2.2-rc.1`. This installation/activation version gate is necessary, **not sufficient**: activation also checks for `connection.browserAuth.register` before resolving credentials, performing discovery, or registering routes. Installing this bundle cannot upgrade Connection. Do not bypass a version gate to make an unsupported Host work. Integration uses matching Cordis **`4.1.0`** and rc1 service packages; see [development strategy](<docs/development.md>). The repository includes the [exact Connection patch and deployment prerequisite](https://github.com/shady2k/dsh-auth-oidc/tree/main/compat). This is a maintainer-assisted experimental installation, not a one-click plugin for stock DSH.

## Build and install locally

Use Node.js `>=24.9.0` and pnpm in this standalone package directory:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm pack
```

The standalone build needs no sibling checkout. Packing runs the package's prepack build and runtime/package checks. It produces `dsh-auth-oidc-0.1.4.tgz`; it does not publish it. Alternatively, use the plugin archive from a published [GitHub release](https://github.com/shady2k/dsh-auth-oidc/releases) when available. Do not assume an npm release exists.

Install that archive using the **DSH plugin manager** `install_bundle` operation, with an absolute local path. For example, ask the DSH agent to invoke its `plugin_manager` tool with:

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/dsh-auth-oidc/dsh-auth-oidc-0.1.4.tgz"
}
```

This is a tool invocation, not a shell command. Use the manager's normal approval flow and inspect its result/next step. Do not manually mutate the profile's dependency manifest, lockfile, or resolver through shell package-manager commands. Installation affects the selected DSH profile, which can be shared by several sessions.

The bundle's [install patch](<cordis.patch.yml>) inserts an always-active settings owner with OIDC login disabled:

```yaml
- insert:
    - id: auth-oidc-settings
      name: dsh-auth-oidc
      config:
        enabled: false
```

The browser settings page groups connection, owner admission, and advanced settings, with a compact **Set up authentik** reference and a **Copy** action for every available value, including the exact strict Redirect URI derived from the staged **Public DSH URL**. Copy success is confirmed only after the browser accepts it; clipboard failure leaves the value visible for manual copying. An empty public URL is suggested from the current HTTPS application base, including its mount path, without overwriting existing values or saving anything. Provider credentials and owner identities remain user-supplied; the secret never appears in the table. Installation and prefill do not enable login.

## Configure authentik

Create an OAuth2/OpenID provider and application in authentik. Use a confidential client, authorization code flow, and a signing key. Copy the provider's **exact issuer identifier**, client ID, and client secret. Register the exact redirect URI `https://dsh.example/ui/auth/oidc/callback` for a DSH base URL of `https://dsh.example/ui/`; do not use a wildcard. The plugin uses PKCE S256, query-mode callbacks, and `client_secret_basic` token authentication.

For a simple single-owner setup, use a dedicated authentik group:

1. In **Directory → Groups**, create `dsh-owners`. It does not need superuser privileges or authentik administrative roles.
2. **Add your actual sign-in user to that group.** Creating the group alone does not add members. Use direct membership rather than relying on parent-group inheritance.
3. In the DSH OAuth2/OIDC provider, select **authentik default OAuth Mapping: OpenID 'profile'** under scope mappings and enable **Include claims in id_token**. The default profile mapping supplies group names in `groups`; a UserInfo-only claim does not qualify.
4. In the plugin, leave **Allowed subjects** empty, set **Allowed groups** to `dsh-owners`, **Groups claim** to `groups`, and **Scopes** to `openid, profile`. Add only people who should control the entire DSH instance.

Alternatively, allow exact issuer-local `sub` values with **Allowed subjects**, or configure another **signed ID-token array claim** for group admission. Subject and group lists are ORed, not ANDed: either match grants ownership. Custom mappings may require additional requested scopes.

See the [authentik OAuth2/OpenID provider documentation](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/) for provider creation and mappings.

## Configure DSH

After installing the compatible release and bundle, refresh the existing GUI and open **Plugins → Authentik / OIDC** using your existing owner session. Retain a working native owner session while testing. No YAML edit, restart, or sharing of credentials in chat is required to configure OIDC.

1. Leave **Enable OIDC login** off. Check the suggested **Public DSH URL**, including its mount path and trailing slash, and fill **Issuer URL** and **Client ID**. If no HTTPS URL was suggested, enter it manually, for example `https://dsh.example/ui/`. Use the reference rows’ **Copy** buttons to transfer provider settings.
2. Set **Allowed subjects** or **Allowed groups** to exact comma-separated owner identities. At least one allowlist must be nonempty. Adjust **Groups claim** and **Scopes** to match the authentik ID-token mapping. Enabled drafts with missing required configuration cannot be saved; an inline message identifies the problem. Invalid settings already stored through another path fail closed and report a fixed reason without exposing credentials or upstream responses.
3. Keep the default **Client secret reference**, or choose a valid credentials reference name. Enter the literal secret only in **Client secret**, then select **Save**. The page writes the secret through DSH credentials and stores only its reference in profile settings. An empty secret field keeps the saved value. A writable credentials provider, such as credentials-local, is required for secret entry.
4. Confirm the secret is configured, switch on **Enable OIDC login**, and select **Save** again. Wait for **Runtime status: OIDC login active**. Saving settings does not itself establish successful activation; waiting, failure, and unavailable status remain visible while the settings owner stays editable.

The credential and settings writes are not atomic. If a secret is saved but settings fail, the secret stays saved; fix the reported configuration or storage issue and retry. Do not put the secret in profile YAML or send it to an agent.

The application's existing advertised public URL and Connection trust configuration must already agree with **Public DSH URL**. OIDC settings do not add a trusted Host. Preserve any non-default port consistently in the URL, forwarded Host, and trusted authority. Installing or switching the underlying DSH release may require a separately agreed restart; editing these volatile OIDC settings does not.

Test in a private browser window by opening the plain application URL. An unauthenticated index request redirects to authentik, then returns to DSH with a local browser cookie. No launch token is needed for this flow. The provider must be reachable from the DSH Host for discovery, token exchange, and signing keys; the browser must reach both authentik and the public application URL.

If the callback says **“This identity is not permitted to own this DSH instance.”**, token verification completed but neither admission list matched. Check which user signed in, direct membership in `dsh-owners`, the exact case-sensitive group name, the profile scope mapping, and inclusion of claims in the ID token. After correcting anything, reopen the plain application URL for a new login; do not refresh or share the callback URL. Never paste tokens, authorization codes, or the client secret into an issue or chat.

Both configured URLs require HTTPS. Discovery metadata's issuer must equal the configured `issuer` **exactly**, including any trailing slash; use the issuer identifier, not the discovery-document URL. The external application URL, callback, cookie path, and Host comparison come only from `publicUrl`, never forwarded identity, host, or scheme headers.

For the `/ui/` example, a reverse proxy must preserve the external `Host`, strip `/ui/` before forwarding to DSH, and forward WebSocket upgrades. Restrict the upstream listener to the trusted proxy/network. OIDC cookies already have `Secure` and external `Path=/ui/` even when the upstream listener uses HTTP; **do not apply built-in cookie path rewrites to OIDC cookies**. Existing built-in DSH cookies have separate listener/proxy requirements and may need their own Secure/path handling. Do not confuse the two cookie families or weaken Connection's Host/Origin/Fetch-Metadata checks.

## Configuration reference

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Settings owner stays active; enable the separate login runtime only after configuration |
| `issuer` | empty; required when enabled | Exact HTTPS issuer identifier, not the discovery-document URL |
| `publicUrl` | required | External HTTPS application base with canonical trailing slash; no credentials, query, or fragment |
| `clientId` | empty; required when enabled | Confidential client identifier |
| `clientSecretRef` | `DSH_OIDC_CLIENT_SECRET` | Credentials-service reference, never the literal secret |
| `allowedSubjects`, `allowedGroups` | `[]`, `[]` | Exact full-owner admission lists; at least one must be nonempty; either match admits |
| `groupsClaim` | `groups` | Signed ID-token array claim containing group names |
| `scopes` | `[openid, profile]` | Requested scopes; must contain `openid` |
| `loginMaxAgeSeconds` | `300` | Single-use transaction lifetime, 1–600 seconds |
| `sessionMaxAgeSeconds` | `28800` | Absolute session lifetime, capped by ID-token expiration |
| `maxPendingLogins`, `maxSessions` | `256`, `1024` | Retained transaction/session limits; capacity exhaustion returns 503 |
| `requestTimeoutSeconds` | `15` | Discovery/token/signing-key request deadline, 1–120 seconds |

Missing capabilities or credentials, invalid configuration, or failed discovery prevents plugin activation. A callback protocol or provider failure returns a fixed 502 without exposing tokens, claims, authorization codes, or upstream response bodies. Invalid/expired transactions receive 400, an identity outside the allowlist receives 403, and temporarily unavailable credentials or exhausted capacity receives 503. Reopen the plain application URL to start a new transaction after an error.

## Session behavior

Transactions bind state, nonce, and PKCE to a random HttpOnly, Secure, SameSite=Lax cookie and are consumed before token exchange. Session cookies are opaque, HttpOnly, Secure, SameSite=Strict, host-only (no Domain), and scoped to the configured external mount. The Host stores only hashed session identifiers and absolute expirations in memory. Credentials are resolved again for every token exchange.

A successful callback returns a minimal **HTML 200 document at the application origin**, then navigates to the configured application base. Committing that document ends the cross-site IdP redirect chain before the next same-origin request sends its Strict cookie and passes Fetch-Metadata checks. Do not replace it with an HTTP redirect, loosen SameSite, or exempt all application requests from trust checks.

A same-origin `POST` to `auth/oidc/logout` relative to the application base revokes that OIDC browser session and clears its cookie; it requires an exact matching `Origin` header. There is no logout button. For example, run this in the browser console on the DSH origin:

```js
await fetch(new URL('auth/oidc/logout', document.baseURI), { method: 'POST' })
```

**Close existing DSH tabs to disconnect active sockets.** Logout does not revoke built-in cookies, API credentials, or the authentik login; visiting DSH again can immediately sign in through authentik SSO.

## Development

See [development strategy and verification](<docs/development.md>) and the [standalone security rationale](<docs/decision-original.md>). The plugin owns OIDC protocol handling and registers one caller-scoped generic Connection browser-auth provider. Connection retains trust checks and built-in token precedence; WebServer only carries exact raw routes. Disposal aborts upstream fetches, clears retained state, removes registrations, and awaits active route operations.

The authentication runtime uses schemastery, openid-client, and DSH credentials; the settings owner adds Cordis lifecycle and Typert Remote status. The separately built Client reuses DSH's settings primitives, typed locale, slots, store, and Remote APIs. Shared Host and Client services are platform-provided peers, not embedded replacements; Host-only OIDC dependencies do not enter the browser bundle.

## Model experience

None: browser authentication contributes no tools, prompts, or model tokens, and does not change model requests or KV-cache behavior.

## Known limitations

- Sessions and pending logins disappear on restart or plugin disposal. There is no shared session store, refresh-token renewal, UserInfo authorization, IdP-initiated/back-channel logout, or per-request group revalidation.
- Saving changed deployment settings or rotating the selected credential restarts the OIDC child and clears its sessions. Changes only at authentik affect new logins, not existing sessions before expiration/restart. Already admitted sockets remain connected after expiry, logout, or plugin disposal. Use short session budgets and disconnect sockets/restart the Host when immediate revocation is required.
- Authentication grants a shared full owner, not per-user accounts, filesystem permissions, command sandboxing, or tenant isolation. OIDC is not exclusive enforcement while other DSH credentials remain enabled.
- Unmodified published rc1 Connection is incompatible; the required generic Host capability must be supplied separately. The bundle does not patch DSH, provision authentik, or configure a proxy. Package tests are not a security audit or evidence of support for other DSH versions.
