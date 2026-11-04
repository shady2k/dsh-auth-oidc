/** Credential-first saves, partial failures, and disposed async form operations. */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScope, SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import { afterEach, expect, it, vi } from 'vitest'
import { CardController } from '../src/client/controller.ts'
import { defaults, type OidcSettings } from '../src/configuration.ts'

const valid = { ...defaults, issuer: 'https://identity.example/application/o/dsh/',
  publicUrl: 'https://dsh.example/', clientId: 'dsh', allowedSubjects: ['owner'] }
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function bench(set: (ref: string, value: string) => Promise<void> = async () => {},
  documentBase?: string, value: OidcSettings = { ...defaults },
  initial: { status?: 'loading' | 'ready'; writable?: boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const order: string[] = []
  let configured = false
  const credentials = {
    describe: vi.fn(async (refs: string[]) => ({ ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured, writable: true }])) })),
    set: vi.fn(async (ref: string, value: string) => {
      order.push('credential'); await set(ref, value); configured = true
      return { ok: true as const, value: undefined }
    }),
  }
  const status = vi.fn(async () => ({ ok: true as const, value: { phase: 'disabled' as const } }))
  ctx.provide('remote', { credentials, authOidc: { status } })
  const source = createSnapshotStore<SettingsFormScopeSnapshot<OidcSettings>>({
    status: initial.status ?? 'ready', value, base: defaults, user: {}, writable: initial.writable ?? true, revision: 1,
  })
  const mutate = vi.fn<SettingsFormScope<OidcSettings>['mutate']>(async () => { order.push('settings'); return true })
  const card = new CardController({ getSnapshot: source.getSnapshot, subscribe: source.subscribe, mutate }, ctx, documentBase)
  const face = card.inject()
  return { ctx, card, face, credentials, mutate, order, source }
}

it('writes a secret only through credentials and before enabling settings', async () => {
  const { face, credentials, mutate, order } = bench(undefined, undefined, valid)
  await vi.waitFor(() => expect(face.hooks.oidc.getSnapshot().credentialWritable).toBe(true))
  face.setSecret('literal-never-in-config')
  face.setEnabled(true)
  face.save()
  await vi.waitFor(() => expect(mutate).toHaveBeenCalledOnce())
  expect(order).toEqual(['credential', 'settings'])
  expect(credentials.set).toHaveBeenCalledWith('DSH_OIDC_CLIENT_SECRET', 'literal-never-in-config')
  expect(JSON.stringify(mutate.mock.calls)).not.toContain('literal-never-in-config')
  expect(face.hooks.oidc.getSnapshot().secret).toBe('')
})

it('stops before settings when credential storage fails and reports a failure', async () => {
  const { face, mutate } = bench(async () => { throw new Error('secret-bearing upstream failure') }, undefined, valid)
  face.setSecret('private')
  face.setEnabled(true)
  face.save()
  await vi.waitFor(() => expect(face.hooks.oidc.getSnapshot().failed).toBe(true))
  expect(mutate).not.toHaveBeenCalled()
  expect(JSON.stringify(face.hooks.oidc.getSnapshot())).not.toContain('upstream failure')
})

it('does not enable login after the form is disposed during an in-flight credential write', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const { ctx, face, card, mutate, credentials } = bench(async () => gate, undefined, valid)
  face.setSecret('private')
  face.setEnabled(true)
  face.save()
  await vi.waitFor(() => expect(credentials.set).toHaveBeenCalledOnce())
  card.dispose()
  expect(face.hooks.oidc.getSnapshot().secret).toBe('')
  release()
  await ctx.fiber.dispose()
  expect(mutate).not.toHaveBeenCalled()
})

it('drains an in-flight credential operation before releasing the plugin context', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const { ctx, face, credentials, mutate } = bench(async () => gate, undefined, valid)
  face.setSecret('private')
  face.setEnabled(true)
  face.save()
  await vi.waitFor(() => expect(credentials.set).toHaveBeenCalledOnce())
  let finished = false
  const disposing = ctx.fiber.dispose().then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  release()
  await disposing
  expect(mutate).not.toHaveBeenCalled()
})

it('does not save settings when an external reference update supersedes a pending secret write', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const { face, source, mutate, credentials } = bench(async () => gate, undefined, valid)
  face.setSecret('private')
  face.setEnabled(true)
  face.save()
  await vi.waitFor(() => expect(credentials.set).toHaveBeenCalledOnce())
  source.set({ ...source.getSnapshot(), value: { ...defaults, clientSecretRef: 'OTHER_SECRET' }, revision: 2 })
  release()
  await vi.waitFor(() => expect(face.hooks.oidc.getSnapshot().failed).toBe(true))
  expect(mutate).not.toHaveBeenCalled()
})

it('keeps a blank secret unchanged and refuses enable while credential status is missing', async () => {
  const { face, credentials, mutate } = bench(undefined, undefined, valid)
  face.setEnabled(true)
  face.save()
  await vi.waitFor(() => expect(face.hooks.oidc.getSnapshot().failed).toBe(true))
  expect(credentials.set).not.toHaveBeenCalled()
  expect(mutate).not.toHaveBeenCalled()
})

it('blocks incomplete enabled drafts before credentials or settings are written and identifies the missing admission', () => {
  const { face, credentials, mutate } = bench(undefined, undefined, { ...valid, allowedSubjects: [] })
  face.setSecret('private')
  face.setEnabled(true)
  expect(face.hooks.oidc.getSnapshot()).toMatchObject({ invalid: true, issue: 'allowlist' })
  face.save()
  expect(credentials.set).not.toHaveBeenCalled()
  expect(mutate).not.toHaveBeenCalled()
  face.edit('allowedGroups', 'dsh-owners')
  expect(face.hooks.oidc.getSnapshot()).toMatchObject({ invalid: false, issue: undefined })
  face.edit('allowedGroups', '')
  face.setEnabled(false)
  expect(face.hooks.oidc.getSnapshot().invalid).toBe(false)
})

it('prefills only the public URL as an unsaved draft without enabling or writing credentials', () => {
  const { face, mutate, credentials } = bench(undefined, 'https://dsh.example/?token=private#plugins')
  const state = face.hooks.oidc.getSnapshot()
  expect(state.values.publicUrl.text).toBe('https://dsh.example/')
  expect(state.dirty).toBe(true)
  expect(state.enabled).toBe(false)
  expect(state.secret).toBe('')
  expect(state.values.issuer.text).toBe('')
  expect(state.values.clientId.text).toBe('')
  expect(state.values.allowedGroups.text).toBe('')
  expect(mutate).not.toHaveBeenCalled()
  expect(credentials.set).not.toHaveBeenCalled()
  face.discard()
  expect(face.hooks.oidc.getSnapshot().values.publicUrl.text).toBe('')
})

it('keeps an existing deployment URL instead of replacing it with the page URL', () => {
  const { face } = bench(undefined, 'https://dsh.example/', { ...defaults, publicUrl: 'https://custom.example/ui/' })
  expect(face.hooks.oidc.getSnapshot().values.publicUrl.text).toBe('https://custom.example/ui/')
  expect(face.hooks.oidc.getSnapshot().dirty).toBe(false)
})

it('does not refill a deliberately cleared public URL when Host settings refresh', () => {
  const { face, source } = bench(undefined, 'https://dsh.example/ui/')
  face.edit('publicUrl', '')
  source.set({ ...source.getSnapshot(), revision: 2 })
  expect(face.hooks.oidc.getSnapshot().values.publicUrl.text).toBe('')
})

it('waits for asynchronous settings and prefills only after the first ready snapshot', () => {
  const { face, source, mutate } = bench(undefined, 'https://dsh.example/ui/', { ...defaults }, { status: 'loading' })
  expect(face.hooks.oidc.getSnapshot().values.publicUrl.text).toBe('')
  source.set({ ...source.getSnapshot(), status: 'ready', revision: 2 })
  expect(face.hooks.oidc.getSnapshot().values.publicUrl.text).toBe('https://dsh.example/ui/')
  expect(mutate).not.toHaveBeenCalled()
})

it('does not overwrite a draft entered before settings become ready', () => {
  const { face, source } = bench(undefined, 'https://dsh.example/', { ...defaults }, { status: 'loading' })
  face.edit('publicUrl', 'https://draft.example/ui/')
  source.set({ ...source.getSnapshot(), status: 'ready', revision: 2 })
  expect(face.hooks.oidc.getSnapshot().values.publicUrl.text).toBe('https://draft.example/ui/')
})

it('does not stage a public URL in a readonly form', () => {
  const { face } = bench(undefined, 'https://dsh.example/', { ...defaults }, { writable: false })
  expect(face.hooks.oidc.getSnapshot().values.publicUrl.text).toBe('')
  expect(face.hooks.oidc.getSnapshot().dirty).toBe(false)
})
