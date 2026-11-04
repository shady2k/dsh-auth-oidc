# Security

## Experimental support

Only DSH `0.2.2-rc.1` with the separate Connection browser-auth extension is the verified target. Unmodified rc1 and other DSH versions are not supported. This project has not received an independent security audit.

Every admitted identity receives the **shared DSH owner's complete authority**, including commands, files, credentials, and configuration. This is not multi-user isolation. Keep the admission group small and retain a native recovery session while testing.

## Reporting a vulnerability

Use the repository's [private vulnerability reporting](https://github.com/shady2k/dsh-auth-oidc/security/advisories/new) if GitHub offers it. If it is unavailable, open an issue requesting a private contact method **without disclosing the vulnerability or sensitive details**. Do not assume that an issue or discussion is private.

Never attach client secrets, ID/access tokens, authorization codes, cookies, callback URLs containing codes, launch-token links, credential exports, or DSH profile/home backups. Redact them before sharing logs. Reproduction using a disposable local identity provider is preferred.

## Session and deployment limitations

See [session behavior](<README.md#session-behavior>) and [known limitations](<README.md#known-limitations>). Removing an authentik group member does not immediately revoke existing DSH sessions or connected sockets. Native launch tokens, browser cookies, and API credentials remain independently valid; this plugin does not enforce exclusive IdP access.
