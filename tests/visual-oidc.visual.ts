/** Explicit standalone visual smoke; never starts a DSH application or touches a profile.
 * Run: DSH_OIDC_VISUAL_RUNTIME_ROOT=/path/to/existing/dsh-checkout [Nix LD_LIBRARY_PATH]
 * taskset -c 0 env NODE_OPTIONS=--max-old-space-size=1024 pnpm exec vitest run --config tests/fixtures/visual-oidc.config.ts
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { CardState } from '../src/client/controller.ts'
import type {} from './fixtures/visual-oidc.tsx'

it('renders actual OIDC Card and installed settings primitives at mobile/desktop in light/dark', async () => {
  const runtimeRoot = process.env.DSH_OIDC_VISUAL_RUNTIME_ROOT
  if (!runtimeRoot) throw new Error('Set DSH_OIDC_VISUAL_RUNTIME_ROOT to existing runtime deps; this test installs nothing.')
  const runtime = createRequire(join(runtimeRoot, 'packages/client/ui-primitives/package.json'))
  const stage = await mkdtemp(join(tmpdir(), 'oidc-visual-smoke-'))
  const evidence = process.env.DSH_OIDC_VISUAL_EVIDENCE ?? await mkdtemp(join(tmpdir(), 'oidc-visual-evidence-'))
  const cardPath = resolve('src/client/Card.tsx')
  const cardHash = createHash('sha256').update(await readFile(cardPath)).digest('hex')
  const primitives = createRequire(resolve('package.json')).resolve('@deepseek-ai/dsh-client-ui-primitives')
  const stylesRoot = join(runtimeRoot, 'packages/client/ui-theme/src/styles')
  const failures: string[] = []
  const reports: object[] = []
  let checks = 0
  let server: ReturnType<typeof createServer> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await build({
      entryPoints: [resolve('tests/fixtures/visual-oidc.tsx')], outfile: join(stage, 'fixture.js'), bundle: true,
      platform: 'browser', format: 'esm', jsx: 'automatic', minify: true, treeShaking: true,
      define: { 'process.env.NODE_ENV': '"production"' },
      nodePaths: [join(runtimeRoot, 'packages/client/ui-primitives/node_modules'), join(runtimeRoot, 'node_modules')],
      loader: { '.module.css': 'local-css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
      plugins: [{ name: 'single-existing-react-runtime', setup(builder) {
        builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: runtime.resolve(args.path) }))
      } }],
    })
    const theme = (await Promise.all(['base.css', 'design-platform.css', 'focus.css'].map(name => readFile(join(stylesRoot, name), 'utf8')))).join('\n')
    await writeFile(join(stage, 'theme.css'), theme + '\nbody { margin: 0; font: 14px/1.5 var(--dsw-font-family); color: var(--dsw-alias-label-primary); } main { max-width: 760px; margin: 0 auto; padding: 24px 16px 32px; } h1 { font-size: 22px; }')
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual OIDC Card smoke</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'
    server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return }
      if (!['/fixture.js', '/fixture.css', '/theme.css'].includes(path)) { response.writeHead(404).end(); return }
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
      response.end(await readFile(join(stage, path.slice(1))))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture TCP address')
    browser = await chromium.launch()
    for (const width of [390, 1280]) for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme })
      const page = await context.newPage()
      page.on('pageerror', error => failures.push(error.message))
      page.on('console', message => { if (message.type() === 'error') failures.push(message.text()) })
      await page.goto(`http://127.0.0.1:${address.port}/`)
      await page.getByRole('heading', { name: 'Authentik / OIDC' }).waitFor()
      await page.evaluate(dark => { if (dark) document.body.setAttribute('data-ds-dark-theme', ''); else document.body.removeAttribute('data-ds-dark-theme') }, colorScheme === 'dark')
      const patch = (value: Partial<CardState>) => page.evaluate(patch => window.oidcFixture.patch(patch), value)
      const check = async (name: string, condition: boolean) => { checks++; if (!condition) failures.push(`${width}/${colorScheme}: ${name}`) }
      const actionable = async (name: string, target: ReturnType<typeof page.getByRole>) => {
        await target.scrollIntoViewIfNeeded()
        await target.focus()
        const result = await target.evaluate(node => {
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return { focused: document.activeElement === node, hit: hit === node || (hit !== null && node.contains(hit)),
            width: rect.width, height: rect.height, left: rect.left, right: rect.right, color: style.color, background: style.backgroundColor,
            outline: style.outlineStyle, outlineWidth: style.outlineWidth }
        })
        reports.push({ viewport: width, colorScheme, action: name, ...result })
        await check(`${name}: keyboard focused and unobscured`, result.focused && result.hit && result.left >= 0 && result.right <= width)
      }
      const overflow = async (state: string) => {
        const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth,
          offenders: [...document.querySelectorAll('main *')].filter(node => { const rect = node.getBoundingClientRect(); return rect.left < -1 || rect.right > window.innerWidth + 1 }).map(node => `${node.tagName}#${node.id}`) }))
        reports.push({ width, colorScheme, state, ...dimensions })
        await check(`${state}: no horizontal overflow ${JSON.stringify(dimensions)}`, dimensions.document <= width && dimensions.offenders.length === 0)
      }
      const secret = page.getByLabel('Client secret', { exact: true })
      await check('password secret', await secret.getAttribute('type') === 'password')
      await check('autofill hint', await secret.getAttribute('autocomplete') === 'new-password')
      await check('initial blank secret', await secret.inputValue() === '')
      await check('initial Save disabled', await page.getByRole('button', { name: 'Save', exact: true }).isDisabled())
      await check('runtime disabled visible', await page.getByRole('status').filter({ hasText: 'Runtime status: Disabled' }).isVisible())
      await overflow('initial')
      await page.screenshot({ path: join(evidence, `${width}-${colorScheme}-initial.png`), fullPage: true })
      const toggle = page.getByRole('switch', { name: 'Enable OIDC login' })
      await actionable('Enable switch', toggle)
      await page.keyboard.press('Space')
      await check('keyboard switch updates state', await toggle.getAttribute('aria-checked') === 'true')
      await page.getByLabel('Client ID', { exact: true }).fill('smoke-client')
      const reset = page.getByRole('button', { name: 'Reset', exact: true }).first()
      await check('Reset accessible', await reset.isVisible() && await reset.isEnabled())
      await actionable('Reset', reset)
      await reset.click()
      await check('Reset dispatch works', await page.getByLabel('Client ID', { exact: true }).inputValue() === 'dsh-owner-client')
      const numeric = page.getByLabel('Request timeout (seconds)', { exact: true })
      await check('numeric keyboard hint', await numeric.getAttribute('inputmode') === 'numeric')
      await numeric.fill('bad-number')
      await check('invalid field semantics', await numeric.getAttribute('aria-invalid') === 'true')
      await check('invalid text visible', await page.getByText('Enter a valid value.', { exact: true }).isVisible())
      await check('invalid prevents Save', await page.getByRole('button', { name: 'Save', exact: true }).isDisabled())
      await numeric.fill('20')
      await secret.fill('test-only-secret-never-real')
      await check('editing secret dispatch works', await secret.inputValue() === 'test-only-secret-never-real')
      await actionable('Save', page.getByRole('button', { name: 'Save', exact: true }))
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
      await check('saving disables input', await secret.isDisabled() && await toggle.isDisabled())
      await check('save called once', await page.evaluate(() => window.oidcFixture.counts().saved) === 1)
      await patch({ saving: false, failed: true, phase: 'failed', secret: '' })
      await check('save error visible', await page.getByRole('status').filter({ hasText: 'Save could not be completed.' }).isVisible())
      await check('runtime failure visible', await page.getByRole('status').filter({ hasText: 'OIDC startup failed' }).isVisible())
      await overflow('failed')
      await page.screenshot({ path: join(evidence, `${width}-${colorScheme}-failed.png`), fullPage: true })
      await patch({ writable: false, dirty: false, failed: false, phase: 'active' })
      await check('read-only notice visible', await page.getByRole('status').filter({ hasText: 'These settings are read-only.' }).isVisible())
      await check('read-only inputs disabled', await secret.isDisabled() && await toggle.isDisabled())
      await check('active runtime visible', await page.getByRole('status').filter({ hasText: 'OIDC login active' }).isVisible())
      await patch({ writable: true, credentialWritable: false, credentialUnknown: true, configured: false })
      await check('unknown credential visible', await page.getByText('Credential state unavailable; enabling is blocked.', { exact: true }).isVisible())
      await check('credential read-only disables secret', await secret.isDisabled())
      await overflow('unknown-credential')
      await page.screenshot({ path: join(evidence, `${width}-${colorScheme}-unknown-credential.png`), fullPage: true })
      await patch({ available: false })
      await check('unavailable status visible', await page.getByRole('status', { name: '' }).filter({ hasText: 'OIDC settings are unavailable.' }).isVisible())
      await check('unavailable hides controls', await page.locator('input,button').count() === 0)
      await context.close()
    }
    const result = { actualCard: cardPath, cardSha256: cardHash, primitives, runtimeRoot, evidence, checks, reports, failures }
    await writeFile(join(evidence, 'report.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    expect(failures).toEqual([])
  } finally {
    await browser?.close()
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    // stage is the exact private directory returned by mkdtemp above; screenshots are retained separately.
    const canonicalStage = await realpath(stage)
    const canonicalTmp = await realpath(tmpdir())
    if (canonicalStage !== stage || dirname(canonicalStage) !== canonicalTmp || !canonicalStage.startsWith(join(canonicalTmp, 'oidc-visual-smoke-'))) throw new Error('Unexpected fixture cleanup path')
    await rm(canonicalStage, { recursive: true, force: true })
  }
}, 90_000)
