# v0.1.4 — experimental authentik login for DSH

Unofficial standalone plugin for native authentik OIDC browser login, configured through the DSH GUI. Open the normal DSH URL on another device instead of transferring a launch-token link.

## Read before installing

**Stock DSH `0.2.2-rc.1` is incompatible.** This release targets DSH `0.2.2-rc.1` with a separately prepared Connection `0.2.2-rc.1+browser-auth.1` and Cordis `4.1.0`. The plugin archive does not patch or upgrade DSH. See the [exact source patch and runtime prerequisite](https://github.com/shady2k/dsh-auth-oidc/tree/main/compat).

Every admitted identity becomes a **full shared owner of the DSH instance**, not an isolated user. Other native access methods remain valid. Existing connected sockets are not disconnected by OIDC logout, expiry, or group removal. Review the [security limitations](https://github.com/shady2k/dsh-auth-oidc/blob/v0.1.4/SECURITY.md).

## Setup

1. Have a DSH maintainer prepare and verify the compatible runtime; keep native owner recovery available.
2. Download `dsh-auth-oidc-0.1.4.tgz` when attached to this release, verify it against `SHA256SUMS`, and ask the DSH agent to install the absolute local archive through `plugin_manager` → `install_bundle`.
3. Open **Plugins → Authentik / OIDC**. Configure the provider, write-only secret, and public URL using the [setup guide](https://github.com/shady2k/dsh-auth-oidc/blob/v0.1.4/README.md#configure-authentik).
4. Create `dsh-owners` in authentik and **add your actual sign-in user**. Include the profile mapping and claims in the ID token; request `openid profile`. Allow only that exact group in DSH.
5. Enable and save, wait for active runtime status, then test the plain application URL in a private window. Keep your native owner session open until the test succeeds.

## Evidence and limits

The source package has focused Host, configuration, and Client-model tests, extracted-archive import/type checks, and real Loader integration against the patched Connection. A deployment owner confirmed real authentik login and group admission. Automated browser fixtures use a local signed test provider; they are not a cross-version compatibility matrix or independent security audit. See [verification details](https://github.com/shady2k/dsh-auth-oidc/blob/v0.1.4/docs/rc1-verification.md).

No npm publication, stock-runtime compatibility, or upstream acceptance is implied by this release. The upstream extension proposal is already tracked in [DSH discussion #11419](https://github.com/deepseek-ai/deepseek-harness/discussions/11419#discussioncomment-19399659).
