/** Callback examples and localized setup instructions shown by the settings page. */
import { expect, it } from 'vitest'
import { setupCallback, setupRows, suggestedPublicUrl } from '../src/client/setup.ts'
import { en, zh } from '../src/client/locales.ts'

it.each([
  ['https://dsh.example/', 'https://dsh.example/auth/oidc/callback'],
  ['https://dsh.example:8443/ui/', 'https://dsh.example:8443/ui/auth/oidc/callback'],
])('shows the exact callback for %s', (base, callback) => {
  expect(setupCallback(base)).toBe(callback)
})

it.each(['', 'not a URL', 'http://dsh.example/', 'https://dsh.example/ui',
  'https://owner:secret@dsh.example/', 'https://dsh.example/?q=1', 'https://dsh.example/#fragment',
  'https://dsh.example/a//', 'https://dsh.example/%75i/'])('withholds callback for invalid base %s', base => {
  expect(setupCallback(base)).toBeUndefined()
})

it('keeps provider setup, credentials, admission, and activation guidance localized', () => {
  const keys = Object.keys(en).filter(key => key.startsWith('setup') || key.startsWith('callback')) as (keyof typeof en)[]
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  expect(Object.fromEntries(keys.map(key => [key, { en: en[key], zh: zh[key] }]))).toMatchSnapshot()
})

it('suggests the document mount, not just the origin, without URL credentials or launch tokens', () => {
  expect(suggestedPublicUrl('https://dsh.example:8443/ui/?token=private#plugins')).toBe('https://dsh.example:8443/ui/')
  expect(suggestedPublicUrl('http://localhost:3000/')).toBeUndefined()
  expect(suggestedPublicUrl('https://owner:private@dsh.example/')).toBeUndefined()
  expect(suggestedPublicUrl('not a URL')).toBeUndefined()
})

it('shows copyable current drafts and protocol values, never provider guesses or secrets', () => {
  const values = { publicUrl: 'https://dsh.example/', clientSecretRef: 'DSH_OIDC_CLIENT_SECRET',
    groupsClaim: 'groups', scopes: 'openid, profile' }
  expect(setupRows(values)).toMatchSnapshot()
  expect(setupRows({ ...values, publicUrl: 'https://dsh.example/mount/' })[1].value)
    .toBe('https://dsh.example/mount/auth/oidc/callback')
  expect(setupRows({ ...values, publicUrl: 'http://invalid/' })[1].value).toBeUndefined()
})
