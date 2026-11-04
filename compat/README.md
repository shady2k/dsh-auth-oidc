# Connection browser-auth prerequisite

This experimental plugin does **not** work with unmodified DSH `0.2.2-rc.1`. It needs a separately prepared DSH runtime whose Host Connection exposes `connection.browserAuth.register`. Installing the OIDC bundle does not replace that runtime or its Connection service.

## Exact inputs

- Base: public [DSH `dsh-v0.2.2-rc.1`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.1), commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`.
- Extension: [connection-browser-auth.patch](<connection-browser-auth.patch>), SHA256 `bb7998de1d1fafbee1fe2ff1f36f2fbd772a2c0eab2e535c1831871b315179c0`.
- Tested Connection package version: `0.2.2-rc.1+browser-auth.1`.
- Cordis: one shared `4.1.0` resolution; DSH service packages: `0.2.2-rc.1`.

The patch changes four Connection source files and its owning Host tests. It adds a provider-neutral registration point; it contains no authentik configuration, credentials, OIDC implementation, or replacement browser client.

## Runtime preparation is a separate deployment operation

A DSH maintainer must apply the patch to the exact base source, build a compatible runtime using that release's build instructions, and verify that the **Host process actually resolves the patched Connection**. Merely adding the patched package to a profile does not replace an already resolved or loaded runtime service. Keep the published browser and Node clients compatible, and avoid duplicate Cordis instances.

Do this in an isolated build/deployment directory, not by editing the running installation or its profile manifest. Retain the previous runtime and a native owner recovery path. Switching the runtime requires a planned restart; the OIDC GUI cannot perform this upgrade. This repository does not provide an automatic runtime installer or an official DSH release.

Before deploying, run the Connection tests and this plugin's real Loader/artifact checks described in [development](<../docs/development.md#real-integration-prerequisite>). A version check alone is not evidence of the required capability. After switching, verify native owner access first, then install the OIDC plugin through the DSH Plugin Manager and follow the [setup guide](<../README.md#configure-authentik>).

The upstream proposal has already been posted in [DSH discussion #11419](https://github.com/deepseek-ai/deepseek-harness/discussions/11419#discussioncomment-19399659). It is a proposal, not an accepted or released API. Do not assume support in newer DSH versions without verifying it.

## Redistribution

The patch modifies MIT-licensed DeepSeek Harness code. The original [MIT notice](<../LICENSE>) is retained. This is an unofficial integration, not an endorsed DeepSeek or authentik release. The patch is kept in the source repository rather than silently applied by the npm bundle.
