import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { IDENTITY_SETUP } from './fixtures/identidad.mjs'

test('IDENTITY-NOSIS domain: CUIL checksum/prefix/DNI coherence, normalization and strict name matching', () => {
  const result = runTypeScriptScenario(`
    const m = await import('./apps/api/src/tus/identidad/modelo.ts')
    console.log(JSON.stringify({
      valid: m.validarCuil('20-30111222-0', '30111222'),
      checksum: m.validarCuil('20301112221').reason,
      prefix: m.validarCuil('30301112220').reason,
      format: m.validarCuil('2030111222').reason,
      mismatch: m.validarCuil('20301112220', '30111223').reason,
      dni: [m.normalizarDni('30.111.222'), m.normalizarDni('030111222'), m.normalizarDni('12a'), m.normalizarDni('1234567890')],
      name: m.normalizarNombre('  José   María  Núñez '),
      match: m.compararNombre({ firstName: 'José', lastName: 'Pérez Gómez' }, 'PEREZ GOMEZ, JOSE'),
      partial: m.compararNombre({ firstName: 'Juan', lastName: 'Prueba' }, 'PRUEBA, JUAN IGNACIO'),
      mismatch2: m.compararNombre({ firstName: 'Juan', lastName: 'Prueba' }, 'PRUEBAS, JUAN'),
      noFuzzy: m.compararNombre({ firstName: 'Jose', lastName: 'Perez' }, 'PERES, JOSE'),
      masked: [m.enmascararDni('30111222'), m.enmascararCuil('20301112220')],
      reconcile: m.reconciliarLecturas({ reader: 'ocr', documentNumber: '30111222', firstName: 'JUAN', lastName: 'PRUEBA', birthDate: null, sex: null, nationality: null, expirationDate: null, confidence: 0.9 }, { reader: 'vision', documentNumber: '30111229', firstName: 'JUAN', lastName: 'PRUEBA', birthDate: null, sex: null, nationality: null, expirationDate: null, confidence: 0.9 }),
      lowConfidence: m.reconciliarLecturas({ reader: 'ocr', documentNumber: '30111222', firstName: null, lastName: null, birthDate: null, sex: null, nationality: null, expirationDate: null, confidence: 0.3 }, { reader: 'vision', documentNumber: '30111222', firstName: null, lastName: null, birthDate: null, sex: null, nationality: null, expirationDate: null, confidence: 0.9 }),
      retries: [1, 2, 3, 4].map((n) => { const at = m.proximoReintento(n, 0); return at === null ? null : at / 60000 }),
    }))
  `)
  assert.deepEqual(result.valid, { valid: true, cuil: '20301112220', reason: null })
  assert.equal(result.checksum, 'CHECKSUM')
  assert.equal(result.prefix, 'PREFIX')
  assert.equal(result.format, 'FORMAT')
  assert.equal(result.mismatch, 'DOCUMENT_MISMATCH')
  assert.deepEqual(result.dni, ['30111222', '30111222', null, null])
  assert.equal(result.name, 'JOSE MARIA NUNEZ')
  assert.equal(result.match, 'match')
  assert.equal(result.partial, 'partial')
  assert.equal(result.mismatch2, 'mismatch')
  assert.equal(result.noFuzzy, 'mismatch')
  assert.deepEqual(result.masked, ['***222', '20-*****222-0'])
  assert.deepEqual(result.reconcile, { status: 'review', reason: 'DOCUMENT_READER_MISMATCH' })
  assert.deepEqual(result.lowConfidence, { status: 'review', reason: 'DOCUMENT_LOW_CONFIDENCE' })
  assert.deepEqual(result.retries, [5, 15, 60, null])
})

test('IDENTITY-NOSIS OCR: TD1 MRZ with check digits; Groq vision adapter uses GROQ_API_KEY, base64 images and strict validation', () => {
  const result = runTypeScriptScenario(`
    const l = await import('./apps/api/src/tus/identidad/lectores.ts')
    const pad = (value, n) => value.padEnd(n, '<')
    const doc = '30111222<'
    const l1 = pad('IDARG' + doc + l.digitoControlMrz(doc), 30)
    const l2 = pad('830405' + l.digitoControlMrz('830405') + 'M' + '310101' + l.digitoControlMrz('310101') + 'ARG', 30)
    const l3 = pad('PRUEBA<DEMO<<JUAN', 30)
    const mrz = l.interpretarTextoDni(['REPUBLICA ARGENTINA', l1, l2, l3].join('\\n'), 0.95)
    const broken = l.interpretarTextoDni([l1.replace('30111222', '30111223'), l2, l3].join('\\n'), 0.95)
    const requests = []
    const reply = (content, status = 200, finish = 'stop') => async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }), { status })
    }
    const images = [{ side: 'front', mimeType: 'image/png', bytes: Buffer.from('front') }, { side: 'back', mimeType: 'image/jpeg', bytes: Buffer.from('back') }]
    const good = JSON.stringify({ legible: true, document_number: '30.111.222', first_name: ' JUAN ', last_name: 'PRUEBA DEMO', birth_date: '1983-04-05', sex: 'M', nationality: 'ARG', expiration_date: '01/01/2031', confidence: 1.4, invented_cuil: '20301112220' })
    const read = (fetchImpl, extra = {}) => new l.VisionIdentityDocumentReader(new l.ModeloVisionGroq({ apiKey: 'gsk_test_key', fetch: fetchImpl, ...extra })).leer(images)
    const ok = await read(reply('<think>x</think>' + good))
    const body = JSON.parse(requests[0].init.body)
    const strict = await read(reply(good), { responseFormat: 'json_schema', model: 'meta-llama/llama-4-scout-17b-16e-instruct' })
    const strictBody = JSON.parse(requests[1].init.body)
    const illegible = await read(reply(JSON.stringify({ ...JSON.parse(good), legible: false })))
    const badSchema = await read(reply(JSON.stringify({ legible: true, document_number: 30111222 })))
    const httpError = await read(reply('{}', 500))
    const truncated = await read(reply(good, 200, 'length'))
    const notJson = await read(reply('lo siento'))
    let missingKey = 'none'
    try { new l.ModeloVisionGroq({ apiKey: '' }) } catch (error) { missingKey = error.message }
    const noModel = await new l.VisionIdentityDocumentReader(null).leer(images)
    console.log(JSON.stringify({ mrz, broken, ok, strict: strict.documentNumber, illegible: illegible.confidence, badSchema: badSchema.unavailable, httpError: httpError.unavailable && httpError.transient, noModelTransient: Boolean((await new l.VisionIdentityDocumentReader(null).leer(images)).transient), truncated: truncated.unavailable, notJson: notJson.unavailable, missingKey, noModel: noModel.unavailable,
      url: requests[0].url, auth: requests[0].init.headers.authorization, model: body.model, format: body.response_format, images: body.messages[1].content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url.slice(0, 22)), temperature: body.temperature, strictFormat: strictBody.response_format.type, strictFlag: strictBody.response_format.json_schema.strict, strictModel: strictBody.model }))
  `)
  assert.equal(result.mrz.documentNumber, '30111222')
  assert.equal(result.mrz.lastName, 'PRUEBA DEMO')
  assert.equal(result.mrz.firstName, 'JUAN')
  assert.equal(result.mrz.birthDate, '1983-04-05')
  assert.equal(result.mrz.expirationDate, '2031-01-01')
  assert.equal(result.mrz.sex, 'M')
  assert.ok(result.mrz.confidence >= 0.9)
  assert.ok(result.broken.confidence <= 0.3, 'bad document check digit is low confidence')
  // Groq: Bearer GROQ_API_KEY, OpenAI-compatible endpoint, base64 data URLs, JSON output.
  assert.equal(result.url, 'https://api.groq.com/openai/v1/chat/completions')
  assert.equal(result.auth, 'Bearer gsk_test_key')
  assert.equal(result.model, 'qwen/qwen3.8-27b')
  assert.deepEqual(result.format, { type: 'json_object' })
  assert.deepEqual(result.images, ['data:image/png;base64,', 'data:image/jpeg;base64'])
  assert.equal(result.temperature, 0)
  assert.equal(result.strictFormat, 'json_schema')
  assert.equal(result.strictFlag, true)
  assert.equal(result.strictModel, 'meta-llama/llama-4-scout-17b-16e-instruct')
  // Validated output: digits normalized, invalid date dropped, confidence clamped, no invented fields.
  assert.equal(result.ok.documentNumber, '30111222')
  assert.equal(result.ok.firstName, 'JUAN')
  assert.equal(result.ok.expirationDate, null)
  assert.equal(result.ok.confidence, 1)
  assert.equal('invented_cuil' in result.ok, false)
  assert.equal(result.strict, '30111222')
  assert.equal(result.illegible, 0)
  assert.equal(result.badSchema, true)
  assert.equal(result.httpError, true)
  assert.equal(result.truncated, true)
  assert.equal(result.notJson, true)
  assert.match(result.missingKey, /GROQ_API_KEY/u)
  assert.equal(result.noModel, true)
  // No vision configured is permanent (review), a provider outage is transient (retry).
  assert.equal(result.noModelTransient, false)
})

test('IDENTITY-NOSIS upload security: magic bytes, SVG/HTML rejected, corrupt/small rejected, metadata stripped, consent first, encrypted at rest', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    const c = ctx(1)
    const beforeConsent = await codeOfId(() => identity.subirDocumento(c, 'front', png('30111222|PRUEBA DEMO|JUAN')))
    const badConsent = await codeOfId(() => identity.aceptarConsentimiento(c, { accepted: 'yes', consentVersion: VERSION_CONSENTIMIENTO_IDENTIDAD }))
    const view = await identity.aceptarConsentimiento(c, { accepted: true, consentVersion: VERSION_CONSENTIMIENTO_IDENTIDAD })
    const svg = Buffer.concat([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.alloc(9000, 32)])
    const html = Buffer.concat([Buffer.from('<!doctype html><html>'), Buffer.alloc(9000, 32)])
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(9000, 1)])
    const codes = {
      svg: await codeOfId(() => identity.subirDocumento(c, 'front', svg)),
      html: await codeOfId(() => identity.subirDocumento(c, 'front', html)),
      exe: await codeOfId(() => identity.subirDocumento(c, 'front', exe)),
      small: await codeOfId(() => identity.subirDocumento(c, 'front', png('x').subarray(0, 100))),
      corrupt: await codeOfId(() => identity.subirDocumento(c, 'front', png('30111222|PRUEBA DEMO|JUAN').subarray(0, 9020))),
      empty: await codeOfId(() => identity.subirDocumento(c, 'front', Buffer.alloc(0))),
      notBuffer: await codeOfId(() => identity.subirDocumento(c, 'front', 'hola')),
      side: await codeOfId(() => identity.subirDocumento(c, 'left', png('a'))),
      tooLarge: await codeOfId(() => identity.subirDocumento(c, 'front', Buffer.alloc(9 * 1024 * 1024, 0))),
      submitWithoutBack: 'pending',
    }
    await identity.subirDocumento(c, 'front', png('30111222|PRUEBA DEMO|JUAN', [['tEXt', 'GPSLatitude -34.6'], ['eXIf', 'Exif GPS data']]))
    codes.submitWithoutBack = await codeOfId(() => identity.enviar(c))
    const stored = [...identityStore.state.documentos.values()][0]
    const reviewCopy = await identity.documentoParaRevision(stored.verificationId, 'front')
    const audit = identityStore.state.auditoria.find((event) => event.action === 'verification.document_uploaded')
    console.log(JSON.stringify({ beforeConsent, badConsent, consentText: view.consentText, consentAccepted: view.consentAccepted, codes, mime: stored.mimeType, plaintextStored: [png('30111222|PRUEBA DEMO|JUAN').toString('base64').slice(0, 24), png('30111222|PRUEBA DEMO|JUAN').toString('base64url').slice(0, 24)].some((prefix) => stored.ciphertext.includes(prefix)), reviewHasGps: reviewCopy.bytes.includes(Buffer.from('GPS')), reviewHasPng: reviewCopy.bytes.subarray(1, 4).toString(), removed: audit.metadata.removedMetadata }))
  `)
  assert.equal(result.beforeConsent, 'CONSENT_REQUIRED')
  assert.equal(result.badConsent, 'CONSENT_REQUIRED')
  assert.equal(
    result.consentText,
    'Autorizo a TUS a verificar los datos de identidad proporcionados mediante fuentes externas de validación con el fin de validar mi alta como prestador.'
  )
  assert.equal(result.consentAccepted, true)
  assert.deepEqual(result.codes, {
    svg: 'DOCUMENT_TYPE_NOT_ALLOWED',
    html: 'DOCUMENT_TYPE_NOT_ALLOWED',
    exe: 'DOCUMENT_TYPE_NOT_ALLOWED',
    small: 'DOCUMENT_TOO_SMALL',
    corrupt: 'DOCUMENT_CORRUPT',
    empty: 'DOCUMENT_EMPTY',
    notBuffer: 'DOCUMENT_EMPTY',
    side: 'INVALID_SIDE',
    tooLarge: 'DOCUMENT_TOO_LARGE',
    submitWithoutBack: 'DOCUMENTS_REQUIRED',
  })
  assert.equal(result.mime, 'image/png')
  assert.equal(result.plaintextStored, false)
  assert.equal(result.reviewHasGps, false)
  assert.equal(result.reviewHasPng, 'PNG')
  assert.deepEqual(result.removed, ['tEXt', 'eXIf'])
})

test('IDENTITY-NOSIS pipeline: HTTP answers "queued" without searching; worker reads, queries once and verifies with minimal snapshot', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    const submitted = await submitIdentity(1, '30111222|PRUEBA DEMO|JUAN')
    const searchesAfterSubmit = demo.searches.length
    const queuedView = await identity.estado(ctx(1))
    const gateBefore = await identity.identidadVerificada(ctx(1).tenantId)
    const outcomes = await drain()
    const v = await latest(1)
    const view = await identity.estado(ctx(1))
    const gateAfter = await identity.identidadVerificada(ctx(1).tenantId)
    const otherTenant = await identity.estado(ctx(2))
    const actions = identityStore.state.auditoria.map((event) => event.action)
    const auditText = JSON.stringify(identityStore.state.auditoria) + JSON.stringify(logs)
    const workerState = await identity.estadoWorker()
    console.log(JSON.stringify({ submitted, searchesAfterSubmit, queuedStatus: queuedView.status, queuedMessage: queuedView.message, gateBefore, outcomes, status: v.status, method: v.verificationMethod, cuil: v.verifiedCuil, snapshot: v.externalSnapshot, readers: readerCalls, searches: demo.searches.length, viewStatus: view.status, masked: view.documentNumberMasked, gateAfter, otherTenant: otherTenant.status, actions, leaksDni: auditText.includes('30111222'), leaksCuil: auditText.includes('20301112220'), used: workerState.used, max: workerState.max }))
  `)
  assert.equal(result.submitted.status, 'queued')
  assert.equal(
    result.submitted.message,
    'Tu documentación está siendo verificada. Te avisaremos cuando finalice el proceso.'
  )
  assert.equal(result.searchesAfterSubmit, 0)
  assert.equal(result.queuedStatus, 'queued')
  assert.equal(result.queuedMessage, result.submitted.message)
  assert.equal(result.gateBefore, false)
  assert.deepEqual(result.outcomes, ['read', 'checked', 'idle'])
  assert.equal(result.status, 'verified')
  assert.equal(result.method, 'demo')
  assert.equal(result.cuil, '20301112220')
  assert.deepEqual(result.snapshot, { resultCount: 1, nameMatch: 'match', cuilValid: true })
  assert.deepEqual(result.readers, { ocr: 1, vision: 1 })
  assert.equal(result.searches, 1)
  assert.equal(result.viewStatus, 'verified')
  assert.equal(result.masked, '***222')
  assert.equal(result.gateAfter, true)
  assert.equal(result.otherTenant, 'not_started')
  for (const action of [
    'verification.created',
    'verification.queued',
    'verification.processing',
    'verification.verified',
  ])
    assert.ok(result.actions.includes(action), action)
  assert.equal(result.leaksDni, false)
  assert.equal(result.leaksCuil, false)
  assert.equal(result.used, 1)
  assert.equal(result.max, 7)
})

test('IDENTITY-NOSIS decisions: not found, ambiguous, second name, name mismatch, reader mismatch and duplicate DNI', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    await submitIdentity(1, '30111223|PRUEBA DEMO|JUAN')
    await submitIdentity(2, '30111224|PRUEBA UNO|ANA')
    await submitIdentity(3, '30111225|PRUEBA DEMO|JUAN')
    await submitIdentity(4, '30111226|PRUEBA DEMO|JUAN')
    await submitIdentity(5, '30111222|PRUEBA DEMO|JUAN|30111229')
    await submitIdentity(6, '30111222|PRUEBA DEMO|JUAN')
    await drain()
    const searchesBeforeDuplicate = demo.searches.length
    await submitIdentity(7, '30111222|PRUEBA DEMO|JUAN')
    await drain()
    const out = {}
    for (const n of [1, 2, 3, 4, 5, 6, 7]) { const v = await latest(n); out[n] = [v.status, v.reviewReason] }
    console.log(JSON.stringify({ out, searchesBeforeDuplicate, searches: demo.searches.length, rejectedView: (await identity.estado(ctx(4))).message }))
  `)
  assert.deepEqual(result.out['1'], ['review_required', 'NOSIS_NOT_FOUND'])
  assert.deepEqual(result.out['2'], ['review_required', 'NOSIS_AMBIGUOUS_RESULT'])
  assert.deepEqual(result.out['3'], ['review_required', 'NAME_PARTIAL_MATCH'])
  assert.deepEqual(result.out['4'], ['rejected', 'NAME_MISMATCH'])
  assert.deepEqual(result.out['5'], ['review_required', 'DOCUMENT_READER_MISMATCH'])
  assert.deepEqual(result.out['6'], ['verified', null])
  assert.deepEqual(result.out['7'], ['review_required', 'IDENTITY_ALREADY_VERIFIED'])
  // Reader mismatch and duplicate DNI never spend a Nosis query.
  assert.equal(result.searchesBeforeDuplicate, 5)
  assert.equal(result.searches, 5)
  assert.match(result.rejectedView, /No pudimos verificar/u)
})

test('IDENTITY-NOSIS rate limit: 7 searches per sliding hour, the 8th waits in FIFO order, restart and second worker respect it', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    for (let n = 1; n <= 9; n += 1) { await submitIdentity(n, '30111223|PRUEBA DEMO|JUAN'); advance(1000) }
    const order = []
    const firstPass = await drain(100)
    const afterFirst = demo.searches.length
    const status = await identity.estadoWorker()
    const eighth = await latest(8)
    // A new worker process (restart) and a second concurrent worker still see the full window.
    const restarted = makeWorker('worker-restarted')
    const other = makeWorker('worker-b')
    const concurrent = await Promise.all([restarted.procesarSiguiente(), other.procesarSiguiente()])
    const afterRestart = demo.searches.length
    advance(59 * 60_000)
    const stillBlocked = await worker.procesarSiguiente()
    advance(2 * 60_000)
    const resumed = await Promise.all([worker.procesarSiguiente(), other.procesarSiguiente()])
    const eighthAfter = await latest(8)
    const ninthAfter = await latest(9)
    const consultas = identityStore.state.consultas.map((item) => item.verificationId)
    const verificationOrder = []
    for (let n = 1; n <= 9; n += 1) verificationOrder.push((await latest(n)).verificationId)
    console.log(JSON.stringify({ firstPass, afterFirst, status: [status.status, status.used, status.max, status.pending, Boolean(status.nextEligibleAt)], eighthStatus: eighth.status, concurrent: concurrent.map((r) => r.outcome), afterRestart, stillBlocked: stillBlocked.outcome, resumed: resumed.map((r) => r.outcome), searches: demo.searches.length, eighthAfter: eighthAfter.status, ninthAfter: ninthAfter.status, fifo: JSON.stringify(consultas) === JSON.stringify(verificationOrder.slice(0, consultas.length)) }))
  `)
  assert.equal(result.afterFirst, 7)
  assert.deepEqual(result.status.slice(0, 3), ['rate_limited', 7, 7])
  assert.equal(result.status[3], 2)
  assert.equal(result.status[4], true)
  assert.equal(result.eighthStatus, 'queued')
  assert.deepEqual(result.concurrent, ['idle', 'idle'])
  assert.equal(result.afterRestart, 7)
  assert.equal(result.stillBlocked, 'idle')
  // One more hour: exactly two more searches, oldest first, never two for the same job.
  assert.deepEqual(result.resumed.sort(), ['checked', 'checked'])
  assert.equal(result.searches, 9)
  assert.equal(result.eighthAfter, 'review_required')
  assert.equal(result.ninthAfter, 'review_required')
  assert.equal(result.fifo, true)
})

test('IDENTITY-NOSIS lease: a crashed worker lease expires and another worker takes the job exactly once', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    await submitIdentity(1, '30111222|PRUEBA DEMO|JUAN')
    await identityTx.ejecutar((r) => r.cola.tomarSiguiente({ owner: 'crashed', now: new Date(nowMs).toISOString(), leaseUntil: new Date(nowMs + 300000).toISOString(), stages: ['lectura', 'consulta'] }))
    const whileLeased = await worker.procesarSiguiente()
    advance(301000)
    const outcomes = await drain()
    const lateWrite = await identityTx.ejecutar(async (r) => { const job = [...identityStore.state.cola.values()][0]; return r.cola.actualizar({ ...job, status: 'queued' }, 'crashed') })
    console.log(JSON.stringify({ whileLeased: whileLeased.outcome, outcomes, status: (await latest(1)).status, searches: demo.searches.length, lateWrite }))
  `)
  assert.equal(result.whileLeased, 'idle')
  assert.deepEqual(result.outcomes, ['read', 'checked', 'idle'])
  assert.equal(result.status, 'verified')
  assert.equal(result.searches, 1)
  assert.equal(result.lateWrite, false)
})

test('IDENTITY-NOSIS session: external challenge pauses searches (never rejects), readings continue, restored session resumes', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    demo.requerirSesion('NOSIS_CHALLENGE_REQUIRED')
    await submitIdentity(1, '30111222|PRUEBA DEMO|JUAN')
    const first = await drain()
    const v1 = await latest(1)
    const waitingView = (await identity.estado(ctx(1))).message
    const state = await identity.estadoWorker()
    advance(1000)
    await submitIdentity(2, '30111225|PRUEBA DEMO|JUAN IGNACIO')
    const second = await drain()
    const v2 = await latest(2)
    demo.requerirSesion(null)
    await marcarSesionRestaurada(identityTx, 'demo', 'operator', identityClock)
    const third = await drain()
    const actions = identityStore.state.auditoria.map((event) => event.action)
    console.log(JSON.stringify({ first, v1: v1.status, view: waitingView, state: state.status, slots: state.used, second, v2: v2.status, third, final: [(await latest(1)).status, (await latest(2)).status], searches: demo.searches, actions: actions.filter((a) => a.startsWith('nosis.')) }))
  `)
  assert.deepEqual(result.first, ['read', 'session_required', 'idle'])
  assert.equal(result.v1, 'session_required')
  assert.equal(
    result.view,
    'Tu documentación está siendo verificada. Te avisaremos cuando finalice el proceso.'
  )
  assert.equal(result.state, 'session_required')
  assert.equal(result.slots, 0)
  // While the session is missing, OCR/vision still run but no search is attempted.
  assert.deepEqual(result.second, ['read', 'idle'])
  assert.equal(result.v2, 'queued')
  assert.deepEqual(result.third, ['checked', 'checked', 'idle'])
  assert.deepEqual(result.final, ['verified', 'verified'])
  assert.deepEqual(result.searches, ['30111222', '30111225'])
  assert.deepEqual(result.actions, ['nosis.session_required', 'nosis.session_restored'])
})

test('IDENTITY-NOSIS retries 5/15/60 min then review; slots consumed when submitted; circuit opens after 5 consecutive errors', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    demo.fallarProximas('NOSIS_NETWORK', 'NOSIS_LAYOUT_CHANGED', 'NOSIS_UNAVAILABLE', 'NOSIS_NETWORK')
    await submitIdentity(1, '30111222|PRUEBA DEMO|JUAN')
    const waits = []
    const statuses = []
    for (let i = 0; i < 4; i += 1) {
      const outcomes = await drain()
      const v = await latest(1)
      statuses.push(v.status)
      const job = [...identityStore.state.cola.values()].find((j) => j.verificationId === v.verificationId && j.status === 'queued')
      if (job) { waits.push((Date.parse(job.availableAt) - nowMs) / 60000); advance(Date.parse(job.availableAt) - nowMs) }
    }
    const final = await latest(1)
    const used = identityStore.state.consultas.length
    demo.fallarProximas('NOSIS_NETWORK')
    await submitIdentity(2, '30111222|PRUEBA DEMO|JUAN')
    await drain()
    const provider = await identity.estadoWorker()
    await submitIdentity(3, '30111223|PRUEBA DEMO|JUAN')
    advance(6 * 60_000)
    const blocked = await drain()
    const actions = identityStore.state.auditoria.map((event) => event.action)
    console.log(JSON.stringify({ waits, statuses, final: [final.status, final.reviewReason], used, provider: [provider.status, provider.providerState.consecutiveErrors], blocked, circuitAudit: actions.includes('nosis.circuit_opened'), retryAudit: actions.filter((a) => a === 'verification.retry_scheduled').length }))
  `)
  assert.deepEqual(result.waits, [5, 15, 60])
  assert.deepEqual(result.statuses, [
    'retry_pending',
    'retry_pending',
    'retry_pending',
    'review_required',
  ])
  assert.deepEqual(result.final, ['review_required', 'RETRIES_EXHAUSTED'])
  assert.equal(result.used, 4)
  assert.deepEqual(result.provider, ['circuit_open', 5])
  assert.deepEqual(result.blocked, ['read', 'idle'])
  assert.equal(result.circuitAudit, true)
  assert.ok(result.retryAudit >= 4)
})

test('IDENTITY-NOSIS reader outage retries the reading stage; admin decisions need reasons; pause stops the worker', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    readerFailures.vision = 1
    await submitIdentity(1, '30111223|PRUEBA DEMO|JUAN')
    const first = await drain()
    advance(5 * 60_000)
    const second = await drain()
    const v = await latest(1)
    const approveNoReason = await codeOfId(() => identity.decidir(platformAdmin, v.verificationId, { decision: 'approve', reason: '' }))
    const approved = await identity.decidir(platformAdmin, v.verificationId, { decision: 'approve', reason: 'Validado con documentación presencial' })
    const retryVerified = await codeOfId(() => identity.decidir(platformAdmin, v.verificationId, { decision: 'retry' }))
    await submitIdentity(2, '30111223|PRUEBA DEMO|JUAN')
    await drain()
    const v2 = await latest(2)
    const duplicateApprove = await codeOfId(() => identity.decidir(platformAdmin, v2.verificationId, { decision: 'approve', reason: 'ok' }))
    const rejected = await identity.decidir(platformAdmin, v2.verificationId, { decision: 'reject', reason: 'Documento de otra persona' })
    await identity.controlarWorker(platformAdmin, 'pause')
    await submitIdentity(3, '30111222|PRUEBA DEMO|JUAN')
    const paused = await worker.procesarSiguiente()
    await identity.controlarWorker(platformAdmin, 'resume')
    const resumed = await drain()
    const badAction = await codeOfId(() => identity.controlarWorker(platformAdmin, 'delete'))
    const list = await identity.listar({ status: 'verified' })
    console.log(JSON.stringify({ first, second, reviewed: [v.status, v.reviewReason], approveNoReason, approved: [approved.status, approved.verificationMethod, approved.decisionNote], retryVerified, v2: v2.reviewReason, duplicateApprove, rejected: rejected.status, paused: paused.outcome, resumed, badAction, list: list.map((item) => [item.documentNumberMasked, JSON.stringify(item).includes('30111222')]) }))
  `)
  assert.deepEqual(result.first, ['retry_scheduled', 'idle'])
  assert.deepEqual(result.second, ['read', 'checked', 'idle'])
  assert.deepEqual(result.reviewed, ['review_required', 'NOSIS_NOT_FOUND'])
  assert.equal(result.approveNoReason, 'REASON_REQUIRED')
  assert.deepEqual(result.approved, ['verified', 'manual', 'Validado con documentación presencial'])
  assert.equal(result.retryVerified, 'INVALID_STATE')
  assert.equal(result.v2, 'IDENTITY_ALREADY_VERIFIED')
  assert.equal(result.duplicateApprove, 'IDENTITY_ALREADY_VERIFIED')
  assert.equal(result.rejected, 'rejected')
  assert.equal(result.paused, 'paused')
  assert.deepEqual(result.resumed, ['read', 'checked', 'idle'])
  assert.equal(result.badAction, 'INVALID')
  assert.deepEqual(result.list, [
    ['***222', false],
    ['***223', false],
  ])
})
