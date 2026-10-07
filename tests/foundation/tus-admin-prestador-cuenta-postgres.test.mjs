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

test('ADMIN prestador-cuenta PostgreSQL: a provider is linked to ONE account by id (prestadores.cuenta_id), never chosen by age, name or email; phone verified, WhatsApp linked and "can receive requests now" are separate facts with their own evidence; unlinked, ambiguous and invalid links are reported and resolve to nobody; the backfill only links what is unambiguous', { skip, timeout: 240_000 }, () => {
  const r = runTypeScriptScenario(`
    const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
    const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
    const { crearLectorCuentasPrestador } = await import('./apps/api/src/tus/admin/cuenta-prestador.ts')
    const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')
    const { readFileSync } = await import('node:fs')
    const run = 'pc' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
    const out = {}
    try {
      const ahora = new Date()
      const tenant = async (tag) => { const id = run + '-t-' + tag; await prisma.tusTenant.create({ data: { id, slug: id, name: tag, status: 'active', createdAt: ahora, updatedAt: ahora } }); return id }
      let n = 0
      // The provider row of a tenant, linked (or not) to an account by id.
      const prov = (tenantId, tag, cuentaId = null) => prisma.prestador.create({ data: { id: run + '-p-' + tag, tenantId, prestadorId: run + '-pr-' + tag, cohorte: 'repairs-trades', ubicacionId: 'u', zonaHoraria: 'America/Argentina/Buenos_Aires', rolesPersonal: ['owner'], versionPoliticaOperativa: 'v1', estado: 'approved', cuentaId, fechaCreacion: ahora, fechaActualizacion: ahora } })
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
      await prov(tListo, 'listo', aListo)
      await contacto(aListo, tListo, 'listo', 3600_000)
      // verified phone, NO WhatsApp linked
      const tTel = await tenant('tel')
      await prov(tTel, 'tel', await cuenta(tTel, 'tel', { user: { phoneNumber: telefono(2), phoneVerifiedAt: ahora } }))
      // linked, last message two days ago
      const tLejos = await tenant('lejos')
      const aLejos = await cuenta(tLejos, 'lejos', { user: { phoneNumber: telefono(3), phoneVerifiedAt: ahora } })
      await prov(tLejos, 'lejos', aLejos)
      await contacto(aLejos, tLejos, 'lejos', 48 * 3600_000)
      // linked by the administration, the number never wrote
      const tNunca = await tenant('nunca')
      const aNunca = await cuenta(tNunca, 'nunca', { user: { phoneNumber: telefono(4), phoneVerifiedAt: ahora } })
      await prov(tNunca, 'nunca', aNunca)
      await contacto(aNunca, tNunca, 'nunca', null)
      // only a pending phone
      const tPend = await tenant('pend')
      await prov(tPend, 'pend', await cuenta(tPend, 'pend', { user: { phonePending: telefono(5) } }))
      // two accounts in one tenant, the provider linked to the NEWER one: the link decides, not the age
      const tDos = await tenant('dos')
      const vieja = await cuenta(tDos, 'dos-vieja', { user: { phoneNumber: telefono(6), phoneVerifiedAt: ahora } }, new Date(Date.now() - 86_400_000))
      const nueva = await cuenta(tDos, 'dos-nueva', {})
      await prov(tDos, 'dos', nueva)
      await contacto(vieja, tDos, 'dos-vieja', 3600_000)
      // two accounts and NO link: nobody is chosen
      const tSinVinculo = await tenant('sinvinculo')
      const candidata = await cuenta(tSinVinculo, 'sv-1', { user: { phoneNumber: telefono(7), phoneVerifiedAt: ahora } }, new Date(Date.now() - 86_400_000))
      await cuenta(tSinVinculo, 'sv-2', {})
      await prov(tSinVinculo, 'sinvinculo', null)
      await contacto(candidata, tSinVinculo, 'sv-1', 3600_000)
      // linked to a suspended account; linked to an account of ANOTHER tenant; no account at all
      const tSusp = await tenant('susp')
      await prov(tSusp, 'susp', await cuenta(tSusp, 'susp', {}, ahora, 'suspended'))
      const tAjena = await tenant('ajena')
      const tOtro = await tenant('homonimo')
      // someone else with the SAME name as the provider of tListo: never matched by name
      const homonimo = await cuenta(tOtro, 'homonimo', { displayName: 'gaby', user: { firstName: 'Gabriela', lastName: 'López' } })
      await prov(tAjena, 'ajena', homonimo)
      const tHuerfano = await tenant('huerfano')
      await prov(tHuerfano, 'huerfano', null)
      // one account is the account of at most one provider (the database refuses a second link)
      const tRepetido = await tenant('repetido')
      out.cuentaRepetida = await prov(tRepetido, 'repetido', aListo).then(() => 'ok', (e) => (String(e?.message ?? e).includes('uq_prestadores_cuenta') || e?.code === 'P2002' ? 'unique' : String(e?.code ?? e)))
      out.cuentaInexistente = await prov(tRepetido, 'fantasma', 'no-existe-' + run).then(() => 'ok', (e) => (e?.code === 'P2003' || String(e?.message ?? e).includes('fk_prestadores_cuenta') ? 'fk' : String(e?.code ?? e)))

      const todos = [tListo, tTel, tLejos, tNunca, tPend, tDos, tSinVinculo, tSusp, tAjena, tHuerfano]
      const sinPlantilla = await crearLectorCuentasPrestador(prisma, { plantillaAprobada: () => false })(todos)
      const conPlantilla = await crearLectorCuentasPrestador(prisma, { plantillaAprobada: () => true })(todos)
      const ver = (leido, t) => { const c = leido.cuentas.get(t); return c ? { nombre: c.nombre, estado: c.estado, tel: c.telefono.verificado, pend: Boolean(c.telefono.pendiente), wa: c.whatsapp.vinculado, ventana: c.whatsapp.ventanaAbierta, destino: c.whatsapp.destino, enTenant: c.cuentasEnTenant } : null }
      const problema = (t) => { const p = sinPlantilla.problemas.get(t); return p ? p.motivo + ':' + p.cuentasEnTenant : null }
      out.listo = ver(sinPlantilla, tListo)
      out.listoDatos = [sinPlantilla.cuentas.get(tListo).cuentaId === aListo, sinPlantilla.cuentas.get(tListo).documento.tipo, [...sinPlantilla.cuentas.get(tListo).telefono.numero].some((letra) => letra !== '+' && (letra < '0' || letra > '9'))]
      out.soloTelefono = ver(sinPlantilla, tTel)
      out.lejos = [ver(sinPlantilla, tLejos).destino, ver(conPlantilla, tLejos).destino]
      out.nunca = [ver(sinPlantilla, tNunca).destino, ver(conPlantilla, tNunca).destino, ver(sinPlantilla, tNunca).wa]
      out.pendiente = ver(sinPlantilla, tPend)
      // the linked (newer) account, with ITS phone and WhatsApp: the older one's are not borrowed
      out.dos = [sinPlantilla.cuentas.get(tDos).cuentaId === nueva, ver(sinPlantilla, tDos).tel, ver(sinPlantilla, tDos).wa, ver(sinPlantilla, tDos).enTenant, problema(tDos)]
      out.problemas = { sinVinculo: [sinPlantilla.cuentas.has(tSinVinculo), problema(tSinVinculo)], suspendida: [sinPlantilla.cuentas.has(tSusp), problema(tSusp)], ajena: [sinPlantilla.cuentas.has(tAjena), problema(tAjena)], huerfano: [sinPlantilla.cuentas.has(tHuerfano), problema(tHuerfano)] }
      // the backend notifies exactly the account Admin shows, and nobody when there is none to be sure of
      const turnos = new ServicioTurnos(prisma)
      const destinatario = (t) => turnos['cuentaPrestadorId'](t)
      out.mismaRegla = [await destinatario(tListo) === aListo, await destinatario(tDos) === nueva, await destinatario(tSinVinculo), await destinatario(tSusp), await destinatario(tAjena), await destinatario(tHuerfano)]
      out.vacio = (await crearLectorCuentasPrestador(prisma, { plantillaAprobada: () => false })([])).cuentas.size

      // the backfill of the migration, run again on rows it has not seen: only the unambiguous one
      const tUno = await tenant('bf-uno'); const unica = await cuenta(tUno, 'bf-uno', {}); await prov(tUno, 'bf-uno', null)
      const tVarias = await tenant('bf-varias'); await cuenta(tVarias, 'bf-v1', {}); await cuenta(tVarias, 'bf-v2', {}); await prov(tVarias, 'bf-varias', null)
      const tDosProv = await tenant('bf-dosprov'); await cuenta(tDosProv, 'bf-dp', {}); await prov(tDosProv, 'bf-dp1', null); await prov(tDosProv, 'bf-dp2', null)
      const sql = readFileSync('./apps/api/prisma/migrations/20261109100000_tus_prestador_cuenta/migration.sql', 'utf8')
      await prisma.$executeRawUnsafe(sql.slice(sql.indexOf('UPDATE public."prestadores"')))
      const enlace = async (t) => (await prisma.prestador.findMany({ where: { tenantId: t }, select: { cuentaId: true } })).map((p) => p.cuentaId)
      out.backfill = { uno: (await enlace(tUno))[0] === unica, varias: await enlace(tVarias), dosProv: await enlace(tDosProv), noTocaLoVinculado: (await enlace(tDos))[0] === nueva, sinVinculoSigue: await enlace(tSinVinculo) }
      console.log(JSON.stringify(out))
    } finally { await prisma.$disconnect() }
  `)
  assert.deepEqual(r.listo, { nombre: 'Gabriela López', estado: 'active', tel: true, pend: false, wa: true, ventana: true, destino: 'listo', enTenant: 1 }, 'the real name of the person, not the public name of the profile')
  assert.deepEqual(r.listoDatos, [true, 'DNI', true], 'the account by its id, its document, the phone masked')
  assert.deepEqual(r.soloTelefono, { nombre: 'Persona tel', estado: 'active', tel: true, pend: false, wa: false, ventana: false, destino: 'no_vinculado', enTenant: 1 }, 'a verified phone is not a linked WhatsApp')
  assert.deepEqual(r.lejos, ['ventana_cerrada', 'plantilla'], 'outside the 24 hours it depends on the approved template')
  assert.deepEqual(r.nunca, ['ventana_cerrada', 'plantilla', true], 'a number linked by the administration that never wrote')
  assert.deepEqual([r.pendiente.tel, r.pendiente.pend, r.pendiente.destino], [false, true, 'no_vinculado'], 'a pending phone is not verified')
  assert.deepEqual(r.dos, [true, false, false, 2, null], 'the LINKED account decides (here the newer one), with its own phone and WhatsApp; the older account lends nothing')
  assert.deepEqual(r.problemas, { sinVinculo: [false, 'sin_vincular:2'], suspendida: [false, 'cuenta_invalida:1'], ajena: [false, 'cuenta_invalida:0'], huerfano: [false, 'sin_vincular:0'] }, 'no link, an inactive account, an account of another tenant, no account: nobody, with the reason')
  assert.deepEqual([r.cuentaRepetida, r.cuentaInexistente], ['unique', 'fk'], 'the database keeps one account per provider and only real accounts')
  assert.deepEqual(r.mismaRegla, [true, true, null, null, null, null], 'notices go to the linked account, and to nobody when there is none to be sure of')
  assert.equal(r.vacio, 0)
  assert.deepEqual(r.backfill, { uno: true, varias: [null], dosProv: [null, null], noTocaLoVinculado: true, sinVinculoSigue: [null] }, 'the backfill links only what has nothing to choose; the rest waits for a person')
})

test('ADMIN prestador-cuenta: the table and the sheet show the account, the phone and the WhatsApp state separately, and the public name is labelled as such', () => {
  const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8')
  const lista = leer('../../apps/web/src/components/admin/admin-prestadores-lista.tsx')
  const ficha = leer('../../apps/web/src/components/admin/admin-prestador-detalle.tsx')
  const api = leer('../../apps/api/src/tus/admin/http.ts')
  assert.match(lista, /<th>Nombre público<\/th><th>Cuenta<\/th><th>Teléfono y WhatsApp<\/th>/u)
  assert.match(lista, /data-whatsapp-destino=\{item\.whatsappDestino/u)
  assert.match(lista, /Sin cuenta vinculada/u)
  assert.match(lista, /data-cuenta-problema/u)
  assert.match(ficha, /data-cuenta-problema/u)
  assert.match(ficha, /Cuenta asociada/u)
  assert.match(ficha, /Perfil profesional/u)
  assert.match(ficha, /Nombre real/u)
  assert.match(ficha, /Nombre público/u)
  for (const dato of ['Documento', 'Identidad', 'Teléfono', 'WhatsApp', 'Estado de la cuenta', 'Diagnóstico']) assert.ok(ficha.includes(dato), dato)
  assert.match(api, /cuentasDePrestadores\(items\.map\(\(item\) => item\.tenantId\)\)/u, 'one batch for the page, by tenant id')
  assert.doesNotMatch(leer('../../apps/api/src/tus/admin/cuenta-prestador.ts'), /nombrePublico|displayName:\s*\{|contains/u, 'never resolved by a name')
  // The oldest-account rule is gone from every place that resolves the account of a provider.
  const resolvedor = leer('../../apps/api/src/tus/directorio/cuenta-prestador.ts').split(/\r?\n/u).filter((linea) => !linea.trim().startsWith('//')).join(' ')
  assert.doesNotMatch(resolvedor, /orderBy|createdAt|displayName|email/u, 'the resolver reads the link, nothing else')
  for (const archivo of ['../../apps/api/src/tus/calendar/turnos-service.ts', '../../apps/api/src/tus/calendar/turnos-notificaciones.ts']) assert.doesNotMatch(leer(archivo), /where: \{ tenantId[^}]*status: 'active' \}[^)]*orderBy: \{ createdAt: 'asc' \}/u, archivo + ': no account is chosen by age')
  assert.match(leer('../../apps/api/src/tus/calendar/turnos-service.ts'), /cuentaDePrestador\(this\.prisma/u)
})
