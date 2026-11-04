/** Loader volatile owner lifecycle, including auth-only dependencies and failure visibility. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as configure from '../src/configure.ts'
import { defaults, validateEnabled } from '../src/configuration.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function boot(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.oidcSettings = configure
  const id = await ctx.loader.create({ name: 'cordis:oidcSettings', config })
  const entry = ctx.loader.resolve(id)
  await entry.fiber!.await()
  await ctx.loader.await()
  return { ctx, entry }
}

function status(ctx: Context): { phase: string } {
  return (ctx.get('authOidc') as { status(): { phase: string } }).status()
}

const enabled = { ...defaults, enabled: true, issuer: 'https://identity.example/application/o/dsh/',
  publicUrl: 'https://dsh.example/', clientId: 'dsh', allowedSubjects: ['owner'] }

describe('always-active OIDC settings owner', () => {
  it('boots unconfigured with no auth services and exposes safe disabled status', async () => {
    const { ctx, entry } = await boot()
    expect(entry.fiber!.state).toBe(2)
    await vi.waitFor(() => { expect(status(ctx)).toEqual({ phase: 'disabled' }) })
    expect(ctx.get('connection')).toBeUndefined()
    expect(ctx.get('credentials')).toBeUndefined()
  })

  it('keeps the same owner on volatile enable/disable and disposes a pending child', async () => {
    const { ctx, entry } = await boot()
    const owner = entry.fiber
    await entry.update({ config: enabled })
    await vi.waitFor(() => { expect(status(ctx)).toEqual({ phase: 'waiting' }) })
    expect(entry.fiber).toBe(owner)
    expect(entry.fiber!.state).toBe(2)
    await entry.update({ config: { ...enabled, enabled: false } })
    await vi.waitFor(() => { expect(status(ctx)).toEqual({ phase: 'disabled' }) })
    expect(entry.fiber).toBe(owner)
  })

  it('fails closed on an empty allowlist without failing the settings owner', async () => {
    const { ctx, entry } = await boot({ ...enabled, allowedSubjects: [] })
    await vi.waitFor(() => { expect(status(ctx)).toEqual({ phase: 'failed', issue: 'allowlist' }) })
    expect(entry.fiber!.state).toBe(2)
    await entry.update({ config: { ...enabled, enabled: false } })
    await vi.waitFor(() => { expect(status(ctx)).toEqual({ phase: 'disabled' }) })
  })

  it('coalesces rapid updates and removes status service on owner disposal', async () => {
    const { ctx, entry } = await boot()
    await Promise.all([entry.update({ config: enabled }), entry.update({ config: { ...enabled, enabled: false } })])
    await vi.waitFor(() => { expect(status(ctx)).toEqual({ phase: 'disabled' }) })
    await entry.fiber!.dispose()
    expect(ctx.get('authOidc')).toBeUndefined()
  })
})

it('validates enabled HTTPS mounts and admission without accepting secret literals', () => {
  expect(() => validateEnabled(enabled)).not.toThrow()
  for (const partial of [{ publicUrl: 'http://dsh.example/' }, { issuer: 'https://id.example/?secret=value' },
    { publicUrl: 'https://dsh.example/mount' }, { clientSecretRef: 'invalid-ref' }, { allowedSubjects: [], allowedGroups: [] },
    { scopes: ['profile'] }, { clientId: ' ' }]) {
    expect(() => validateEnabled({ ...enabled, ...partial })).toThrow()
  }
  expect(() => validateEnabled(defaults)).not.toThrow()
})
