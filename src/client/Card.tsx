/** OIDC settings component receives only slot-derived data and actions. */
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { useEffect, useRef, useState } from 'react'
import { Button, IconCheckOutlineRegular, IconCopyOutlineRegular, SettingsForm, SettingsSecretField,
  SettingsValueField, Switch, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OidcIssue } from '../configuration.ts'
import { numberFields, type CardFace, type Field } from './controller.ts'
import type { LocaleKey } from './locales.ts'
import { setupRows } from './setup.ts'

/** Copy feedback belongs to the row, not the deployment form's save state. */
function SetupRow({ label, value, copy, copied, copyFailed, pending }: {
  label: string; value: string | undefined; copy: string; copied: string; copyFailed: string; pending: string
}) {
  const [feedback, setFeedback] = useState<{ value: string; state: 'pending' | 'copied' | 'failed' }>()
  const request = useRef(0)
  useEffect(() => {
    ++request.current
    setFeedback(undefined)
    return () => { ++request.current }
  }, [value])
  useEffect(() => {
    if (feedback?.state !== 'copied') return
    const timer = setTimeout(() => { setFeedback(undefined) }, 2000)
    return () => { clearTimeout(timer) }
  }, [feedback])
  const onCopy = async () => {
    if (!value) return
    const sequence = ++request.current
    setFeedback({ value, state: 'pending' })
    const accepted = await writeClipboard(value)
    if (sequence === request.current) setFeedback({ value, state: accepted ? 'copied' : 'failed' })
  }
  const result = feedback && feedback.value === value ? feedback.state : undefined
  const actionLabel = `${result === 'copied' ? copied : copy}: ${label}`
  return <div className="oidc-setup-row">
    <dt>{label}</dt>
    <dd>
      {value ? <>
        <div className="oidc-setup-value">
          <code>{value}</code>
          <Tooltip label={actionLabel} side="top">
            <Button type="button" size="sm" variant="ghost" className="oidc-copy"
              aria-label={actionLabel} disabled={result === 'pending'} onClick={() => { void onCopy() }}>
              {result === 'copied' ? <IconCheckOutlineRegular size={16} /> : <IconCopyOutlineRegular size={16} />}
            </Button>
          </Tooltip>
        </div>
        <span className={result === 'failed' ? 'oidc-copy-error' : 'oidc-sr-only'} role="status">
          {result === 'copied' ? copied : result === 'failed' ? copyFailed : ''}
        </span>
      </> : <span className="oidc-muted">{pending}</span>}
    </dd>
  </div>
}

const issueLabels = {
  issuer: 'issueIssuer', publicUrl: 'issuePublicUrl', clientId: 'issueClientId', groupsClaim: 'issueGroupsClaim',
  clientSecretRef: 'issueClientSecretRef', allowlist: 'issueAllowlist', scopes: 'issueScopes',
  credential: 'issueCredential', discovery: 'issueDiscovery', issuerMismatch: 'issueIssuerMismatch', runtime: 'issueRuntime',
} as const satisfies Record<OidcIssue, LocaleKey>

const providerFields = ['publicUrl', 'issuer', 'clientId'] as const satisfies readonly Field[]
const admissionFields = ['allowedSubjects', 'allowedGroups', 'groupsClaim', 'scopes'] as const satisfies readonly Field[]
const advancedFields = ['clientSecretRef', ...numberFields] as const satisfies readonly Field[]

/** Renderer-derived OIDC page props. */
export type CardProps = PropsRuntime<'plugins.item'> & PropsLocale<'settings.oidc'> & InjectFace<CardFace>

/** Render the summary or staged deployment form. */
export function Card(props: CardProps) {
  const { t } = props
  const state = props.useOidc(value => value)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable || state.saving
  const rows = setupRows({ publicUrl: state.values.publicUrl.text, clientSecretRef: state.values.clientSecretRef.text,
    groupsClaim: state.values.groupsClaim.text, scopes: state.values.scopes.text })
  const field = (name: Field) => <SettingsValueField key={name} id={`oidc-${name}`} label={t(name)}
    {...state.values[name]} disabled={disabled} numeric={(numberFields as readonly string[]).includes(name)}
    overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
    {...name === 'issuer' ? { hint: t('issuerHint') } : name === 'publicUrl' ? { hint: t('publicUrlHint') }
      : name === 'scopes' ? { hint: t('scopesHint') }
      : name === 'allowedGroups' || name === 'allowedSubjects' ? { hint: t('allowlistHint') } : {}}
    onEdit={text => props.edit(name, text)} onReset={() => props.resetField(name)} />
  return <SettingsForm state={state} onSave={props.save} onDiscard={props.discard}
    labels={{ unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }}>
    <div className="oidc-settings">
      <section className="oidc-section" aria-labelledby="oidc-login-heading">
        <div className="oidc-toggle-row">
          <div className="oidc-toggle-copy">
            <h2 id="oidc-login-heading" className="oidc-section-title">{t('enabled')}</h2>
            <p className="oidc-hint">{t('enableHint')}</p>
          </div>
          <Switch label={t('enabled')} checked={state.enabled} disabled={disabled} onChange={props.setEnabled} />
        </div>
        <p className="oidc-status" role="status"><span>{t('statusLabel')}</span><span>{t(state.phase)}</span></p>
        {state.issue && <p className="oidc-issue" role="alert">{t(issueLabels[state.issue])}</p>}
        <p className="oidc-hint">{t('warning')}</p>
      </section>

      <details className="oidc-section oidc-disclosure" open>
        <summary className="oidc-section-title">{t('setupTitle')}</summary>
        <div className="oidc-disclosure-body">
          <p className="oidc-hint">{t('setupApplication')}</p>
          <dl className="oidc-setup-values" aria-label={t('setupTitle')}>
            {rows.map(row => <SetupRow key={row.label} label={t(row.label)} value={row.value}
              copy={t('setupCopy')} copied={t('setupCopied')} copyFailed={t('setupCopyFailed')} pending={t('setupPending')} />)}
          </dl>
          <p className="oidc-hint">{t('setupPrefill')}</p>
          <p className="oidc-hint">{t('setupRemaining')}</p>
          <a className="oidc-doc-link" href="https://docs.goauthentik.io/add-secure-apps/providers/oauth2/"
            target="_blank" rel="noopener noreferrer">{t('setupDocs')}</a>
        </div>
      </details>

      <section className="oidc-section" aria-labelledby="oidc-provider-heading">
        <h2 id="oidc-provider-heading" className="oidc-section-title">{t('providerTitle')}</h2>
        <div className="oidc-fields">{providerFields.map(field)}
          <SettingsSecretField id="oidc-client-secret" label={t('secret')} hint={t('secretHint')}
            text={state.secret} configured={state.configured} disabled={disabled || !state.credentialWritable}
            stateLabel={t(state.credentialUnknown ? 'unknownCredential' : state.configured ? 'configured' : 'missing')}
            onEdit={props.setSecret} />
        </div>
      </section>

      <section className="oidc-section" aria-labelledby="oidc-admission-heading">
        <h2 id="oidc-admission-heading" className="oidc-section-title">{t('admissionTitle')}</h2>
        <p className="oidc-admission-note">{t('admissionHint')}</p>
        <div className="oidc-fields">{admissionFields.map(field)}</div>
        <p className="oidc-hint">{t('setupGroups')}</p>
      </section>

      <details className="oidc-section oidc-disclosure">
        <summary className="oidc-section-title">{t('advancedTitle')}</summary>
        <div className="oidc-disclosure-body oidc-fields">{advancedFields.map(field)}</div>
      </details>
      <p className="oidc-hint">{t('setupFinish')}</p>
    </div>
  </SettingsForm>
}
