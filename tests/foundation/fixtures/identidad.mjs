// IDENTITY-NOSIS in-memory setup: service + worker + demo provider through the same queue,
// rate limit, matching and gates as the real provider. Fictitious people only.
export const IDENTITY_SETUP = `
  const { AlmacenIdentidadEnMemoria, TransaccionIdentidadEnMemoria } = await import('./apps/api/src/tus/identidad/memoria.ts')
  const { ServicioVerificacionIdentidad, MENSAJE_EN_VERIFICACION } = await import('./apps/api/src/tus/identidad/servicio.ts')
  const { WorkerVerificacionIdentidad, marcarSesionRestaurada } = await import('./apps/api/src/tus/identidad/worker.ts')
  const { NosisDemoIdentityProvider } = await import('./apps/api/src/tus/identidad/proveedor.ts')
  const { VERSION_CONSENTIMIENTO_IDENTIDAD } = await import('./apps/api/src/tus/identidad/modelo.ts')
  const { BovedaCredencialesAesGcm } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
  let nowMs = Date.parse('2026-09-24T10:00:00.000Z')
  const identityClock = () => nowMs
  const advance = (ms) => { nowMs += ms }
  const identityStore = new AlmacenIdentidadEnMemoria()
  const identityTx = new TransaccionIdentidadEnMemoria(identityStore)
  const documentsVault = new BovedaCredencialesAesGcm(Buffer.alloc(32, 7).toString('base64'))
  const identity = new ServicioVerificacionIdentidad(identityTx, documentsVault, { providerId: 'demo', maxChecksPerHour: 7 }, identityClock)
  const demo = new NosisDemoIdentityProvider()
  const readerCalls = { ocr: 0, vision: 0 }
  const readerFailures = { ocr: 0, vision: 0 }
  const readerOverrides = { vision: null }
  // Test PNG: a private 'tuSd' chunk carries "dni|apellido|nombre" for the fake readers.
  function png(tag, extraChunks = []) {
    const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1'); return Buffer.concat([head, data, Buffer.alloc(4)]) }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.alloc(13, 1)),
      chunk('tuSd', Buffer.from(tag, 'utf8')),
      ...extraChunks.map(([type, data]) => chunk(type, Buffer.from(data, 'utf8'))),
      chunk('IDAT', Buffer.alloc(9000, 3)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
  function tagOf(images) {
    const bytes = images[0].bytes
    const at = bytes.indexOf(Buffer.from('tuSd', 'latin1'))
    const length = bytes.readUInt32BE(at - 4)
    return bytes.subarray(at + 4, at + 4 + length).toString('utf8').split('|')
  }
  const fakeReader = (kind) => ({
    kind,
    async leer(images) {
      readerCalls[kind] += 1
      if (readerFailures[kind] > 0) { readerFailures[kind] -= 1; return { reader: kind, documentNumber: null, firstName: null, lastName: null, birthDate: null, sex: null, nationality: null, expirationDate: null, confidence: 0, unavailable: true, transient: true } }
      const [dni, lastName, firstName, visionDni] = tagOf(images)
      const documentNumber = kind === 'vision' && (readerOverrides.vision ?? visionDni) ? (readerOverrides.vision ?? visionDni) : dni
      return { reader: kind, documentNumber, firstName, lastName, birthDate: '1983-04-05', sex: 'M', nationality: 'ARG', expirationDate: '2031-01-01', confidence: 0.9 }
    },
  })
  const logs = []
  const makeWorker = (owner, provider = demo) => new WorkerVerificacionIdentidad(identityTx, { provider, ocr: fakeReader('ocr'), vision: fakeReader('vision'), boveda: documentsVault, config: { providerId: 'demo', maxChecksPerHour: 7 }, owner, now: identityClock, log: (event, fields) => logs.push({ event, ...fields }) })
  const worker = makeWorker('worker-a')
  const ctx = (n) => ({ tenantId: 'prestador-' + n, actorId: 'user-' + n, correlationId: 'corr-' + n })
  const platformAdmin = { tenantId: 'platform', actorId: 'admin-1', correlationId: 'corr-admin' }
  const codeOfId = async (operation) => { try { await operation(); return 'none' } catch (error) { return error?.code ?? String(error) } }
  async function submitIdentity(n, tag) {
    const c = ctx(n)
    await identity.aceptarConsentimiento(c, { accepted: true, consentVersion: VERSION_CONSENTIMIENTO_IDENTIDAD })
    await identity.subirDocumento(c, 'front', png(tag))
    await identity.subirDocumento(c, 'back', png(tag))
    return identity.enviar(c)
  }
  async function drain(limit = 50) {
    const outcomes = []
    for (let i = 0; i < limit; i += 1) {
      const result = await worker.procesarSiguiente()
      outcomes.push(result.outcome)
      if (result.outcome === 'idle' || result.outcome === 'paused') break
    }
    return outcomes
  }
  const statusOf = async (n) => (await identity.estado(ctx(n))).status
  const latest = async (n) => identityStore.state.verificaciones.get((await identity.estado(ctx(n))).verificationId)
`
