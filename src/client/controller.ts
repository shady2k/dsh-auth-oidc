/** Staged OIDC form; credential writes precede settings writes and never enter Config. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { configurationIssue, defaults, type OidcIssue, type OidcSettings, type OidcStatus } from '../configuration.ts'
import { suggestedPublicUrl } from './setup.ts'

/** Strings edited as text; allowlists use one exact identity per line. */
export const textFields = ['issuer', 'publicUrl', 'clientId', 'clientSecretRef', 'groupsClaim'] as const
/** Lists edited as newline-separated entries (scopes also allow spaces). */
export const listFields = ['allowedSubjects', 'allowedGroups', 'scopes'] as const
/** Bounded runtime budgets. */
export const numberFields = ['loginMaxAgeSeconds', 'sessionMaxAgeSeconds', 'maxPendingLogins', 'maxSessions', 'requestTimeoutSeconds'] as const
/** All deployment fields rendered by the form. */
export const fields = [...textFields, ...listFields, ...numberFields] as const
/** Field names displayed by the form. */
export type Field = typeof fields[number]
/** Full form snapshot; actual Host lifecycle is independent of the switch. */
export interface CardState extends SettingsFormShell {
  values: Record<Field, SettingsFieldState>
  enabled: boolean
  secret: string
  configured: boolean
  credentialWritable: boolean
  credentialUnknown: boolean
  phase: OidcStatus['phase'] | 'unknown'
  issue: OidcIssue | undefined
}
/** Slot-injected form data and owner actions. */
export interface CardFace extends SettingsFormActions {
  hooks: { oidc: SnapshotStore<CardState> }
  setEnabled(value: boolean): void
  setSecret(value: string): void
}

/** Owns subscriptions, async sequence fences, and the write-only secret draft. */
export class CardController {
  private readonly model: SettingsFormModel<OidcSettings>
  private readonly store: SnapshotStore<CardState>
  private readonly unsubscribe: () => void
  private disposed = false
  private secret = ''
  private saving = false
  private failed = false
  private credential = { ref: '', configured: false, writable: false, unknown: true }
  private sequence = 0
  private phase: CardState['phase'] = 'unknown'
  private issue: OidcIssue | undefined
  private readingStatus = false
  private readonly pending = new Set<Promise<unknown>>()

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise))
    return promise
  }

  private remote<T>(promise: Promise<RemoteResult<T>>): Promise<T> {
    return this.track(promise.then(result => {
      if (!result.ok) throw result.error
      return result.value
    }))
  }

  constructor(scope: SettingsFormScope<OidcSettings>, private readonly ctx: Context, documentBase?: string) {
    this.model = new SettingsFormModel(scope, [
      ...textFields.map(field => settingsTextField(field)), ...numberFields.map(field => settingsNumberField(field)),
      ...listFields.map(field => ({ field,
        format: (value: unknown) => Array.isArray(value) ? value.join(', ') : '',
        parse: (text: string) => ({ kind: 'set' as const, value: text.split(field === 'scopes' ? /[\s,]+/ : /[,\r\n]+/).map(v => v.trim()).filter(Boolean) }),
      })),
      { field: 'enabled', format: (value: unknown) => String(value === true), parse: (text: string) => ({ kind: 'set', value: text === 'true' }) },
    ])
    this.store = this.model.bind(() => this.snapshot())
    ctx.effect(() => async () => {
      this.dispose()
      await Promise.allSettled([...this.pending])
    }, 'oidc: drain form operations')
    let suggested = false
    const prefill = () => {
      const snapshot = scope.getSnapshot()
      if (suggested || snapshot.status !== 'ready') return
      suggested = true
      const publicUrl = documentBase ? suggestedPublicUrl(documentBase) : undefined
      if (snapshot.writable && snapshot.value?.publicUrl === '' && this.model.field('publicUrl').text === '' && publicUrl) {
        this.model.actions().edit('publicUrl', publicUrl)
      }
    }
    this.unsubscribe = scope.subscribe(() => { prefill(); void this.refreshCredential() })
    prefill()
    void this.refreshCredential()
  }

  private draftIssue(): OidcIssue | undefined {
    const config = { ...defaults, enabled: this.model.field('enabled').text === 'true' }
    for (const field of textFields) config[field] = this.model.field(field).text.trim()
    for (const field of listFields) config[field] = this.model.field(field).text
      .split(field === 'scopes' ? /[\s,]+/ : /[,\r\n]+/).map(value => value.trim()).filter(Boolean)
    return configurationIssue(config)
  }

  private snapshot(): CardState {
    const shell = this.model.shell()
    const draftIssue = this.draftIssue()
    return { ...shell, invalid: shell.invalid || draftIssue !== undefined,
      dirty: shell.dirty || this.secret !== '', saving: shell.saving || this.saving,
      failed: shell.failed || this.failed,
      values: Object.fromEntries(fields.map(field => [field, this.model.field(field)])) as Record<Field, SettingsFieldState>,
      enabled: this.model.field('enabled').text === 'true', secret: this.secret,
      configured: this.credential.configured, credentialWritable: this.credential.writable,
      credentialUnknown: this.credential.unknown, phase: this.phase,
      issue: draftIssue ?? (!shell.dirty ? this.issue : undefined) }
  }

  private publish(): void { if (!this.disposed) this.store.set(this.snapshot()) }

  /** Poll only lifecycle facts; no raw errors or credential values are returned. */
  async refreshStatus(): Promise<void> {
    if (this.readingStatus || this.disposed) return
    this.readingStatus = true
    try {
      const status = await this.remote<OidcStatus>(this.ctx.remote.authOidc.status())
      this.phase = status.phase
      this.issue = status.issue
    } catch (_error) { this.phase = 'unknown'; this.issue = undefined }
    finally { this.readingStatus = false; this.publish() }
  }

  /** Refresh the selected reference with stale-response suppression. */
  async refreshCredential(): Promise<void> {
    if (this.disposed) return
    const ref = this.model.field('clientSecretRef').text
    const sequence = ++this.sequence
    this.credential = { ref, configured: false, writable: false, unknown: true }
    this.publish()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return
    try {
      const info = (await this.remote<Record<string, { configured: boolean; writable: boolean }>>(this.ctx.remote.credentials.describe([ref])))[ref]
      if (this.disposed || sequence !== this.sequence || !info) return
      this.credential = { ref, configured: info.configured, writable: info.writable, unknown: false }
    } catch (_error) {
      // Unknown credential state remains visible; no enable decision trusts it.
    }
    this.publish()
  }

  private async save(): Promise<void> {
    if (this.disposed || this.saving || this.snapshot().invalid || !this.model.shell().writable) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const ref = this.model.field('clientSecretRef').text
      if (this.secret !== '') {
        // Credentials and Config are separate stores. A failure stops the settings write.
        await this.remote(this.ctx.remote.credentials.set(ref, this.secret))
        if (this.disposed) return
        this.secret = ''
        if (ref !== this.model.field('clientSecretRef').text) { this.failed = true; return }
        await this.refreshCredential()
        if (this.credential.unknown || !this.credential.configured) { this.failed = true; return }
      }
      if (this.model.field('enabled').text === 'true') {
        await this.refreshCredential()
        if (this.credential.unknown || !this.credential.configured) { this.failed = true; return }
      }
      if (this.disposed) return
      await this.model.save()
      await this.refreshStatus()
    } catch (_error) { this.failed = true }
    finally { this.saving = false; this.publish() }
  }

  /** Actions and reactive store consumed through renderer-generated hooks. */
  inject(): CardFace {
    const actions = this.model.actions()
    return { ...actions, hooks: { oidc: this.store },
      edit: (field, text) => { if (this.disposed || this.saving) return; this.failed = false; actions.edit(field, text); if (field === 'clientSecretRef') { this.secret = ''; void this.refreshCredential() } },
      resetField: field => { if (this.disposed || this.saving) return; actions.resetField(field); if (field === 'clientSecretRef') { this.secret = ''; void this.refreshCredential() } },
      setEnabled: value => { if (!this.disposed && !this.saving) actions.edit('enabled', String(value)) },
      setSecret: value => { if (!this.disposed && !this.saving) { this.secret = value; this.failed = false; this.publish() } },
      save: () => { void this.track(this.save()) },
      discard: () => { if (!this.disposed && !this.saving) { this.secret = ''; this.failed = false; actions.discard(); void this.refreshCredential() } },
    }
  }

  /** Clear draft secret and detach the accepted-settings observer. */
  dispose(): void {
    if (this.disposed) return
    this.secret = ''
    this.store.set(this.snapshot())
    this.disposed = true
    ++this.sequence
    this.unsubscribe()
    this.model.dispose()
  }
}
