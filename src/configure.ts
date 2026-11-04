/** Always-active settings owner; the authentication runtime is a disposable child. */
import { type Context, type Fiber, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import * as runtime from './index.ts'
import { OidcFailure, type OidcIssue } from './issues.ts'
import { defaults, validateEnabled, type OidcSettings, type OidcStatus } from './configuration.ts'

/** Loader settings namespace owner. */
export const name = 'auth-oidc-settings'
/** No auth-only dependency may prevent editing disabled or failed configuration. */
export const inject: string[] = []
/** Stable references updated in-place by Loader. */
export type Config = { [K in keyof OidcSettings]: Volatile<OidcSettings[K]> }

/** Every field remains editable while the owner stays active. */
export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  issuer: z.string().default('').volatile(), publicUrl: z.string().default('').volatile(),
  clientId: z.string().default('').volatile(),
  clientSecretRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default(defaults.clientSecretRef).volatile(),
  allowedSubjects: z.array(z.string()).default([]).volatile(), allowedGroups: z.array(z.string()).default([]).volatile(),
  groupsClaim: z.string().default('groups').volatile(), scopes: z.array(z.string()).default(['openid', 'profile']).volatile(),
  loginMaxAgeSeconds: z.number().step(1).min(1).max(600).default(300).volatile(),
  sessionMaxAgeSeconds: z.number().step(1).min(1).default(28800).volatile(),
  maxPendingLogins: z.number().step(1).min(1).default(256).volatile(),
  maxSessions: z.number().step(1).min(1).default(1024).volatile(),
  requestTimeoutSeconds: z.number().min(1).max(120).default(15).volatile(),
})

function plain(config: Config): OidcSettings {
  return {
    enabled: config.enabled.get(), issuer: config.issuer.get(), publicUrl: config.publicUrl.get(),
    clientId: config.clientId.get(), clientSecretRef: config.clientSecretRef.get(),
    allowedSubjects: [...config.allowedSubjects.get()], allowedGroups: [...config.allowedGroups.get()],
    groupsClaim: config.groupsClaim.get(), scopes: [...config.scopes.get()],
    loginMaxAgeSeconds: config.loginMaxAgeSeconds.get(), sessionMaxAgeSeconds: config.sessionMaxAgeSeconds.get(),
    maxPendingLogins: config.maxPendingLogins.get(), maxSessions: config.maxSessions.get(),
    requestTimeoutSeconds: config.requestTimeoutSeconds.get(),
  }
}

/** Read-only owner-authenticated Remote status, containing no upstream errors. */
class OidcStatusService extends TypertRemoteService {
  constructor(ctx: Context, private readonly readStatus: () => OidcStatus) { super(ctx, 'authOidc') }
  @Remote
  status(): OidcStatus { return this.readStatus() }
}

/** Own reconciliation independently of child activation success.
 * @param ctx - the always-active settings context.
 * @param config - volatile deployment settings.
 */
export function apply(ctx: Context, config: Config): void {
  let child: Fiber | undefined
  let phase: OidcStatus['phase'] = 'disabled'
  let issue: OidcIssue | undefined
  let closed = false
  let revision = 0
  let queue = Promise.resolve()
  ctx.plugin(class StatusPlugin {
    constructor(statusCtx: Context) { new OidcStatusService(statusCtx, () => ({
      phase: child ? (child.state === 2 ? 'active'
        : child.state === 0 ? 'waiting' : child.state === 3 ? 'failed' : 'starting')
        : phase,
      ...(issue ? { issue } : {}),
    })) }
  })
  const schedule = () => {
    const target = ++revision
    const candidate = plain(config)
    queue = queue.then(async () => {
      if (closed || target !== revision) return
      phase = 'starting'
      issue = undefined
      const previous = child
      child = undefined
      if (previous) await previous.dispose()
      if (closed || target !== revision) return
      if (!candidate.enabled) { phase = 'disabled'; return }
      validateEnabled(candidate)
      const { enabled: _enabled, ...settings } = candidate
      child = ctx.plugin(runtime, settings)
      // Do not await pending dependencies here: a disable must always be able to dispose them.
      void child.await().catch((error: unknown) => {
        if (!closed && target === revision) {
          phase = 'failed'
          issue = error instanceof OidcFailure ? error.issue : 'runtime'
        }
      })
    }).catch((error: unknown) => {
      if (!closed && target === revision) {
        phase = 'failed'
        issue = error instanceof OidcFailure ? error.issue : 'runtime'
      }
    })
  }
  // Dependencies may arrive after the initial await has already settled in WAITING.
  ctx.on('internal/status', fiber => {
    if (fiber !== child || fiber.state !== 3) return
    const failedChild = child
    void fiber.await().catch((error: unknown) => {
      if (!closed && child === failedChild) {
        phase = 'failed'
        issue = error instanceof OidcFailure ? error.issue : 'runtime'
      }
    })
  })
  ctx.on('loader/volatile-update', schedule)
  ctx.on('credentials/reference-updated', ref => {
    if (ref === config.clientSecretRef.get() && config.enabled.get()) schedule()
  })
  ctx.effect(() => async () => {
    closed = true
    ++revision
    await queue
    await child?.dispose()
    child = undefined
  }, 'oidc: child teardown')
  schedule()
}
