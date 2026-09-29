import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const root = join(import.meta.dirname, '../..')

test('FASE5 typed client reuses transport, encodes ids, sends chat without authority and propagates conflicts', () => {
  const r = runTypeScriptScenario(`
    const { createTusWebClient, TusRequestError } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const calls = []
    const client = createTusWebClient({request: async q => { calls.push(q); if(q.path.endsWith('/start')) throw new TusRequestError('stale',409,'VERSION_CONFLICT'); return {items:[]} }})
    const session = {tenantId:'t',actorId:'a',correlationId:'c',accessToken:'secret'}
    await client.listMyWorks(session)
    await client.workSummary(session,'a/b')
    await client.workMessages(session,'a/b','2026-09-01T00:00:00Z')
    await client.sendWorkMessage(session,'a/b','WhatsApp +54 379 1234567','client-id-1')
    let conflict
    try {await client.startWork({...session,workId:'a/b',expectedVersion:4,idempotencyKey:'intent',requestHash:'hash'})} catch(e) {conflict=[e.status,e.code]}
    console.log(JSON.stringify({calls,conflict}))
  `)
  assert.equal(r.calls[0].path, '/tus/v1/mis-trabajos')
  assert.equal(r.calls[1].path, '/tus/v1/trabajos/a%2Fb/resumen')
  assert.match(r.calls[2].path, /antesDe=2026-09-01T00%3A00%3A00Z/)
  assert.deepEqual(r.calls[3].body, {
    text: 'WhatsApp +54 379 1234567',
    clientMessageId: 'client-id-1',
  })
  assert.deepEqual(r.conflict, [409, 'VERSION_CONFLICT'])
  assert.deepEqual(r.calls[4].body, { expectedVersion: 4, requestHash: 'hash' })
  assert.equal(r.calls[4].idempotencyKey, 'intent')
})

test(
  'FASE5 browser: list, empty, detail, capabilities, chat, retry, budget and 409 refresh',
  { timeout: 60000 },
  async () => {
    // Uses the repository's existing playwright-core and esbuild; no dev server or new dependency.
    const apiRequire = createRequire(join(root, 'apps/api/package.json'))
    const { chromium } = apiRequire('playwright-core')
    const { build } = createRequire(apiRequire.resolve('tsx/package.json'))('esbuild')
    const session = {
      tenantId: 'provider',
      actorId: 'actor',
      accessToken: 'fixture-token',
      correlationId: 'fixture-correlation',
    }
    const output = await build({
      stdin: {
        contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import {WorkDetail,WorkListContent} from './src/features/work/work-page'; import styles from './src/features/work/work.module.css'; import './src/app/globals.css'; const query=new QueryClient(); const root=createRoot(document.getElementById('root')); window.mount=(mode,work)=>root.render(<QueryClientProvider client={query}><div className={styles.page}>{mode==='detail'?<WorkDetail key={work.role} id="w1" session={${JSON.stringify(session)}}/>:<WorkListContent items={mode==='empty'?[]:[work]} provider={true}/>}</div></QueryClientProvider>);`,
        resolveDir: join(root, 'apps/web'),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      outfile: 'work-test.js',
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      define: {
        'process.env': '{}',
        'process.env.NODE_ENV': '"test"',
        'process.env.NEXT_PUBLIC_API_URL': '"https://tus.test"',
        'process.env.API_BASE_URL': '""',
      },
    })
    const chrome =
      process.env.TUS_TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    const browser = await chromium.launch({
      headless: true,
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
    })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const noActions = {
      canStart: false,
      canComplete: false,
      canCancel: false,
      canCreateBudget: false,
      canAcceptBudget: false,
      canRejectBudget: false,
      canSendMessage: true,
    }
    let work = {
      id: 'w1',
      origin: 'solicitud',
      solicitudId: 's1',
      status: 'accepted',
      version: 3,
      budgetRequired: true,
      createdAt: '2026-09-23T09:00:00Z',
      updatedAt: '2026-09-23T09:00:00Z',
      title: 'Reparar canilla',
      role: 'prestador',
      counterpart: { displayName: 'Laura M.', profession: null },
      request: {
        title: 'Reparar canilla',
        description: 'Pierde agua',
        category: 'Plomería',
        area: 'Centro',
        images: [],
      },
      budget: {
        presupuestoId: 'b1',
        version: 1,
        status: 'accepted',
        currency: 'ARS',
        totalMinor: '12345',
        scope: 'Reparación',
        validUntil: null,
      },
      actions: { ...noActions, canStart: true, canCancel: true },
    }
    const messages = [
      {
        id: 'm1',
        authorRole: 'cliente',
        mine: false,
        text: 'Mi WhatsApp es 379 1234567',
        createdAt: '2026-09-23T10:00:00Z',
      },
    ]
    const calls = []
    let failSend = true,
      failSummary = false,
      conflict = true
    await page.route('https://tus.test/**', async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname
      const json = (body, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (path === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html lang="es"><meta charset="utf-8"><div id="root"></div></html>',
        })
      calls.push({ path, method: req.method(), body: req.postDataJSON(), headers: req.headers() })
      if (path.includes('oficios'))
        return json({ items: [{ id: 'Plomería', label: 'Plomería' }], zones: [] })
      if (path.endsWith('/resumen'))
        return json(failSummary ? { error: 'failed' } : work, failSummary ? 500 : 200)
      if (path.endsWith('/mensajes') && req.method() === 'GET') return json({ items: messages })
      if (path.endsWith('/mensajes')) {
        if (failSend) {
          failSend = false
          return json({ error: 'temporary' }, 503)
        }
        const message = {
          id: 'm2',
          authorRole: 'prestador',
          mine: true,
          text: req.postDataJSON().text,
          createdAt: '2026-09-23T10:01:00Z',
        }
        messages.push(message)
        return json(message, 201)
      }
      if (path.endsWith('/start')) {
        work = {
          ...work,
          status: 'in_progress',
          version: 4,
          actions: { ...noActions, canComplete: true, canCancel: true },
        }
        if (conflict) {
          conflict = false
          return json({ code: 'VERSION_CONFLICT', error: 'stale' }, 409)
        }
      }
      if (path.endsWith('/accept'))
        work = {
          ...work,
          status: 'accepted',
          version: 6,
          budget: { ...work.budget, status: 'accepted' },
          actions: noActions,
        }
      if (path.endsWith('/reject'))
        work = {
          ...work,
          status: 'in_diagnosis',
          version: 7,
          budget: { ...work.budget, status: 'rejected' },
          actions: noActions,
        }
      if (path.endsWith('/budgets'))
        work = {
          ...work,
          status: 'budget_pending',
          version: 8,
          budget: { ...work.budget, status: 'issued' },
          actions: noActions,
        }
      return json({ status: 'executed' })
    })
    try {
      await page.goto('https://tus.test/')
      await page.addStyleTag({
        content: output.outputFiles.find((f) => f.path.endsWith('.css')).text,
      })
      await page.addScriptTag({
        content: output.outputFiles.find((f) => f.path.endsWith('.js')).text,
      })
      assert.deepEqual(errors, [], 'bundle initializes without runtime errors')
      await page.evaluate((w) => window.mount('empty', w), work)
      await page.getByText('Todavía no tenés trabajos asignados.').waitFor()
      await page.evaluate((w) => window.mount('list', w), work)
      assert.equal(
        await page.getByRole('link', { name: 'Ver trabajo' }).getAttribute('href'),
        '/trabajos/w1'
      )
      await page.evaluate((w) => window.mount('detail', w), work)
      await page.getByRole('heading', { name: 'Reparar canilla' }).waitFor()
      await page.getByText('Mi WhatsApp es 379 1234567').waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Aceptar presupuesto', exact: true }).count(),
        0
      )
      assert.equal(
        await page.getByRole('button', { name: 'Enviar', exact: true }).isDisabled(),
        true
      )
      const text = '<img src=x onerror="alert(1)"> mail@ejemplo.com +54 379 1234567'
      await page.getByLabel('Tu mensaje').fill(text)
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'No pudimos enviar' }).waitFor()
      assert.equal(await page.getByLabel('Tu mensaje').inputValue(), text)
      await page.getByRole('button', { name: 'Enviar', exact: true }).click()
      await page.getByText(text, { exact: true }).waitFor()
      assert.equal(await page.locator('[role=log] img').count(), 0)
      const sends = calls.filter((c) => c.path.endsWith('/mensajes') && c.method === 'POST')
      assert.equal(sends.length, 2)
      assert.equal(sends[0].body.clientMessageId, sends[1].body.clientMessageId)
      assert.equal(await page.getByLabel('Tu mensaje').getAttribute('maxlength'), '2000')
      await page.getByRole('button', { name: 'Iniciar trabajo', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'El trabajo cambió' }).waitFor()
      await page.getByRole('button', { name: 'Marcar como terminado' }).waitFor()
      assert.equal(calls.filter((c) => c.path.endsWith('/start')).length, 1)
      const start = calls.find((c) => c.path.endsWith('/start'))
      assert.equal(start.body.expectedVersion, 3)
      assert.ok(start.headers['idempotency-key'])
      assert.ok(start.body.requestHash)
      failSummary = true
      await page.getByRole('button', { name: 'Actualizar trabajo', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'No pudimos actualizar' }).waitFor()
      failSummary = false
      work = {
        ...work,
        role: 'cliente',
        status: 'budget_pending',
        version: 5,
        budget: { ...work.budget, status: 'issued' },
        actions: { ...noActions, canAcceptBudget: true, canRejectBudget: true },
      }
      await page.evaluate((w) => window.mount('detail', w), work)
      await page.getByRole('button', { name: 'Aceptar presupuesto', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Cancelar', exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Marcar como terminado' }).count(), 0)
      await page.getByRole('button', { name: 'Aceptar presupuesto', exact: true }).click()
      await page.getByText('Presupuesto aceptado · Versión 1').waitFor()
      await page.getByText('Pago pendiente de configuración.').waitFor()
      assert.equal(calls.find((c) => c.path.endsWith('/accept')).body.budgetId, 'b1')
      work = { ...work, status: 'budget_pending', actions: { ...noActions, canRejectBudget: true } }
      await page.getByRole('button', { name: 'Actualizar trabajo', exact: true }).click()
      await page.getByRole('button', { name: 'Rechazar presupuesto', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Escribí el motivo' }).waitFor()
      assert.equal(calls.filter((c) => c.path.endsWith('/reject')).length, 0)
      await page.getByLabel('Motivo de rechazo').fill('Necesito otro alcance')
      await page.getByRole('button', { name: 'Rechazar presupuesto', exact: true }).click()
      await page.getByText('Presupuesto rechazado · Versión 1').waitFor()
      assert.equal(
        calls.find((c) => c.path.endsWith('/reject')).body.reason,
        'Necesito otro alcance'
      )
      work = {
        ...work,
        role: 'prestador',
        status: 'requested',
        actions: { ...noActions, canCreateBudget: true },
      }
      await page.evaluate((w) => window.mount('detail', w), work)
      await page.getByLabel('Alcance del presupuesto').fill('Cambiar cuerito')
      await page.getByLabel('Monto en pesos (ARS)').fill('120,50')
      await page.getByRole('button', { name: 'Crear presupuesto', exact: true }).click()
      await page.getByText('Esperando decisión del Cliente · Versión 1').waitFor()
      assert.equal(calls.find((c) => c.path.endsWith('/budgets')).body.totalMinor, '12050')
      // FASE7: deposit/balance block. Provider never sees pay buttons; a provider without Mercado
      // Pago is explained, not skipped; the client pays with an intent key and no amount.
      const payment = { required: true, online: true, unavailableReason: null, currency: 'ARS', totalMinor: '100001', deposit: { amountMinor: '50001', status: 'not_created' }, balance: { amountMinor: '50000', status: 'not_created' } }
      work = { ...work, role: 'prestador', status: 'accepted', budget: { ...work.budget, status: 'accepted' }, payment, actions: { ...noActions } }
      await page.evaluate((w) => window.mount('detail', w), work)
      await page.getByText('Podés iniciar el trabajo cuando se acredite la seña.').waitFor()
      assert.equal(await page.getByRole('button', { name: /Pagar/u }).count(), 0)
      work = { ...work, payment: { ...payment, online: false, unavailableReason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' } }
      await page.evaluate((w) => window.mount('detail', w), { ...work, role: 'cliente' })
      await page.getByText('El prestador debe conectar Mercado Pago antes de poder cobrar este trabajo.').waitFor()
      await page.route('https://www.mercadopago.com.ar/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>checkout</p>' }))
      const checkouts = []
      await page.route('https://tus.test/tus/v1/work/**', (route) => {
        checkouts.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] })
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'created', checkoutUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=x', payment: { paymentId: 'p1', providerStatus: 'pending', dispatchStatus: 'dispatched' } }) })
      })
      work = { ...work, role: 'cliente', payment, actions: { ...noActions, canPayDeposit: true } }
      await page.evaluate((w) => window.mount('detail', w), work)
      await page.getByText(/Seña: \$\s?500,01 · Pendiente/u).waitFor()
      await page.getByRole('button', { name: 'Pagar seña con Mercado Pago', exact: true }).click()
      await page.waitForURL('https://www.mercadopago.com.ar/**')
      assert.equal(checkouts.length, 1)
      assert.deepEqual(checkouts[0].body, {})
      assert.match(checkouts[0].key, /^w1:deposit:/u)
      // Back from Mercado Pago the page only observes; it never confirms the payment itself.
      await page.goto('https://tus.test/?pago=retorno')
      await page.addStyleTag({ content: output.outputFiles.find((f) => f.path.endsWith('.css')).text })
      await page.addScriptTag({ content: output.outputFiles.find((f) => f.path.endsWith('.js')).text })
      work = { ...work, actions: { ...noActions } }
      await page.evaluate((w) => window.mount('detail', w), work)
      await page.getByText('Estamos confirmando tu pago con Mercado Pago. Esta pantalla se actualiza sola.').waitFor()
      assert.equal(checkouts.length, 1)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true
      )
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true
      )
      const screenshots = mkdtempSync(join(tmpdir(), 'tus-phase5-web-'))
      await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true })
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true })
      console.log('FASE5 screenshots: ' + screenshots)
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  }
)

test('FASE5 request and provider navigation links use server workId and disallow cancelling a matched request', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8')
  const own = read('apps/web/src/features/requests/my-requests.tsx')
  assert.match(own, /Ver trabajo y mensajes/)
  assert.match(own, /encodeURIComponent\(item.workId\)/)
  assert.match(own, /!item.workId && item.assignment !== 'aceptada'/)
  assert.match(own, /WORK_ACTIVE/)
  assert.match(
    read('apps/web/src/features/provider/provider-open-requests.tsx'),
    /encodeURIComponent\(application.request.workId\)/
  )
  assert.match(
    read('apps/web/src/features/provider/provider-inbox.tsx'),
    /encodeURIComponent\(item.workId\)/
  )
  assert.match(read('apps/web/src/features/home/public-header.tsx'), /Mis trabajos/)
})
