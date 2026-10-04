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
