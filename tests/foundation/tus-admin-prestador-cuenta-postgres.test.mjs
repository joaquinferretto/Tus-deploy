import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// PRESTADOR-CUENTA-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. The account behind a provider
// profile is resolved by ids (profile -> tenant -> account -> user), and the states Admin reads
// (phone verified, WhatsApp linked, can be written now) come from what is persisted, never from a
// name nor from the mere presence of a phone.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('ADMIN prestador-cuenta PostgreSQL: each provider shows its real account by ids; phone verified, WhatsApp linked and "can receive requests now" are separate facts with their own evidence; an orphan profile and a tenant with two accounts are reported', { skip, timeout: 240_000 }, () => {
  const r = runTypeScriptScenario(`
    const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
    const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
    const { crearLectorCuentasPrestador } = await import('./apps/api/src/tus/admin/cuenta-prestador.ts')
    const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
    const run = 'pc' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
    const out = {}
    try {
      const ahora = new Date()
      const tenant = async (tag) => { const id = run + '-t-' + tag; await prisma.tusTenant.create({ data: { id, slug: id, name: tag, status: 'active', createdAt: ahora, updatedAt: ahora } }); return id }
      let n = 0
      const cuenta = async (tenantId, tag, datos = {}, creada = ahora, estado = 'active') => {
        n += 1
        const userId = run + '-u-' + tag
        await prisma.user.create({ data: { id: userId, email: tag + '-' + run + '@t.invalid', normalizedEmail: tag + '-' + run + '@t.invalid', displayName: datos.displayName ?? 'Persona ' + tag, ...(datos.user ?? {}) } })
        await prisma.account.create({ data: { id: run + '-a-' + tag, userId, tenantId, status: estado, emailVerifiedAt: ahora, createdAt: creada, updatedAt: ahora } })
        return run + '-a-' + tag
      }
      const telefono = (i) => '+54937940' + String(Date.now()).slice(-4) + String(i)
      const contacto = async (cuentaId, tenantId, tag, entranteHace) => {
        const id = run + '-c-' + tag
        await prisma.contactoWhatsapp.create({ data: { id, canal: 'whatsapp', waId: '549379' + String(Date.now()).slice(-6) + String(++n), cuentaVinculadaId: cuentaId, tenantVinculadoId: tenantId, vinculadoEn: ahora, fechaCreacion: ahora } })
        if (entranteHace !== null) await prisma.conversacionWhatsapp.create({ data: { id: run + '-conv-' + tag, contactoId: id, canal: 'whatsapp', estado: 'active', modo: 'bot', abiertaEn: ahora, ultimoMensajeEn: ahora, ultimoEntranteEn: new Date(Date.now() - entranteHace), estadoConversacional: {} } })
      }
      // listo: a real person, verified phone, WhatsApp linked, wrote an hour ago; public name differs
      const tListo = await tenant('listo')
      const aListo = await cuenta(tListo, 'listo', { displayName: 'gaby', user: { firstName: 'Gabriela', lastName: 'López', documentType: 'DNI', documentNumber: '30111' + String(Date.now()).slice(-3), phoneNumber: telefono(1), phoneVerifiedAt: ahora } })
      await contacto(aListo, tListo, 'listo', 3600_000)
      // verified phone, NO WhatsApp linked
      const tTel = await tenant('tel')
      await cuenta(tTel, 'tel', { user: { phoneNumber: telefono(2), phoneVerifiedAt: ahora } })
      // linked, last message two days ago
      const tLejos = await tenant('lejos')
      const aLejos = await cuenta(tLejos, 'lejos', { user: { phoneNumber: telefono(3), phoneVerifiedAt: ahora } })
      await contacto(aLejos, tLejos, 'lejos', 48 * 3600_000)
      // linked by the administration, the number never wrote
      const tNunca = await tenant('nunca')
      const aNunca = await cuenta(tNunca, 'nunca', { user: { phoneNumber: telefono(4), phoneVerifiedAt: ahora } })
      await contacto(aNunca, tNunca, 'nunca', null)
      // only a pending phone
      const tPend = await tenant('pend')
      await cuenta(tPend, 'pend', { user: { phonePending: telefono(5) } })
      // two active accounts in one tenant: the oldest is the one used
      const tDos = await tenant('dos')
      const vieja = await cuenta(tDos, 'dos-vieja', {}, new Date(Date.now() - 86_400_000))
      await cuenta(tDos, 'dos-nueva', {})
      // a suspended account only, and an orphan tenant without any account
      const tSusp = await tenant('susp')
      await cuenta(tSusp, 'susp', {}, ahora, 'suspended')
      const tHuerfano = await tenant('huerfano')
      // someone else with the SAME name as the provider of tListo: never matched by name
      const tOtro = await tenant('homonimo')
      await cuenta(tOtro, 'homonimo', { displayName: 'gaby', user: { firstName: 'Gabriela', lastName: 'López' } })

      const todos = [tListo, tTel, tLejos, tNunca, tPend, tDos, tSusp, tHuerfano]
      const sinPlantilla = await crearLectorCuentasPrestador(prisma, { plantillaAprobada: () => false })(todos)
      const conPlantilla = await crearLectorCuentasPrestador(prisma, { plantillaAprobada: () => true })(todos)
      const ver = (mapa, t) => { const c = mapa.get(t); return c ? { nombre: c.nombre, estado: c.estado, tel: c.telefono.verificado, pend: Boolean(c.telefono.pendiente), wa: c.whatsapp.vinculado, ventana: c.whatsapp.ventanaAbierta, destino: c.whatsapp.destino, activas: c.cuentasActivas } : null }
      out.listo = ver(sinPlantilla, tListo)
      out.listoDatos = [sinPlantilla.get(tListo).cuentaId === aListo, sinPlantilla.get(tListo).documento.tipo, /\\*|•|\\.\\.\\./u.test(sinPlantilla.get(tListo).telefono.numero) || sinPlantilla.get(tListo).telefono.numero.length < 14]
      out.soloTelefono = ver(sinPlantilla, tTel)
      out.lejos = [ver(sinPlantilla, tLejos).destino, ver(conPlantilla, tLejos).destino]
      out.nunca = [ver(sinPlantilla, tNunca).destino, ver(conPlantilla, tNunca).destino, ver(sinPlantilla, tNunca).wa]
      out.pendiente = ver(sinPlantilla, tPend)
      out.dos = [sinPlantilla.get(tDos).cuentaId === vieja, sinPlantilla.get(tDos).cuentasActivas]
      out.suspendida = ver(sinPlantilla, tSusp)
      out.huerfano = sinPlantilla.has(tHuerfano)
      // the backend notifies the same account Admin shows (one rule, by ids)
      const turnos = new ServicioTurnos(prisma)
      out.mismaRegla = [await turnos['cuentaPrestadorId'](tListo) === aListo, await turnos['cuentaPrestadorId'](tDos) === vieja, await turnos['cuentaPrestadorId'](tSusp), await turnos['cuentaPrestadorId'](tHuerfano)]
      out.vacio = (await crearLectorCuentasPrestador(prisma, { plantillaAprobada: () => false })([])).size
      console.log(JSON.stringify(out))
    } finally { await prisma.$disconnect() }
  `)
  assert.deepEqual(r.listo, { nombre: 'Gabriela López', estado: 'active', tel: true, pend: false, wa: true, ventana: true, destino: 'listo', activas: 1 }, 'the real name of the person, not the public name of the profile')
  assert.deepEqual(r.listoDatos, [true, 'DNI', true], 'the account by its id, its document, the phone masked')
  assert.deepEqual(r.soloTelefono, { nombre: 'Persona tel', estado: 'active', tel: true, pend: false, wa: false, ventana: false, destino: 'no_vinculado', activas: 1 }, 'a verified phone is not a linked WhatsApp')
  assert.deepEqual(r.lejos, ['ventana_cerrada', 'plantilla'], 'outside the 24 hours it depends on the approved template')
  assert.deepEqual(r.nunca, ['ventana_cerrada', 'plantilla', true], 'a number linked by the administration that never wrote')
  assert.deepEqual([r.pendiente.tel, r.pendiente.pend, r.pendiente.destino], [false, true, 'no_vinculado'], 'a pending phone is not verified')
  assert.deepEqual(r.dos, [true, 2], 'two active accounts: the oldest, and the count to reconcile')
  assert.equal(r.suspendida.estado, 'suspended', 'a suspended account is shown as such')
  assert.equal(r.huerfano, false, 'a profile without account has none to show')
  assert.deepEqual(r.mismaRegla, [true, true, null, null], 'the notices go to the same account, and to nobody when there is no active one')
  assert.equal(r.vacio, 0)
})

test('ADMIN prestador-cuenta: the table and the sheet show the account, the phone and the WhatsApp state separately, and the public name is labelled as such', () => {
  const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8')
  const lista = leer('../../apps/web/src/components/admin/admin-prestadores-lista.tsx')
  const ficha = leer('../../apps/web/src/components/admin/admin-prestador-detalle.tsx')
  const api = leer('../../apps/api/src/tus/admin/http.ts')
  assert.match(lista, /<th>Nombre público<\/th><th>Cuenta<\/th><th>Teléfono<\/th><th>WhatsApp<\/th>/u)
  assert.match(lista, /data-whatsapp-destino=\{item\.whatsappDestino/u)
  assert.match(lista, /Sin cuenta/u)
  assert.match(ficha, /Cuenta asociada/u)
  assert.match(ficha, /Perfil profesional/u)
  assert.match(ficha, /Nombre real/u)
  assert.match(ficha, /Nombre público/u)
  for (const dato of ['Documento', 'Identidad', 'Teléfono', 'WhatsApp', 'Estado de la cuenta', 'Diagnóstico']) assert.ok(ficha.includes(dato), dato)
  assert.match(api, /cuentasDePrestadores\(items\.map\(\(item\) => item\.tenantId\)\)/u, 'one batch for the page, by tenant id')
  assert.doesNotMatch(leer('../../apps/api/src/tus/admin/cuenta-prestador.ts'), /nombrePublico|displayName:\s*\{|contains/u, 'never resolved by a name')
})
