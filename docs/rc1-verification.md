# rc1 integration verification

## Deployment evidence

On 2026-11-04, the deployment owner confirmed successful browser login with a real authentik account after adding that account to the dedicated `dsh-owners` group. The active target was DSH `0.2.2-rc.1` with patched Connection `0.2.2-rc.1+browser-auth.1` and plugin `0.1.3`. This is a user-confirmed end-to-end outcome on one deployment, not an automated production-GUI test or evidence for other releases. No identity tokens, credentials, or deployment addresses are published here. Version `0.1.4` changes distribution metadata, documentation, and example domains, not the authentication implementation.

The sections below distinguish earlier isolated fixture evidence from that later deployment confirmation. They are not a claim that every historical check was rerun for the release candidate.

## 0.1.4 release-candidate checks

On 2026-11-05 (Europe/Moscow), Node `24.21.0`, pnpm `11.7.0`, and a 512 MiB Node heap were used for these standalone checks:

- Frozen lockfile validation, build, and strict typecheck passed.
- All 53 package tests passed across eight files with one worker and no file parallelism.
- Artifact-mode Loader integration passed against the compiled Connection fork: one test using real Loader, credentials-local, WebServer, Connection, and a local signed IdP.
- Prepack runtime closure and extracted-archive Cordis imports/NodeNext consumer declarations passed. The extracted check reused the local locked dependencies; it was not a clean install.
- The exact Connection patch passed `git apply --check` against the public rc1 source. High-signal sensitive-marker scans of nonignored source and packed files reported no matches; no comprehensive secret scanner or independent security audit was completed.

No browser/visual suite was rerun for this documentation/metadata release. The GitHub Actions package-only job is prepared but has not run remotely. No public push, release, npm publication, live runtime change, or restart was performed during preparation.

## Target

Official DSH `0.2.2-rc.1`, Cordis `4.1.0`, and the provider-neutral Connection fork `0.2.2-rc.1+browser-auth.1`. The fork is built from tag commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; published browser and Node client artifacts are unchanged. The independent OIDC plugin owns authentik discovery, protocol handling, admission policy, cookies, and sessions.

Connection archive SHA256: `ea6f43851e27374169d499bb5f5c3612b4219d472c4fb4d83115865c659e97fc`.

## Completed checks

On 2026-11-04, the OIDC runtime source passed strict TypeScript compilation after installing exact public rc1 DSH service packages, Cordis `4.1.0`, and Schemastery `3.19.0`.

With `DSH_OIDC_CONNECTION_ENTRY` pointing to the fork's compiled JavaScript entry:

- 20 tests passed across Host protocol, missing-capability compatibility, bundle composition, and real Loader composition.
- Two real Chromium tests passed: the HTML callback landing admits the browser, while the redirect-only negative control reproduces the cross-site cookie/trust rejection.
- The Loader composition creates real Connection, WebServer, and credentials services, mounts the settings owner enabled, completes a signed test-provider login, and exercises index/API and native authentication. Volatile settings edits revoke OIDC sessions without replacing the owner. A missing credential fails only the auth child; saving that reference retries unchanged settings. Disabling removes auth routes while keeping the owner editable; disposal removes status.

The Connection build report independently records 114 source Host tests, 32 compiled node-half tests, strict Host/test compilation, public NodeNext consumer compilation, and an extracted-tarball activation/trust/disposal smoke.

The staged rc1 `ClientModuleRegistry` recognized the corrected bare package-root row, resolved its browser artifact, and served its revisioned bundle with HTTP 200 through an in-memory Connection fixture. Materializing the lazy factory requested only platform-provided zod, UI primitives, and React JSX runtime. A Host entry using only the `/configure` subpath is not discoverable by that registry; the bundle therefore mounts `dsh-auth-oidc`, whose root exports the safe settings owner.

A standalone Chromium fixture rendered the actual Card and published rc1 settings primitives at 390 px and 1280 px in light/dark modes. Twelve initial/error/credential-state scans found no horizontal overflow. Password-field semantics, blank initial secret, keyboard switching, edit/reset, invalid-number blocking, save/saving state, runtime status, read-only, and unavailable notices passed. This fixture supplies existing checkout React/runtime dependencies and theme CSS; it is not the production application shell. Screenshots were captured, but this session's image reader cannot perform a visual image review.

## Browser environment

The initial Chromium launch failed because Nix did not expose `libglib-2.0.so.0` to the downloaded browser. Supplying the existing Nix runtime libraries fixed launch; both browser tests then passed. No browser test was skipped or changed to hide that failure.

```bash
libs=(/nix/store/*-{glib,nspr,nss,atk,at-spi2-atk,at-spi2-core,dbus,libx11,libxcomposite,libxdamage,libxext,libxfixes,libxrandr,mesa,libgbm,expat,libxcb,libxkbcommon,systemd,systemd-minimal,alsa-lib}-*/lib)
export LD_LIBRARY_PATH="$(IFS=:; printf '%s' "${libs[*]}")"
DSH_OIDC_CONNECTION_ENTRY=/absolute/path/dsh-connection-browser-auth/package/lib/index.js \
  node --max-old-space-size=1024 node_modules/vitest/vitest.mjs run \
  tests/oidc.browser.e2e.ts --maxWorkers=1 --no-file-parallelism
```

## Limits

The configuration companion and Client passed build, strict settings/test compilation, package closure checks, and 31 standalone tests: 12 protocol, six capability compatibility, one bundle, five settings-owner, six controller, and one Remote namespace mount test. Controller checks include secret-first writes, missing/read-only credential handling, stale reference changes, and disposal during pending writes; the mount check enforces strict status fields and namespace cleanup ordering. Extracted archive imports and NodeNext package-name consumers passed. These checks do not render the production GUI. The settings-model tests execute the exact published pure model region, avoiding unrelated browser-only primitive imports in Node.

The browser fixtures use a local signed identity provider, not a production authentik account. Those fixture results alone establish no production authentik login, production GUI configuration workflow, runtime restart, or final deployment; the later user-confirmed deployment result is recorded separately above. The isolated release's CLI reports `0.2.2-rc.1`, its Connection resolves to the fork, and its native POSIX file lock successfully acquires a disposable lock; this is not full application boot evidence.

Builds and tests were scoped, with one Vitest worker and a 1024 MiB Node heap for OIDC. No full monorepo build or exhaustive GUI suite was run.
