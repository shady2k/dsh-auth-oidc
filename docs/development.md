# Standalone development and verification

`dsh-auth-oidc` is an unofficial standalone package. No sibling repository is needed to install its locked dependencies, compile, run the isolated Host/bundle/compatibility suite, or pack it. Nothing here publishes a package, creates a remote repository, or edits a DSH profile.

## Package-only loop

Use Node.js `>=24.9.0` and pnpm from this package root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm test
pnpm pack
pnpm run check:packed
```

`pnpm test` covers the package's declared test files; the focused settings suite additionally verifies the always-active owner and staged form lifecycle. The Host protocol suite supplies a test-owned Connection surface; it does not establish compatibility with a released Host. `pnpm pack` runs the prepack build and package/runtime-closure check. Install the resulting local archive through DSH's plugin manager `install_bundle`; follow the [installation instructions](<../README.md#build-and-install-locally>) and configure it through the GUI.

The package root exposes the always-active settings owner; `dsh-auth-oidc/runtime` exposes the authentication implementation, and `dsh-auth-oidc/configure` aliases the owner. The bundle must use the bare package name: rc1 Client discovery does not recognize Host subpath entries. The Host runtime uses schemastery, openid-client, and the DSH credentials service; the configurator also uses Cordis lifecycle state and Typert Remote status. The Client is built separately against DSH's existing settings primitives, locale, slots, store, and Remote APIs. Host-only modules, Node built-ins, and openid-client must not enter the browser bundle. Shared Cordis and DSH services are supplied by the real Host, not bundled as replacement services.

## Real integration prerequisite

The integration target is official **DSH `0.2.2-rc.1`** with **Connection `0.2.2-rc.1+browser-auth.1`**, a minimal provider-neutral fork of the exact public rc1 source and published client artifacts. Unmodified published Connection lacks `connection.browserAuth`; a matching base version alone does not provide that capability.

`engines.dsh` is a necessary version gate, not a compatibility proof. Plugin activation independently rejects a Connection without `browserAuth.register`, before credential resolution or network discovery. The extension must remain provider-neutral: Connection owns trust and built-in credential precedence; this package owns OIDC policy. Do not move authentik handling into the carrier to make tests pass.

Build and pack the Connection fork separately from the exact public rc1 source. Keep its published browser and Node clients unchanged. Use the same Cordis **`4.1.0` instance/resolution** across the plugin and rc1 service artifacts; duplicate or mismatched Cordis instances can invalidate service/lifecycle behavior. This repository does not silently discover or build a sibling checkout.

Supply the exact built Connection entry explicitly for each integration command:

```sh
DSH_OIDC_CONNECTION_ENTRY=/absolute/path/dsh-connection-browser-auth/package/lib/index.js \
  pnpm run test:integration

DSH_OIDC_CONNECTION_ENTRY=/absolute/path/dsh-connection-browser-auth/package/lib/index.js \
  pnpm run test:browser
```

Replace the absolute placeholder with the actual patched checkout path. The test configuration aliases the Connection package import to that entry only when the variable is supplied. Do not point it at TypeScript source or treat the default installed dependency as patched. Loader integration composes real Loader, credentials-local, WebServer, and Connection with a local signed test IdP; browser verification uses real Chromium navigation and Connection trust checks.

To test the compiled plugin rather than its source, run `pnpm run build` and add `DSH_OIDC_ARTIFACT_TEST=1` to either integration command. `pnpm run check:packed` lists and extracts the local archive, rejects development payload, and imports the extracted Cordis entry using this repository's locked dependencies without changing a DSH profile; it does not test a clean dependency installation.

The Playwright Chromium binary must already be installed. If absent, explicitly install it with `pnpm exec playwright install chromium` (and arrange the operating system libraries it requires) before the browser suite. Dependency installation uses `--ignore-scripts`, so it does not provision Chromium. Browser tests use disposable local HTTPS fixtures, not a production authentik account.

The opt-in standalone form smoke additionally requires an existing DSH source checkout with React DOM and theme dependencies: `DSH_OIDC_VISUAL_RUNTIME_ROOT=/absolute/path/to/checkout pnpm exec vitest run --config tests/fixtures/visual-oidc.config.ts`. It renders the actual Card and installed settings primitives at mobile/desktop widths in light/dark modes, checks interactions and overflow, and retains screenshots in the reported temporary evidence directory. It neither starts a DSH application nor proves integration with its shell.

## Verification strategy

- **Host/protocol:** exercise PKCE/state/nonce and signed ID-token admission, exact issuer/Host checks, failure redaction, credential rotation, bounded pending/session storage, timeout/abort, and disposal cleanup.
- **Bundle/compatibility:** keep the settings owner active with `enabled: false`; reject a missing browser-auth capability before side effects when enabling the runtime. A passing semver check alone must not count as success.
- **Settings:** expose the Plugins page while login is disabled or failed; save credentials before configuration; persist only the reference; derive status from the actual child lifecycle; handle rapid edits, disable, retry, and teardown without leaking registrations or enabling after disposal.
- **Loader integration:** verify activation under real composition, protected index/API access, built-in launch-cookie independence, same-origin logout, and admission/route teardown.
- **Browser:** retain the mounted callback's HTML 200 document and the redirect-only negative control. A mocked HTTP client cannot prove SameSite=Strict or Fetch-Metadata behavior across the IdP redirect chain.
- **Deployment review:** preserve external Host and mount-aware OIDC cookies through the proxy, trust the public authority separately, and forward WebSockets. Review the [security rationale](<decision-original.md>) and [session limitations](<../README.md#known-limitations>) before deployment.

Report package-only and patched integration/browser results separately, including the exact Connection artifact path and Cordis version used. Do not describe successful compilation or isolated tests as released-runtime compatibility, and do not claim a test was run merely because its command is documented.
