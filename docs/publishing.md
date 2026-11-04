# Maintainer publication checklist

Public source, GitHub releases, npm publication, and DSH market registration are separate operations. This repository is unofficial. None of the package scripts publish anything. Do not contact upstream again merely to announce this preparation; the extension proposal already exists.

## Experimental GitHub release

1. Review all tracked source, examples, release notes, archive contents, and the Connection deployment prerequisite for credentials or private deployment data. Automated marker searches are not a comprehensive secret/security audit.
2. Run the [package checks](<development.md#package-only-loop>), `pnpm run typecheck`, and artifact-mode Loader integration with the explicit patched Connection entry. Run browser tests when browser or authentication behavior changes. Do not describe the package-only CI job as testing patched-runtime deployment.
3. Pack the exact version, run `pnpm run check:packed`, and retain its SHA256. Changing documentation or metadata changes the package hash even without runtime changes.
4. Obtain the owner's explicit approval before the first public push or release. Push the reviewed `main` commit to `shady2k/dsh-auth-oidc`, create the version tag from that same commit, and create a GitHub **prerelease** using the [0.1.4 notes](<release-0.1.4.md>).
5. Attach only `dsh-auth-oidc-0.1.4.tgz`, the reviewed `connection-browser-auth.patch`, and `SHA256SUMS`. Never attach profile directories, credentials, environment files, home backups, local build logs, or the unreviewed runtime tree.
6. Verify the published tree, release tag, download links, and checksums. Enable GitHub private vulnerability reporting if desired; the [security policy](<../SECURITY.md>) does not assume it is enabled.

The source patch is not an automatic runtime installer. Readers must understand that stock DSH rc1 cannot use the plugin without a separately prepared runtime. Do not label the release as generally compatible until upstream provides a supported API and it is verified.

## Optional npm publication

Requires separate owner authorization, npm account access, and availability/ownership of the package name. No npm name availability check or registry publication is implied by the GitHub repository.

The manifest defaults publication to the public npm registry with the **`next`** tag. If publishing is approved, publish the already verified archive with an explicit `--tag next`, not `latest`; compare registry integrity and install metadata afterward. Do not expose npm tokens in shell history, Git, logs, or chat.

A bare `npm install` does not configure DSH, and publishing to npm does not add the plugin to a DSH market. Market indexing is a separate opt-in step with its own supported manifest and configured source.
