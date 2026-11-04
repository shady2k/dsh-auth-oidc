/** Browser plugin contribution ownership without rendering the UI. */
import { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, vi } from 'vitest'
vi.mock('../src/client/Card.tsx', () => ({ Card: () => null }))
import { apply } from '../src/client/index.ts'

it('mounts the strict status namespace and removes owned dictionaries and form registrations before it', async () => {
  const ctx = new Context()
  const order: string[] = []
  const unmount = vi.fn(async () => { order.push('namespace') })
  const mount = vi.fn(async (_contribution: TypertRemoteContribution) => unmount)
  ctx.provide('remote', { $mount: mount })
  ctx.provide('remote.authOidc', {})
  ctx.provide('locale', { bind: () => () => 'localized', register: () => () => { order.push('dictionary') } })
  ctx.provide('configForms', { whileServed: () => () => { order.push('forms') } })
  try {
    await apply(ctx)
    expect(mount).toHaveBeenCalledOnce()
    const contribution = mount.mock.calls[0]![0]
    expect(contribution.package).toBe('dsh-auth-oidc')
    const descriptor = contribution.descriptors[0]!
    expect(descriptor.namespace).toBe('authOidc')
    expect(descriptor.method).toBe('status')
    const codec = descriptor.result
    if (codec.mode !== 'strict') throw new Error('Expected strict status codec')
    expect(codec.create().parse({ phase: 'active' })).toEqual({ phase: 'active' })
    expect(codec.create().parse({ phase: 'failed', issue: 'allowlist' })).toEqual({ phase: 'failed', issue: 'allowlist' })
    expect(() => codec.create().parse({ phase: 'failed', issue: 'upstream-secret-bearing-text' })).toThrow()
    expect(() => codec.create().parse({ phase: 'active', secret: 'private' })).toThrow()
  } finally { await ctx.fiber.dispose() }
  expect(order).toEqual(['forms', 'dictionary', 'namespace'])
  expect(unmount).toHaveBeenCalledOnce()
})
