import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

test('PR3 exposes coherent Argentina-first manifest metadata and real icon entries', () => {
  const result = runTypeScriptScenario(`
    const module = await import('./apps/web/src/app/manifest.ts')
    const manifest = typeof module.default === 'function' ? module.default : module.default.default
    console.log(JSON.stringify(manifest()))
  `)

  assert.equal(result.name, 'TUS platform')
  assert.equal(result.short_name, 'TUS')
  assert.match(result.description, /Argentina/i)
  assert.equal(result.start_url, '/tus')
  assert.equal(result.display, 'standalone')
  assert.equal(result.background_color, '#f4f0e7')
  assert.equal(result.theme_color, '#f4f0e7')
  assert.deepEqual(result.icons, [
    { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
  ])
})

test('PR3 keeps the responsive field-notes system mobile-first and safe for long content', () => {
  const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8')
  const layout = readFileSync(join(root, 'apps/web/src/app/layout.tsx'), 'utf8')

  assert.match(layout, /export const viewport/)
  assert.match(layout, /viewportFit:\s*['"]cover['"]/)
  assert.match(layout, /themeColor:\s*['"]#f4f0e7['"]/)
  assert.match(css, /env\(safe-area-inset-top(?:,|\))/)
  assert.match(css, /100dvh/)
  assert.match(css, /@media\s*\(min-width:/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
  assert.match(css, /overflow-x:\s*auto/)
  assert.match(css, /min-height:\s*44px/)
  assert.doesNotMatch(css, /\.tus-nav-links\s*\{\s*display:\s*none/)
  assert.doesNotMatch(css, /transition:\s*all/)
})

test('PR3 keeps narrow recovery and POS controls reachable when content grows', () => {
  const css = readFileSync(join(root, 'apps/web/src/app/globals.css'), 'utf8')
  const pos = readFileSync(join(root, 'apps/web/src/app/tus/tus-pos.tsx'), 'utf8')
  const recovery = readFileSync(join(root, 'apps/web/src/app/(auth)/recovery/page.tsx'), 'utf8')

  assert.match(css, /@media\s*\(max-width:\s*720px\)/)
  assert.match(css, /\.tus-pos-controls\s*\{[\s\S]*grid-template-columns:\s*1fr/)
  assert.match(css, /\.tus-action-link\s*\{[\s\S]*display:\s*inline-flex/)
  assert.match(css, /\.tus-auth-panel\s*\{[\s\S]*min-width:\s*0/)
  assert.match(pos, /inputMode="decimal"/)
  assert.match(pos, /autoComplete="off"/)
  assert.match(recovery, /aria-labelledby="recovery-title"/)
})

test('PR3 ships every manifest icon asset referenced by the web app', () => {
  for (const icon of ['icon-192.svg', 'icon-512.svg']) {
    assert.equal(existsSync(join(root, 'apps/web/public', icon)), true, `${icon} must exist`)
    assert.match(readFileSync(join(root, 'apps/web/public', icon), 'utf8'), /<svg[^>]+viewBox=/)
  }
})

test('PR4 declares the canonical en-AR document, metadata, and manifest language', () => {
  const result = runTypeScriptScenario(`
    const { readFileSync } = await import('node:fs')
    const manifestModule = await import('./apps/web/src/app/manifest.ts')
    const manifest = (typeof manifestModule.default === 'function' ? manifestModule.default : manifestModule.default.default)()
    const layout = readFileSync('./apps/web/src/app/layout.tsx', 'utf8')
    console.log(JSON.stringify({ layout, manifest }))
  `)

  assert.equal(result.manifest.lang, 'en-AR')
  assert.match(result.layout, /metadataBase:\s*new URL\(resolveTusPublicOrigin\(\)\)/)
  assert.match(result.layout, /alternates:\s*\{ canonical: '\/' \}/)
  assert.match(result.layout, /<html lang=\{TUS_LOCALE\}>/)
  assert.doesNotMatch(JSON.stringify(result), /lang["']?:["']es-AR/)
})

test('PR5 separates installability from offline operation when no service worker exists', () => {
  const manifest = readFileSync(join(root, 'apps/web/src/app/manifest.ts'), 'utf8')
  const landing = readFileSync(join(root, 'apps/web/src/app/page.tsx'), 'utf8')
  const sourceFiles = readdirSync(join(root, 'apps/web'), { recursive: true }).join('\n')

  assert.match(manifest, /online\s+operation\s+requires\s+connectivity/i)
  assert.match(landing, /online\s+operation\s+requires\s+connectivity/i)
  assert.doesNotMatch(sourceFiles, /service-worker|\.sw\./i)
})
