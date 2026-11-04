/** Browser-only smoke fixture. Actual Card/primitives; only renderer props and state are test-owned. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, type CardProps } from '../../src/client/Card.tsx'
import { fields, numberFields, type CardState, type Field } from '../../src/client/controller.ts'
import { en } from '../../src/client/locales.ts'

const defaults: Record<Field, string> = {
  issuer: 'https://auth.example.test/application/o/dsh/', publicUrl: 'https://dsh.example.test/mount/',
  clientId: 'dsh-owner-client', clientSecretRef: 'DSH_OIDC_CLIENT_SECRET', groupsClaim: 'groups',
  allowedSubjects: 'owner-subject', allowedGroups: 'dsh-owners', scopes: 'openid, profile, email',
  loginMaxAgeSeconds: '300', sessionMaxAgeSeconds: '86400', maxPendingLogins: '128', maxSessions: '1024', requestTimeoutSeconds: '10',
}
function initial(): CardState {
  return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
    values: Object.fromEntries(fields.map(field => [field, { text: defaults[field], overridden: false, invalid: false }])) as CardState['values'],
    enabled: false, secret: '', configured: true, credentialWritable: true, credentialUnknown: false, phase: 'disabled' }
}
export interface VisualOidcFixture {
  patch(patch: Partial<CardState>): void
  reset(): void
  counts(): { saved: number; discarded: number }
}
declare global { interface Window { oidcFixture: VisualOidcFixture } }
let saved = 0
let discarded = 0
function Fixture() {
  const [state, setState] = useState<CardState>(initial)
  const edit = (field: string, text: string) => setState(previous => {
    const key = field as Field
    const invalid = (numberFields as readonly string[]).includes(field) && !/^\d+$/.test(text)
    const values = { ...previous.values, [key]: { text, overridden: true, invalid } }
    return { ...previous, values, dirty: true, failed: false, invalid: Object.values(values).some(value => value.invalid) }
  })
  const props = {
    view: 'page', t: (key: keyof typeof en) => en[key], useOidc: (selector: (value: CardState) => unknown) => selector(state),
    edit, resetField: (field: string) => edit(field, defaults[field as Field]),
    setEnabled: (enabled: boolean) => setState(previous => ({ ...previous, enabled, dirty: true })),
    setSecret: (secret: string) => setState(previous => ({ ...previous, secret, dirty: true, failed: false })),
    save: () => { saved++; setState(previous => ({ ...previous, saving: true })) },
    discard: () => { discarded++ },
  } as CardProps
  Object.assign(window, { oidcFixture: {
    patch: (patch: Partial<CardState>) => setState(previous => ({ ...previous, ...patch })),
    reset: () => setState(initial()), counts: () => ({ saved, discarded }),
  } })
  return <main><h1>{en.title}</h1><p>{en.description}</p><Card {...props} /></main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
