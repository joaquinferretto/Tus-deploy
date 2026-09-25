// WHATSAPP-AI-01 fixture: real in-memory TUS domain (marketplace, work, finance) behind the
// assistant, fake WhatsApp provider, scripted LLM and the canonical knowledge base. No Meta, no
// Groq, no network.
export const WHATSAPP_SETUP = `
  const { readdirSync, readFileSync } = await import('node:fs')
  const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
  const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
  const { TusMarketplaceService } = await import('./apps/api/src/tus/catalog/index.ts')
  const { AlmacenAsistenteEnMemoria, TransaccionAsistenteEnMemoria } = await import('./apps/api/src/tus/asistente/memoria.ts')
  const { crearModuloWhatsapp } = await import('./apps/api/src/tus/asistente/composicion.ts')
  const { FakeWhatsappProvider, firmarPayloadMeta, parsearWebhookMeta } = await import('./apps/api/src/tus/asistente/meta.ts')
  const { ChatGuionado, llamada } = await import('./apps/api/src/tus/asistente/groq.ts')
  const { IndiceConocimientoEnMemoria, EmbeddingsLocalesHash, indexarConocimiento } = await import('./apps/api/src/tus/asistente/conocimiento.ts')
  let waNow = Date.parse('2026-09-25T12:00:00.000Z')
  const waClock = () => waNow
  const waAdvance = (ms) => { waNow += ms }
  const PHONE_ID = '1234567890'
  const APP_SECRET = 'fictitious-app-secret-for-tests'
  const VERIFY_TOKEN = 'fictitious-verify-token-0001'
  const waEnv = { WHATSAPP_ENABLED: 'true', WHATSAPP_GRAPH_API_VERSION: 'v25.0', WHATSAPP_ACCESS_TOKEN: 'fictitious-access', WHATSAPP_PHONE_NUMBER_ID: PHONE_ID, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN, TUS_WEB_BASE_URL: 'https://web.tus.test', TUS_PLATFORM_ADMIN_TENANT_ID: 'platform-tenant', WHATSAPP_DEBOUNCE_MS: '0' }
  // Real domain services used by the assistant tools.
  const tusCommitments = new InMemoryTusCommitmentStore(); const tusCompensations = new InMemoryTusCompensationStore(); const tusAudits = new AlmacenReferenciasAuditoriaEnMemoria(); const tusIdempotency = new InMemoryTusIdempotencyStore(); const tusOutbox = new InMemoryTusOutboxStore()
  const marketplaceService = new TusMarketplaceService(marketplace)
  const tusApp = new TusApplicationService({ commitments: tusCommitments, compensations: tusCompensations, audits: tusAudits, idempotency: tusIdempotency, outbox: tusOutbox, transaction: new InMemoryTusTransaction({ commitments: tusCommitments, audits: tusAudits, idempotency: tusIdempotency, outbox: tusOutbox, compensations: tusCompensations }), marketplace: marketplaceService, work, serviceFinance: finance })
  const hours = [{ dayOfWeek: 1, start: '09:00', end: '18:00' }]
  await marketplace.merchant.save({ tenantId: provider.tenantId, merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1', status: 'approved', createdAt: '2026-09-23T09:00:00.000Z', updatedAt: '2026-09-23T09:00:00.000Z' })
  await marketplace.listings.save(listing('listing-electricista', { name: 'Electricista a domicilio', description: 'Reparación de enchufes, tableros y cortocircuitos', workingHours: hours, bookingMode: 'requiere_presupuesto', priceMode: 'requires_budget', durationMinutes: null, estimatedDurationMinutes: null }))
  await marketplace.listings.save(listing('listing-aire', { name: 'Service de aire acondicionado', description: 'Carga de gas y reparación de equipos que no enfrían', workingHours: hours }))
  // Accounts (current authority is read on every turn).
  const accounts = new Map([
    ['customer-user', { tenantId: customer.tenantId, status: 'active', roles: ['owner'] }],
    ['provider-user', { tenantId: provider.tenantId, status: 'active', roles: ['owner'] }],
    ['other-user', { tenantId: stranger.tenantId, status: 'active', roles: ['owner'] }],
  ])
  const accountResolver = { contexto: async (accountId, tenantId, correlationId) => {
    const account = accounts.get(accountId)
    if (!account || account.status !== 'active' || account.tenantId !== tenantId) return null
    return { subjectId: accountId, sessionId: 'whatsapp:' + accountId, tenantId, correlationId, roles: account.roles, permissions: ['tus:checkout', 'tus:marketplace:read', 'tus:read', 'tus:marketplace:write'] }
  } }
  // Canonical knowledge base (docs/conocimiento) with the deterministic local embedding.
  const knowledgeFiles = readdirSync('docs/conocimiento').map((name) => ({ path: 'docs/conocimiento/' + name, content: readFileSync('docs/conocimiento/' + name, 'utf8') }))
  const knowledgeIndex = new IndiceConocimientoEnMemoria()
  const embeddings = new EmbeddingsLocalesHash()
  const indexing = await indexarConocimiento({ files: knowledgeFiles, index: knowledgeIndex, embeddings })
  const waStore = new AlmacenAsistenteEnMemoria()
  const waTx = new TransaccionAsistenteEnMemoria(waStore)
  const fakeWa = new FakeWhatsappProvider()
  let script = () => ({ content: 'Hola, soy el asistente de TUS.' })
  const chat = new ChatGuionado((input) => script(input))
  const metrics = []
  const wa = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, application: tusApp, knowledgeIndex, whatsapp: fakeWa, chat, embeddings, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }) })
  const waWorker = wa.crearWorker({ owner: 'wa-worker-a' })
  let wamidSeq = 0
  function inbound(waId, text, extra = {}) {
    wamidSeq += 1
    const message = { from: waId, id: extra.wamid ?? 'wamid.in-' + wamidSeq, timestamp: String(Math.floor(waNow / 1000)), type: extra.type ?? 'text', ...(extra.type && extra.type !== 'text' ? extra.body : { text: { body: text } }) }
    return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5491100000000', phone_number_id: PHONE_ID }, contacts: [{ wa_id: waId, profile: { name: extra.name ?? 'Nombre Perfil' } }], messages: [message] } }] }] }
  }
  function statusPayload(wamid, status, ts) {
    return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: wamid, status, timestamp: String(Math.floor(ts / 1000)), recipient_id: '5491155550001' }] } }] }] }
  }
  async function deliver(payload) { return wa.ingreso.procesar(parsearWebhookMeta(payload, PHONE_ID), 'corr-' + Math.random()) }
  async function say(waId, text, extra) { await deliver(inbound(waId, text, extra)); const results = []; for (let i = 0; i < 5; i += 1) { const r = await waWorker.procesarSiguiente(); if (r.outcome === 'idle') break; results.push(r.outcome) } return results }
  const lastSent = () => fakeWa.sent[fakeWa.sent.length - 1]
  const contactOf = async (waId) => waStore.repositorios().contactos.buscarPorWaId(waId)
  const conversationOf = async (waId) => { const c = await contactOf(waId); return c ? waStore.repositorios().conversaciones.activaDeContacto(c.contactId) : null }
  async function linkContact(waId, accountId) {
    const contact = await contactOf(waId)
    const account = accounts.get(accountId)
    await waTx.ejecutar((r) => r.contactos.actualizar({ ...contact, linkedAccountId: accountId, linkedTenantId: account.tenantId, linkedAt: new Date(waNow).toISOString(), version: contact.version + 1 }, contact.version))
  }
  const toolMessages = (call) => call.messages.filter((m) => m.role === 'tool').map((m) => ({ name: m.name, content: JSON.parse(m.content) }))
`
