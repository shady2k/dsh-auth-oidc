/** Browser plugin registering the OIDC page in the existing Plugins surface. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { z } from 'zod'
import setupStyles from './setup.css'
import { Card } from './Card.tsx'
import { CardController } from './controller.ts'
import { en, zh, type LocaleKey } from './locales.ts'
import { issueCodes, type OidcSettings } from '../configuration.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.oidc': LocaleKey }
}

/** Host settings namespace (Loader entry id). */
export const SETTINGS_NS = 'auth-oidc-settings'
/** Locale, settings, credentials, and slot providers. */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/** Register only while the Host actually serves the settings owner.
 * @param ctx - Client plugin context.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {} // Node-based lifecycle tests have no stylesheet target.
    const style = document.createElement('style')
    style.textContent = setupStyles
    document.head.append(style)
    return () => { style.remove() }
  }, 'oidc: setup table styles')
  const unmount = await ctx.remote.$mount({ package: 'dsh-auth-oidc', descriptors: [{
    id: 'dsh-auth-oidc#authOidc/status', service: 'authOidc', namespace: 'authOidc', method: 'status',
    invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: 'dsh-auth-oidc#OidcStatus', create: () => z.object({
      phase: z.enum(['disabled', 'starting', 'active', 'waiting', 'failed']),
      issue: z.enum(issueCodes).optional(),
    }).strict() },
  }] })
  ctx.effect(() => unmount, 'oidc: status namespace')
  const t = ctx.locale.bind('settings.oidc')
  ctx.effect(() => ctx.locale.register('settings.oidc', { en, zh }), 'oidc: dictionaries')
  await ctx.inject(['remote.authOidc'], ctx => {
    ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => {
      const card = new CardController(ctx.configForms.get<OidcSettings>(SETTINGS_NS), ctx,
        typeof document === 'undefined' ? undefined : document.baseURI)
      const remove = ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item', id: 'auth-oidc', order: 30, label: () => t('title'), locale: 'settings.oidc',
        inject: () => card.inject(),
      }, Card))
      const removeCredential = ctx.remote.$on('credentials/reference-updated', () => { void card.refreshCredential() })
      const timer = setInterval(() => { void card.refreshStatus() }, 2000)
      void card.refreshStatus()
      return () => { clearInterval(timer); removeCredential(); remove(); card.dispose() }
    }), 'oidc: settings page')
  })
}
