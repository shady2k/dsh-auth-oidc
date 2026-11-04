/** Form integration with rc.1 Remote namespace injection and result envelopes. */
import { Context } from '@deepseek-ai/cordis'
import * as GatewayClient from '@deepseek-ai/dsh-api-gateway/client'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
vi.mock('../src/client/Card.tsx', () => ({ Card: () => null }))
import * as Client from '../src/client/index.ts'
import { defaults, type OidcSettings } from '../src/configuration.ts'
import type { CardFace } from '../src/client/controller.ts'

it('reads status, saves credentials first, and contains Remote failure envelopes in the real Client', async () => {
  const ctx = new Context()
  let statusFails = false
  let describeFails = false
  let setFails = false
  let configured = false
  let form: CardFace | undefined
  const order: string[] = []
  const call = vi.fn(async (_path: string, endpoint: string) => {
    if ((endpoint === 'authOidc/status' && statusFails)
      || (endpoint === 'credentials/describe' && describeFails)
      || (endpoint === 'credentials/set' && setFails)) {
      return { ok: false, error: { code: 'gateway/internal', message: 'private diagnostic', details: {} } }
    }
    if (endpoint === 'authOidc/status') return { ok: true, value: { phase: 'disabled' } }
    if (endpoint === 'credentials/describe') return { ok: true, value: { DSH_OIDC_CLIENT_SECRET: { configured, writable: true } } }
    if (endpoint === 'credentials/set') { order.push('credential'); configured = true; return { ok: true, value: undefined } }
    throw new Error(`Unexpected endpoint ${endpoint}`)
  })
  // The carrier is local; namespace lookup, invocation, and envelope handling are the shipped implementation.
  ctx.provide('connection', { interactions: 'none', rpc: { open() {}, call }, start: () => ({ stop() {} }) })
  const source = createSnapshotStore<SettingsFormScopeSnapshot<OidcSettings>>({
    status: 'ready', value: { ...defaults, issuer: 'https://identity.example/application/o/dsh/',
      publicUrl: 'https://dsh.example/', clientId: 'dsh', allowedSubjects: ['owner'] },
    base: defaults, user: {}, writable: true, revision: 1,
  })
  const mutate = vi.fn(async () => { order.push('settings'); return true })
  ctx.provide('locale', { bind: () => () => 'localized', register: () => () => {} })
  ctx.provide('configForms', { get: () => ({ ...source, mutate }), whileServed: (_names: string[], ready: () => () => void) => ready() })
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: { inject: () => CardFace }) => { form = options.inject(); return () => {} },
  })
  try {
    await ctx.plugin(Registry)
    await ctx.plugin(GatewayClient)
    // Forwarded event transport is outside this test; keep the real $mount and namespace services.
    const remote = ctx.get('remote')!
    vi.spyOn(remote, '$on').mockReturnValue(() => {})
    const codec = { mode: 'strict' as const, typeSymbol: 'fixture#string', create: () => z.string() }
    const credentials: TypertRemoteContribution = { package: 'fixture-credentials', descriptors: [
      { id: 'fixture#credentials/describe', service: 'credentialsController', namespace: 'credentials', method: 'describe',
        invocation: { kind: 'direct' }, parameters: [{ name: 'refs', wire: 'refs', source: 'json', codec: { ...codec, create: () => z.array(z.string()) } }],
        result: { mode: 'src-json' } },
      { id: 'fixture#credentials/set', service: 'credentialsController', namespace: 'credentials', method: 'set',
        invocation: { kind: 'direct' }, parameters: ['ref', 'value'].map(name => ({ name, wire: name, source: 'json', codec })), result: { mode: 'src-json' } },
    ] }
    await remote.$mount(credentials)
    const plugin = ctx.plugin(Client)
    await plugin
    const face = form!
    const snapshot = () => face.hooks.oidc.getSnapshot()
    await vi.waitFor(() => expect(snapshot()).toMatchObject({ phase: 'disabled', credentialWritable: true, credentialUnknown: false }))
    face.setSecret('test-secret')
    face.setEnabled(true)
    face.save()
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['credential', 'settings'])
    expect(snapshot()).toMatchObject({ secret: '', failed: false })

    statusFails = true
    describeFails = true
    setFails = true
    face.setSecret('test-secret')
    face.save()
    await vi.waitFor(() => expect(snapshot().failed).toBe(true))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(snapshot().secret).toBe('test-secret')
    face.edit('clientSecretRef', 'DSH_OIDC_CLIENT_SECRET')
    await vi.waitFor(() => expect(snapshot().credentialUnknown).toBe(true))
    // Saving refreshes status after the settings write; keep the unavailable phase visible.
    describeFails = false
    configured = true
    face.setSecret('')
    face.setEnabled(false)
    face.save()
    await vi.waitFor(() => expect(snapshot().phase).toBe('unknown'))
    expect(JSON.stringify(snapshot())).not.toContain('private diagnostic')
    await plugin.dispose()
    expect(ctx.get('remote.authOidc')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})
