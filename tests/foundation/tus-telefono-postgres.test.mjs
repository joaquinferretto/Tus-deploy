import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Phone identity on a DISPOSABLE PostgreSQL 16 with every migration applied (TUS_TELEFONO_PG_URL,
// or TUS_IDENTITY_PG_URL / TUS_DIRECTORIO_PG_URL). Never a shared or production database.
const url = process.env.TUS_TELEFONO_PG_URL ?? process.env.TUS_IDENTITY_PG_URL ?? process.env.TUS_DIRECTORIO_PG_URL

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { AlmacenTelefonosPrisma } = await import('./apps/api/src/auth-security/phone/almacenes.ts')
  const { crearServicioTelefono } = await import('./apps/api/src/auth-security/phone/composicion.ts')
  const run = 't' + Date.now().toString(36)
  const auth = createPrismaAuthService(prisma)
  const { crearPuenteAsistente } = await import('./apps/api/src/tus/asistente/vinculacion.ts')
  const { repositoriosAsistentePrisma } = await import('./apps/api/src/tus/adapters/prisma-asistente.ts')
  const almacen = new AlmacenTelefonosPrisma(prisma, (cliente) => crearPuenteAsistente(repositoriosAsistentePrisma(cliente)))
  const tel = crearServicioTelefono({ auth, telefonos: almacen, env: {}, raw: prisma })
  const PASSWORD = 'una frase larga y segura 2026'
  // Phones unique per run: Corrientes area code + a random 5-digit base + a 2-digit index.
  const base = String(10000 + Math.floor(Math.random() * 90000))
  const phone = (n) => '+549379' + base + String(n).padStart(2, '0')
  async function cuenta(tag) {
    const outcome = await auth.service.registerAccount({ email: run + '-' + tag + '@example.com', password: PASSWORD, displayName: 'Persona ' + tag })
    return outcome.created.account.id
  }
  const code = (e) => e?.code ?? (String(e?.message ?? e).match(/\\b(P2002|23505|23514)\\b/u)?.[1] ?? String(e?.message ?? e).slice(0, 80))
`

test(
  'PHONE PostgreSQL: UNIQUE identity phone between people, E.164 and pair CHECKs, historical NULLs coexist',
  { skip: !url && 'TUS_TELEFONO_PG_URL not set (disposable PostgreSQL 16 only)', timeout: 180000 },
  () => {
    const r = runTypeScriptScenario(`${SETUP}
      try {
        const a = await cuenta('a'); const b = await cuenta('b'); const legacy1 = await cuenta('l1'); const legacy2 = await cuenta('l2')
        const userOf = async (accountId) => (await prisma.account.findUnique({ where: { id: accountId } })).userId
        const p = phone(1)
        await prisma.user.update({ where: { id: await userOf(a) }, data: { phoneNumber: p, phoneVerifiedAt: new Date() } })
        const duplicado = await prisma.user.update({ where: { id: await userOf(b) }, data: { phoneNumber: p, phoneVerifiedAt: new Date() } }).then(() => 'ok', code)
        const formato = await prisma.user.update({ where: { id: await userOf(b) }, data: { phoneNumber: '3794123456', phoneVerifiedAt: new Date() } }).then(() => 'ok', code)
        const sinFecha = await prisma.user.update({ where: { id: await userOf(b) }, data: { phoneNumber: phone(2) } }).then(() => 'ok', code)
        const pendienteMalo = await prisma.user.update({ where: { id: await userOf(b) }, data: { phonePending: 'abc' } }).then(() => 'ok', code)
        // Two historical accounts without phone: NULLs never collide.
        const nulos = (await prisma.user.findMany({ where: { id: { in: [await userOf(legacy1), await userOf(legacy2)] } }, select: { phoneNumber: true } })).map((u) => u.phoneNumber)
        // One person, several roles: the phone belongs to the account (client + provider tenant).
        const multirol = await almacen.estado(a)
        console.log(JSON.stringify({ duplicado, formato, sinFecha, pendienteMalo, nulos, multirol: multirol.phoneNumber === p }))
      } finally { await prisma.$disconnect() }
    `)
    assert.equal(r.duplicado, 'P2002')
    assert.match(r.formato, /23514|ck_user_phone_e164|check/iu)
    assert.match(r.sinFecha, /23514|ck_user_phone_verified_pair|check/iu)
    assert.match(r.pendienteMalo, /23514|ck_user_phone_pending_e164|check/iu)
    assert.deepEqual(r.nulos, [null, null])
    assert.equal(r.multirol, true)
  }
)

test(
  'PHONE PostgreSQL: two concurrent deliveries of one code -> exactly one verification; a taken phone rolls back and invalidates; one live challenge per purpose',
  { skip: !url && 'TUS_TELEFONO_PG_URL not set (disposable PostgreSQL 16 only)', timeout: 180000 },
  () => {
    const r = runTypeScriptScenario(`${SETUP}
      try {
        const a = await cuenta('conc')
        const p = phone(3)
        const d = await tel.iniciarRegistro(a, p)
        const waId = p.slice(1)
        const carrera = await Promise.all([
          tel.verificarDesdeWhatsapp({ waId, texto: d.message, wamid: run + '-w1' }),
          tel.verificarDesdeWhatsapp({ waId, texto: d.message, wamid: run + '-w2' }),
          tel.verificarDesdeWhatsapp({ waId, texto: d.message, wamid: run + '-w3' }),
        ])
        const ganadores = carrera.filter((x) => x.resultado === 'vinculado').length
        const fila = await prisma.desafioTelefono.findUnique({ where: { id: d.challengeId } })
        // Same wamid again (Meta retry): "repetido", no side effect.
        const ganador = fila.wamidVerificacion
        const repetido = await tel.verificarDesdeWhatsapp({ waId, texto: d.message, wamid: ganador })
        // Another account tries the same phone: the whole transaction rolls back (challenge unused
        // by the identity), then the challenge is invalidated with reason 'conflicto'.
        const b = await cuenta('conflict')
        const db = await tel.iniciar(b, { telefono: p })
        const conflicto = await tel.verificarDesdeWhatsapp({ waId, texto: db.message, wamid: run + '-w4' })
        const filaB = await prisma.desafioTelefono.findUnique({ where: { id: db.challengeId } })
        const estadoB = await almacen.estado(b)
        // A second challenge for the same purpose replaces the first (partial unique index).
        const x1 = await tel.iniciar(b, { telefono: phone(4) })
        const x2 = await tel.iniciar(b, { telefono: phone(4) })
        const vivos = await prisma.desafioTelefono.count({ where: { cuentaId: b, usadoEn: null, invalidadoEn: null } })
        const guardado = JSON.stringify(await prisma.desafioTelefono.findMany({ where: { cuentaId: { in: [a, b] } } }))
        console.log(JSON.stringify({
          ganadores, identidad: (await almacen.estado(a)).phoneNumber === p, usado: fila.usadoEn !== null,
          repetido: repetido.resultado,
          conflicto: [conflicto.resultado, filaB.motivoInvalidacion, filaB.usadoEn, estadoB.phoneNumber],
          vivos, reemplazo: (await prisma.desafioTelefono.findUnique({ where: { id: x1.challengeId } })).motivoInvalidacion,
          codigoEnDb: [d.code, db.code, x1.code, x2.code].some((c) => guardado.includes(c)),
        }))
      } finally { await prisma.$disconnect() }
    `)
    assert.equal(r.ganadores, 1)
    assert.equal(r.identidad, true)
    assert.equal(r.usado, true)
    assert.equal(r.repetido, 'repetido')
    assert.deepEqual(r.conflicto, ['invalido', 'conflicto', null, null])
    assert.equal(r.vivos, 1)
    assert.equal(r.reemplazo, 'reemplazado')
    assert.equal(r.codigoEnDb, false, 'only hashes are stored')
  }
)

test(
  'PHONE PostgreSQL: VERIFICAR TUS links wa_id -> account in the challenge transaction; a wa_id of another account rolls everything back; a race has one winner',
  { skip: !url && 'TUS_TELEFONO_PG_URL not set (disposable PostgreSQL 16 only)', timeout: 180000 },
  () => {
    const r = runTypeScriptScenario(`${SETUP}
      try {
        const userOf = async (accountId) => (await prisma.account.findUnique({ where: { id: accountId } })).userId
        const contacto = (waId) => prisma.contactoWhatsapp.findUnique({ where: { waId } })
        // 1. Verified phone, WhatsApp not linked -> challenge -> message -> linked row (the field the assistant reads).
        const a = await cuenta('link-a'); const pa = phone(10); const waA = pa.slice(1)
        await prisma.user.update({ where: { id: await userOf(a) }, data: { phoneNumber: pa, phoneVerifiedAt: new Date() } })
        const antes = (await tel.estadoCuenta(a)).whatsappLinked
        const da = await tel.iniciarVinculo(a)
        const ok = await tel.verificarDesdeWhatsapp({ waId: waA, texto: da.message, wamid: run + '-l1' })
        const filaA = await contacto(waA)
        const accountA = await prisma.account.findUnique({ where: { id: a } })
        const despues = (await tel.estadoCuenta(a)).whatsappLinked
        const auditoria = await prisma.auditoriaAsistente.count({ where: { accion: 'whatsapp.linked', actorId: a } })
        // 2. A wa_id linked to ANOTHER account: no reassignment; phone, challenge use and link all roll back.
        const owner = await cuenta('owner'); const waO = phone(11).slice(1)
        await prisma.contactoWhatsapp.create({ data: { id: 'c-' + run, canal: 'whatsapp', waId: waO, cuentaVinculadaId: owner, tenantVinculadoId: 't-' + run, vinculadoEn: new Date(), version: 1, fechaCreacion: new Date() } })
        const b = await cuenta('intruder'); const db = await tel.iniciarRegistro(b, '+' + waO)
        const bloqueado = await tel.verificarDesdeWhatsapp({ waId: waO, texto: db.message, wamid: run + '-l2' })
        const filaO = await contacto(waO); const filaDb = await prisma.desafioTelefono.findUnique({ where: { id: db.challengeId } })
        // 3. Two accounts, one number, simultaneous: one winner.
        const x = await cuenta('race-x'); const y = await cuenta('race-y'); const pr = phone(12); const waR = pr.slice(1)
        await prisma.contactoWhatsapp.create({ data: { id: 'r-' + run, canal: 'whatsapp', waId: waR, version: 1, fechaCreacion: new Date() } })
        const dx = await tel.iniciarRegistro(x, pr); const dy = await tel.iniciarRegistro(y, pr)
        const carrera = await Promise.all([
          tel.verificarDesdeWhatsapp({ waId: waR, texto: dx.message, wamid: run + '-l3' }).then((v) => v.resultado, (e) => 'error:' + code(e)),
          tel.verificarDesdeWhatsapp({ waId: waR, texto: dy.message, wamid: run + '-l4' }).then((v) => v.resultado, (e) => 'error:' + code(e)),
        ])
        const filaR = await contacto(waR)
        const duenos = [(await almacen.estado(x)).phoneNumber, (await almacen.estado(y)).phoneNumber].filter((v) => v === pr).length
        // 4. A new process (a new store instance) still sees the link.
        const otro = new AlmacenTelefonosPrisma(prisma, (cliente) => crearPuenteAsistente(repositoriosAsistentePrisma(cliente)))
        console.log(JSON.stringify({
          antes, ok: ok.resultado, vinculoA: filaA?.cuentaVinculadaId === a, tenantA: filaA?.tenantVinculadoId === accountA.tenantId, despues, auditoria,
          bloqueado: [bloqueado.resultado, filaO.cuentaVinculadaId === owner, (await almacen.estado(b)).phoneNumber, filaDb.usadoEn, filaDb.motivoInvalidacion],
          carrera: [[...carrera].sort(), [x, y].includes(filaR?.cuentaVinculadaId), duenos],
          reinicio: (await otro.waIdVinculado(a)) === waA,
        }))
      } finally { await prisma.$disconnect() }
    `)
    assert.equal(r.antes, false)
    assert.equal(r.ok, 'vinculado')
    assert.equal(r.vinculoA, true)
    assert.equal(r.tenantA, true)
    assert.equal(r.despues, true)
    assert.equal(r.auditoria, 1)
    assert.deepEqual(r.bloqueado, ['vinculo_ocupado', true, null, null, 'conflicto'])
    assert.deepEqual(r.carrera[0], ['invalido', 'vinculado'])
    assert.equal(r.carrera[1], true)
    assert.equal(r.carrera[2], 1)
    assert.equal(r.reinicio, true)
  }
)

test(
  'PHONE PostgreSQL admin verification: marking the pending phone as verified and removing that verification are transactional — the unique phone holds, the challenges and the WhatsApp link of THAT number go with the verification, another account is untouched, two administrators at once leave one coherent state',
  { skip: !url && 'TUS_TELEFONO_PG_URL not set (disposable PostgreSQL 16 only)', timeout: 180000 },
  () => {
    const r = runTypeScriptScenario(`${SETUP}
      try {
        const contacto = (waId) => prisma.contactoWhatsapp.findUnique({ where: { waId } })
        const estado = async (id) => { const e = await almacen.estado(id); return [e.phoneNumber, e.phonePending, e.phoneVerifiedAt !== null] }
        const out = {}
        // Verify the pending number: the canonical columns, no WhatsApp link.
        const a = await cuenta('adm-a'); const pa = phone(20); const waA = pa.slice(1)
        await tel.fijarPendientePorAdmin('admin-pg', a, pa)
        const verificada = await tel.verificarPorAdmin('admin-pg', a)
        out.verificar = [verificada.ok, verificada.cambio, verificada.telefono.verificado, verificada.telefono.whatsappVinculado, await estado(a)]
        out.repetir = await tel.verificarPorAdmin('admin-pg', a).then((x) => [x.ok, x.cambio])
        // The same number pending on another account: the UNIQUE index decides.
        const b = await cuenta('adm-b')
        await almacen.fijarPendiente(b, pa)
        out.cargaRechazada = await tel.fijarPendientePorAdmin('admin-pg', b, pa).then((x) => x.code)
        out.conflicto = [await tel.verificarPorAdmin('admin-pg', b).then((x) => x.code), await estado(b)]
        out.sinTelefono = await tel.verificarPorAdmin('admin-pg', await cuenta('adm-vacia')).then((x) => x.code)
        // The person links the WhatsApp and starts changing the number; another account has its own link.
        const da = await tel.iniciarVinculo(a)
        await tel.verificarDesdeWhatsapp({ waId: waA, texto: da.message, wamid: run + '-adm1' })
        const o = await cuenta('adm-o'); const po = phone(21); const waO = po.slice(1)
        await tel.fijarPendientePorAdmin('admin-pg', o, po); await tel.verificarPorAdmin('admin-pg', o)
        const dOtra = await tel.iniciarVinculo(o)
        await tel.verificarDesdeWhatsapp({ waId: waO, texto: dOtra.message, wamid: run + '-adm2' })
        const cambio = await tel.iniciar(a, { telefono: phone(22) })
        out.antes = [(await contacto(waA)).cuentaVinculadaId === a, (await contacto(waO)).cuentaVinculadaId === o, (await prisma.desafioTelefono.findUnique({ where: { id: cambio.challengeId } })).invalidadoEn]
        // Two administrators remove the verification at once.
        const carrera = await Promise.all([tel.quitarVerificacionPorAdmin('admin-pg', a), tel.quitarVerificacionPorAdmin('admin-pg-2', a)].map((p) => p.then((x) => x.ok, (e) => 'error:' + code(e))))
        out.carrera = carrera
        const filaDesafio = await prisma.desafioTelefono.findUnique({ where: { id: cambio.challengeId } })
        const filaA = await contacto(waA)
        out.despues = [await estado(a), filaDesafio.invalidadoEn !== null, filaDesafio.motivoInvalidacion, filaA.cuentaVinculadaId, filaA.tenantVinculadoId, filaA.vinculadoEn, Boolean(filaA.id)]
        out.otra = [await estado(o), (await contacto(waO)).cuentaVinculadaId === o]
        out.auditoriaAsistente = await prisma.auditoriaAsistente.count({ where: { accion: 'whatsapp.unlinked', contactoId: filaA.id } })
        out.propio = await tel.estadoCuenta(a).then((x) => [x.verified, x.whatsappLinked])
        out.repetirQuitar = await tel.quitarVerificacionPorAdmin('admin-pg', a).then((x) => [x.ok, x.cambio])
        out.codigoViejo = (await tel.verificarDesdeWhatsapp({ waId: phone(22).slice(1), texto: cambio.message, wamid: run + '-adm3' })).resultado
        out.pa = pa; out.p22 = phone(22); out.po = po
        console.log(JSON.stringify(out))
      } finally { await prisma.$disconnect() }
    `)
    assert.deepEqual(r.verificar, [true, true, true, false, [r.pa, null, true]], 'the pending number is the verified identity phone; WhatsApp is not linked by it')
    assert.deepEqual(r.repetir, [true, false], 'idempotent')
    assert.deepEqual(r.conflicto, ['PHONE_IN_USE', [null, r.pa, false]], 'the unique phone holds: the other account stays pending')
    assert.equal(r.cargaRechazada, 'PHONE_IN_USE', 'a number that is already the verified phone of another account is not loaded as pending')
    assert.equal(r.sinTelefono, 'NO_PHONE')
    assert.deepEqual(r.antes, [true, true, null])
    assert.ok(r.carrera.every((valor) => valor === true), `both administrators get an answer, none an error: ${JSON.stringify(r.carrera)}`)
    assert.deepEqual(r.despues, [[null, r.p22, false], true, 'reemplazado', null, null, null, true], 'not verified, the challenge cancelled, the contact unlinked (and still there)')
    assert.deepEqual(r.otra, [[r.po, null, true], true], 'the other account keeps its phone and its WhatsApp')
    assert.ok(r.auditoriaAsistente >= 1, 'the unlink is audited')
    assert.deepEqual(r.propio, [false, false])
    assert.deepEqual(r.repetirQuitar, [true, false])
    assert.notEqual(r.codigoViejo, 'vinculado', 'the cancelled code verifies nothing')
  }
)

test(
  'PHONE PostgreSQL admin contact: the administration assigns, verifies and links the WhatsApp of an account without the owner of the number writing — the SAME contact and field a verification by message writes; conflicts change nothing; replacing, unlinking and removing leave one coherent state; the turno notice resolves the linked contact',
  { skip: !url && 'TUS_TELEFONO_PG_URL not set (disposable PostgreSQL 16 only)', timeout: 180000 },
  () => {
    const r = runTypeScriptScenario(`${SETUP}
      try {
        const { TransaccionAsistentePrisma } = await import('./apps/api/src/tus/adapters/prisma-asistente.ts')
        const { NotificadorTurnosWhatsapp } = await import('./apps/api/src/tus/asistente/avisos-turnos.ts')
        const { FakeWhatsappProvider } = await import('./apps/api/src/tus/asistente/meta.ts')
        const contacto = (waId) => prisma.contactoWhatsapp.findUnique({ where: { waId } })
        const estado = async (id) => { const e = await almacen.estado(id); return [e.phoneNumber, e.phonePending, e.phoneVerifiedAt !== null] }
        const vista = (x) => x.ok ? [x.cambio, x.telefono.verificado, x.telefono.pendiente !== null, x.telefono.whatsappVinculado] : x.code
        const eventos = async (cuentaId) => (await prisma.$queryRawUnsafe('SELECT "kind", "metadata"::text AS m, "actorId" FROM public."SecurityEvent" WHERE "metadata"::text LIKE $1 ORDER BY "occurredAt", "id"', '%' + cuentaId + '%').catch(() => []))
        const out = {}
        const ADMIN = 'admin-contacto'
        const tenantDe = async (id) => (await prisma.account.findUnique({ where: { id } })).tenantId

        // ---- 1-5. Pending, verify, save + verify, link, the three at once.
        const a = await cuenta('cw-a'); const pa = phone(40); const waA = pa.slice(1)
        out.pendiente = [(await tel.fijarPendientePorAdmin(ADMIN, a, pa)).ok, await estado(a)]
        out.verificar = vista(await tel.verificarPorAdmin(ADMIN, a))
        out.sinContactoTodavia = (await contacto(waA)) === null
        const vinculada = await tel.vincularWhatsappPorAdmin(ADMIN, a)
        const filaA = await contacto(waA)
        out.vincular = [vista(vinculada), filaA?.cuentaVinculadaId === a, filaA?.tenantVinculadoId === await tenantDe(a), filaA?.vinculadoEn !== null, (await almacen.waIdVinculado(a)) === waA]
        // 6. Again: nothing changes, one contact.
        out.repetir = [vista(await tel.vincularWhatsappPorAdmin(ADMIN, a)), await prisma.contactoWhatsapp.count({ where: { cuentaVinculadaId: a } })]
        const b = await cuenta('cw-b'); const pb = phone(41); const waB = pb.slice(1)
        out.guardarVerificar = [vista(await tel.asignarPorAdmin(ADMIN, b, { telefono: pb, vincular: false })), await estado(b), (await contacto(waB)) === null]
        const c = await cuenta('cw-c'); const pc = phone(42); const waC = pc.slice(1)
        out.todoJunto = [vista(await tel.asignarPorAdmin(ADMIN, c, { telefono: ' 0379 15 ' + pc.slice(-7, -4) + '-' + pc.slice(-4), vincular: true })), await estado(c), (await contacto(waC))?.cuentaVinculadaId === c]
        // Pending -> verify and link in one step.
        const d = await cuenta('cw-d'); const pd = phone(43)
        await tel.fijarPendientePorAdmin(ADMIN, d, pd)
        out.verificarVincular = [vista(await tel.asignarPorAdmin(ADMIN, d, { vincular: true })), await estado(d), (await contacto(pd.slice(1)))?.cuentaVinculadaId === d]

        // ---- 7-8. Conflicts: the number or the WhatsApp of ANOTHER account. Nothing changes.
        const e = await cuenta('cw-e')
        out.telefonoAjeno = [(await tel.asignarPorAdmin(ADMIN, e, { telefono: pa, vincular: true })).code, await estado(e)]
        // A WhatsApp already linked to another account (the person linked it by token), whose number is nobody's verified phone.
        const pf = phone(44); const waF = pf.slice(1)
        await prisma.contactoWhatsapp.create({ data: { id: run + '-contacto-f', waId: waF, cuentaVinculadaId: a, tenantVinculadoId: await tenantDe(a), vinculadoEn: new Date(), version: 1, fechaCreacion: new Date() } })
        const conflictoWa = await tel.asignarPorAdmin(ADMIN, e, { telefono: pf, vincular: true })
        out.whatsappAjeno = [conflictoWa.code, await estado(e), (await contacto(waF)).cuentaVinculadaId === a, JSON.stringify(conflictoWa).includes(a)]
        await prisma.contactoWhatsapp.delete({ where: { waId: waF } })
        out.invalido = [(await tel.asignarPorAdmin(ADMIN, e, { telefono: '12ab', vincular: true })).code, (await tel.asignarPorAdmin(ADMIN, e, { vincular: true })).code, (await tel.vincularWhatsappPorAdmin(ADMIN, e)).code, (await tel.asignarPorAdmin(ADMIN, 'no-existe', { telefono: phone(45), vincular: true })).code]

        // ---- 20. The turno notice resolves the provider's WhatsApp linked by the administration.
        const tx = new TransaccionAsistentePrisma(prisma)
        const wa = new FakeWhatsappProvider()
        const avisos = new NotificadorTurnosWhatsapp(tx, wa)
        const aviso = (cuentaId, reservaId) => avisos.solicitudRecibida({ reservaId, prestadorTenantId: 't', prestadorCuentaId: cuentaId, clienteNombre: 'Cliente B', servicio: 'Electricidad', inicio: new Date(Date.now() + 86400000), duracionMinutos: 60, expiraEn: new Date(Date.now() + 3600000) })
        const vinculados = await tx.ejecutar((repos) => repos.contactos.vinculadosA(a))
        out.resuelve = [vinculados.length, vinculados[0]?.waId === waA]
        // Meta only allows free text inside the 24 h after the person's last message: a number that
        // never wrote has no open window, so nothing is sent yet (a template is needed for that).
        await aviso(a, run + '-res-1')
        out.sinVentana = wa.sent.length
        // The person writes once (any message): the same notice now goes to that very number.
        const ahora = new Date()
        await prisma.conversacionWhatsapp.create({ data: { id: run + '-conv-a', contactoId: filaA.id, estado: 'active', modo: 'bot', abiertaEn: ahora, ultimoMensajeEn: ahora, ultimoEntranteEn: ahora, noLeidos: 0, mensajesResumidos: 0, estadoConversacional: {}, version: 1 } })
        await aviso(a, run + '-res-2')
        out.conVentana = [wa.sent.length, wa.sent[0]?.to === waA, wa.sent[0]?.message?.type === 'buttons' && (wa.sent[0]?.message?.text ?? '').includes('Nueva solicitud de turno') && (wa.sent[0]?.message?.text ?? '').includes('Cliente: Cliente B')]

        // ---- 9. Unlink: only the relation goes.
        const desvinculada = await tel.desvincularWhatsappPorAdmin(ADMIN, a)
        out.desvincular = [vista(desvinculada), (await contacto(waA)).cuentaVinculadaId, await estado(a), await prisma.conversacionWhatsapp.count({ where: { id: run + '-conv-a' } }), vista(await tel.desvincularWhatsappPorAdmin(ADMIN, a))]
        await aviso(a, run + '-res-3')
        out.yaNoRecibe = wa.sent.length
        await tel.vincularWhatsappPorAdmin(ADMIN, a)

        // ---- 11-14. Replace a verified + linked number: the old one stops resolving, the new one does.
        const pa2 = phone(46); const waA2 = pa2.slice(1)
        out.reemplazo = [vista(await tel.asignarPorAdmin(ADMIN, a, { telefono: pa2, vincular: true })), await estado(a), (await contacto(waA)).cuentaVinculadaId, (await contacto(waA2)).cuentaVinculadaId === a, (await tx.ejecutar((repos) => repos.contactos.vinculadosA(a))).map((x) => x.waId === waA2), (await almacen.cuentaPorTelefono(pa))]
        // Replaced only as pending: the verified + linked one keeps working until the new one is verified.
        const pa3 = phone(47)
        out.reemplazoPendiente = [(await tel.fijarPendientePorAdmin(ADMIN, a, pa3)).ok, await estado(a), (await almacen.waIdVinculado(a)) === waA2]
        // 15. Removing the verification invalidates the link (a link needs a verified phone).
        out.desverificar = [vista(await tel.quitarVerificacionPorAdmin(ADMIN, a)), (await contacto(waA2)).cuentaVinculadaId, await estado(a)]

        // ---- 10. Remove the number altogether; the account and its history stay.
        await tel.asignarPorAdmin(ADMIN, c, { telefono: pc, vincular: true })
        const desafio = await tel.iniciar(c, { telefono: phone(48) })
        const antes = [await prisma.account.count({ where: { id: c } }), await prisma.contactoWhatsapp.count({ where: { waId: waC } })]
        const quitada = await tel.quitarNumeroPorAdmin(ADMIN, c)
        out.quitar = [vista(quitada), await estado(c), (await contacto(waC)).cuentaVinculadaId, antes, [await prisma.account.count({ where: { id: c } }), await prisma.contactoWhatsapp.count({ where: { waId: waC } })], desafio.ok ? (await almacen.desafio(desafio.challengeId))?.invalidatedAt !== null : 'sin-desafio', vista(await tel.quitarNumeroPorAdmin(ADMIN, c))]
        // The freed number can be given to another account.
        out.liberado = vista(await tel.asignarPorAdmin(ADMIN, e, { telefono: pc, vincular: true }))
        out.liberadoContacto = (await contacto(waC)).cuentaVinculadaId === e

        // ---- Two administrators giving the same number to two accounts at once: one wins.
        const x = await cuenta('cw-x'); const y = await cuenta('cw-y'); const pr = phone(49)
        const carrera = await Promise.all([tel.asignarPorAdmin(ADMIN, x, { telefono: pr, vincular: true }), tel.asignarPorAdmin(ADMIN, y, { telefono: pr, vincular: true })].map((p) => p.then((z) => z.ok ? 'ok' : z.code, (err) => 'error:' + code(err))))
        const duenos = [(await almacen.estado(x)).phoneNumber, (await almacen.estado(y)).phoneNumber].filter(Boolean).length
        const filaR = await contacto(pr.slice(1))
        out.carrera = [[...carrera].sort(), duenos, [x, y].includes(filaR?.cuentaVinculadaId), await prisma.contactoWhatsapp.count({ where: { waId: pr.slice(1) } })]

        // ---- 18. Audit: the administrator, the target account, masked numbers.
        const auditoria = await prisma.auditoriaAsistente.findMany({ where: { actorId: ADMIN, accion: { in: ['whatsapp.linked', 'whatsapp.unlinked'] } } })
        out.auditoriaAsistente = [auditoria.some((ev) => ev.accion === 'whatsapp.linked' && ev.metadata.origin === 'admin'), auditoria.some((ev) => ev.accion === 'whatsapp.unlinked'), JSON.stringify(auditoria).includes(waA), JSON.stringify(auditoria).includes(waA2)]
        console.log(JSON.stringify(out))
      } finally { await prisma.$disconnect() }
    `)
    assert.deepEqual(r.pendiente[0], true)
    assert.deepEqual(r.verificar, [true, true, false, false], 'verifying is not linking')
    assert.equal(r.sinContactoTodavia, true, 'no WhatsApp contact exists before the administration links it')
    assert.deepEqual(r.vincular, [[true, true, false, true], true, true, true, true], 'the link is the contact of the assistant, with its account, tenant and date: the same field a verification by message writes')
    assert.deepEqual(r.repetir, [[false, true, false, true], 1], 'linking again changes nothing')
    assert.deepEqual([r.guardarVerificar[0], r.guardarVerificar[1].slice(1), r.guardarVerificar[2]], [[true, true, false, false], [null, true], true], 'save + verify: verified, nothing pending, WhatsApp not linked')
    assert.deepEqual([r.todoJunto[0], r.todoJunto[1].slice(1), r.todoJunto[2]], [[true, true, false, true], [null, true], true], 'save + verify + link, from a number typed the local way')
    assert.deepEqual([r.verificarVincular[0], r.verificarVincular[1].slice(1), r.verificarVincular[2]], [[true, true, false, true], [null, true], true])
    assert.deepEqual(r.telefonoAjeno, ['PHONE_IN_USE', [null, null, false]], 'the verified phone of another account: refused, nothing changes')
    assert.deepEqual(r.whatsappAjeno, ['WHATSAPP_IN_USE', [null, null, false], true, false], 'a WhatsApp of another account: refused, the whole operation is undone, nothing about that account is told')
    assert.deepEqual(r.invalido, ['INVALID_PHONE', 'NO_PHONE', 'PHONE_NOT_VERIFIED', 'NOT_FOUND'])
    assert.deepEqual(r.resuelve, [1, true], 'the notices read the contact linked by the administration')
    assert.equal(r.sinVentana, 0, 'outside Meta\'s 24 h window (the number never wrote) no free text is sent')
    assert.deepEqual(r.conVentana, [1, true, true], 'inside the window the notice goes to that very number')
    assert.deepEqual([r.desvincular[0], r.desvincular[1], r.desvincular[2].slice(1), r.desvincular[3], r.desvincular[4]], [[true, true, false, false], null, [null, true], 1, [false, true, false, false]], 'unlinking keeps the phone verified and the conversation; repeating it changes nothing')
    assert.equal(r.yaNoRecibe, 1, 'an unlinked WhatsApp receives nothing more')
    assert.deepEqual([r.reemplazo[0], r.reemplazo[1].slice(1), r.reemplazo[2], r.reemplazo[3], r.reemplazo[4], r.reemplazo[5]], [[true, true, false, true], [null, true], null, true, [true], null], 'replaced: the old number resolves to nobody, the new one to the account, and only one is operative')
    assert.deepEqual([r.reemplazoPendiente[0], r.reemplazoPendiente[1][2], r.reemplazoPendiente[2]], [true, true, true], 'a replacement that is only pending leaves the verified, linked number working')
    assert.deepEqual([r.desverificar[0], r.desverificar[1], r.desverificar[2][0]], [[true, false, true, false], null, null], 'removing the verification unlinks the WhatsApp of that number')
    assert.deepEqual([r.quitar[0], r.quitar[1], r.quitar[2], r.quitar[3], r.quitar[4], r.quitar[5], r.quitar[6]], [[true, false, false, false], [null, null, false], null, [1, 1], [1, 1], true, [false, false, false, false]], 'the number is gone, its WhatsApp unlinked, the pending challenge cancelled; the account and the contact row remain')
    assert.deepEqual([r.liberado, r.liberadoContacto], [[true, true, false, true], true], 'a removed number is free for another account')
    assert.deepEqual(r.carrera, [['PHONE_IN_USE', 'ok'], 1, true, 1], 'two accounts racing for one number: one gets the phone and the WhatsApp, the other nothing')
    assert.deepEqual(r.auditoriaAsistente, [true, true, false, false], 'the link and the unlink are audited with the administrator and a masked number')
  }
)
