# Changelog

## 0.1.4 — experimental release candidate

- Prepare the standalone plugin for public source distribution with repository metadata and an experimental npm `next` default.
- Document the tested `dsh-owners` setup, including direct user membership, profile scope mapping, and ID-token claims.
- Add admission-denied troubleshooting without requesting tokens or secrets.
- Include the exact provider-neutral Connection source patch and explain the separate runtime deployment prerequisite.
- Replace deployment-specific test domains with reserved examples and correct outdated compatibility and settings-owner documentation.

The authentication implementation is unchanged from the locally deployed 0.1.3. This is not a stock-DSH-compatible release or an independent security audit.

## 0.1.3 — local deployment

- Add enabled-draft validation and actionable runtime configuration status.
- Use published DSH settings primitives, compact setup reference rows, and copyable protocol values.
- Verify the real Loader/artifact flow with patched Connection; a deployment owner subsequently confirmed a real authentik browser login and group admission.

Versions through 0.1.3 were local artifacts, not registry releases.
