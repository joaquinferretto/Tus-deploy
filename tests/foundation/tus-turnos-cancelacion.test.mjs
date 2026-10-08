import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TURNOS-CANCELACION-01 / TURNOS-RECORDATORIOS-01 without a database: the rule of the 24 hours at
// its borders, the wording each party reads, and what the Web and the server are wired to do.
const root = join(import.meta.dirname, '../..')
const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')

test('CANCELACION política de dos ventanas: last moment (24 h or less before the turno) prevails and refunds nothing; the grace period (24 h since the reservation) refunds the service; in between the penalty is half of the value of the service; the charge of TUS is separate and never refunded; nothing beyond what was paid is ever charged; the provider cancelling never penalizes the client', () => {
  const r = runTypeScriptScenario(`
    const c = await import('./packages/contracts/src/tus-turnos.ts')
    const HORA = 3600_000
    // Reserved on Monday 10:00 for Friday 15:00. Price $20.000; TUS charges 10% inside each payment.
    const creada = Date.parse('2026-10-19T10:00:00.000-03:00')
    const inicio = Date.parse('2026-10-23T15:00:00.000-03:00')
    const SENA = { precio: 2_000_000, pagado: 1_000_000, cargoTus: 100_000 }
    const TOTAL = { precio: 2_000_000, pagado: 2_000_000, cargoTus: 200_000 }
    const lunesNoche = Date.parse('2026-10-19T22:00:00.000-03:00')
    const martes = Date.parse('2026-10-20T12:00:00.000-03:00')
    const calc = (pago, ahora, por = 'cliente', tiempos = {}) => c.calcularCancelacion({ por, ahora, reservaCreadaEn: creada, inicio, ...pago, ...tiempos })
    const ver = (d) => [d.regla, d.servicioPagado, d.cargoTus, d.reembolsable, d.penalizacion, d.devolucion]
    const casos = {
      graciaSena: calc(SENA, lunesNoche), graciaTotal: calc(TOTAL, lunesNoche),
      intermediaSena: calc(SENA, martes), intermediaTotal: calc(TOTAL, martes),
      ultimoSena: calc(SENA, inicio - 24 * HORA), ultimoTotal: calc(TOTAL, inicio - 3 * HORA),
      // Reserved 2 hours ago for a turno that starts in 20 hours: the last moment prevails.
      hoyParaManana: c.calcularCancelacion({ por: 'cliente', ahora: creada + 2 * HORA, reservaCreadaEn: creada, inicio: creada + 22 * HORA, ...TOTAL }),
      // Something smaller than the deposit was paid: the penalty stops at what was paid.
      pagoChico: calc({ precio: 2_000_000, pagado: 500_000, cargoTus: 50_000 }, martes),
      prestador: calc(TOTAL, inicio - 3 * HORA, 'prestador'), administracion: calc(SENA, martes, 'administracion'),
      sinPago: calc({ precio: 2_000_000, pagado: 0, cargoTus: 0 }, inicio - HORA),
      sinCargo: calc({ precio: 2_000_000, pagado: 2_000_000, cargoTus: 0 }, martes),
    }
    const todos = Object.values(casos)
    console.log(JSON.stringify({
      casos: Object.fromEntries(Object.entries(casos).map(([k, d]) => [k, ver(d)])),
      bordes: {
        gracia: [creada + 24 * HORA, creada + 24 * HORA + 1].map((ahora) => calc(SENA, ahora).regla),
        ultimo: [inicio - 24 * HORA - 60_000, inicio - 24 * HORA - 1, inicio - 24 * HORA, inicio - 24 * HORA + 60_000].map((ahora) => calc(SENA, ahora).regla),
      },
      suman: todos.every((d) => d.servicioPagado + d.cargoTus === d.pagado && d.reembolsable + d.penalizacion === d.servicioPagado && d.reembolsable >= 0 && d.penalizacion >= 0),
      nuncaMasDeLoPagado: todos.every((d) => d.penalizacion + d.cargoTus <= d.pagado),
      confirmacion: Object.fromEntries(Object.entries(casos).map(([k, d]) => [k, c.cancelacionRequiereConfirmacion(d)])),
      mensajes: Object.fromEntries(['graciaSena', 'intermediaSena', 'intermediaTotal', 'ultimoSena', 'ultimoTotal'].map((k) => [k, c.mensajeConfirmacionCancelacion(casos[k])])),
      resumenes: Object.fromEntries(['graciaSena', 'intermediaSena', 'intermediaTotal', 'ultimoTotal', 'prestador', 'sinPago'].map((k) => [k, c.resumenCancelacion(casos[k])])),
      version: c.VERSION_POLITICA_CANCELACION,
      textos: [c.textoPoliticaCancelacion('sena'), c.textoPoliticaCancelacion('total')],
    }))
  `)
  // [regla, servicio pagado, cargo TUS, reembolsable, penalización, devolución] in centavos.
  assert.deepEqual(r.casos.graciaSena, ['gracia', 900_000, 100_000, 900_000, 0, 'corresponde'], 'Monday night: the service paid is refunded, the charge of TUS is kept')
  assert.deepEqual(r.casos.graciaTotal, ['gracia', 1_800_000, 200_000, 1_800_000, 0, 'corresponde'])
  assert.deepEqual(r.casos.intermediaSena, ['intermedia', 900_000, 100_000, 0, 900_000, 'no_reembolsable'], 'Tuesday with a deposit: the deposit is kept, nothing is refunded')
  assert.deepEqual(r.casos.intermediaTotal, ['intermedia', 1_800_000, 200_000, 900_000, 900_000, 'corresponde'], 'Tuesday paid in total: half of the service is kept, the other half is refunded')
  assert.deepEqual(r.casos.ultimoSena, ['ultimo_momento', 900_000, 100_000, 0, 900_000, 'no_reembolsable'], 'exactly 24 h before with a deposit: the whole deposit is kept')
  assert.deepEqual(r.casos.ultimoTotal, ['ultimo_momento', 1_800_000, 200_000, 0, 1_800_000, 'no_reembolsable'], '24 h or less paid in total: everything is kept')
  assert.deepEqual(r.casos.hoyParaManana, ['ultimo_momento', 1_800_000, 200_000, 0, 1_800_000, 'no_reembolsable'], 'reserved today for tomorrow: the grace period does not contradict the last moment')
  assert.deepEqual(r.casos.pagoChico, ['intermedia', 450_000, 50_000, 0, 450_000, 'no_reembolsable'], 'the penalty stops at what was paid: nothing else is charged')
  assert.deepEqual(r.casos.prestador, ['prestador', 1_800_000, 200_000, 1_800_000, 0, 'corresponde'], 'the provider cancelling 3 h before: everything paid for the service goes back')
  assert.deepEqual(r.casos.administracion, ['administracion', 900_000, 100_000, 900_000, 0, 'corresponde'])
  assert.deepEqual(r.casos.sinPago, ['ultimo_momento', 0, 0, 0, 0, 'sin_pago'])
  assert.deepEqual(r.casos.sinCargo, ['intermedia', 2_000_000, 0, 1_000_000, 1_000_000, 'corresponde'])
  assert.deepEqual(r.bordes.gracia, ['gracia', 'intermedia'], 'exactly 24 h after reserving is still the grace period')
  assert.deepEqual(r.bordes.ultimo, ['intermedia', 'intermedia', 'ultimo_momento', 'ultimo_momento'], '24 h + 1 min is not the last moment; exactly 24 h is')
  assert.equal(r.suman, true, 'service + charge = paid, and refundable + penalty = service, always')
  assert.equal(r.nuncaMasDeLoPagado, true)
  // Anything the client does not get back (even only the charge of TUS) is confirmed explicitly.
  assert.deepEqual(r.confirmacion, { graciaSena: true, graciaTotal: true, intermediaSena: true, intermediaTotal: true, ultimoSena: true, ultimoTotal: true, hoyParaManana: true, pagoChico: true, prestador: false, administracion: false, sinPago: false, sinCargo: true })
  assert.equal(r.mensajes.graciaSena, 'Estás dentro de las 24 horas de tu reserva: si cancelás ahora se te devuelve $9.000. El cargo de TUS ($1.000) no es reembolsable. ¿Querés continuar?')
  assert.equal(r.mensajes.intermediaSena, 'Ya pasaron más de 24 horas desde tu reserva: si cancelás ahora se retiene lo que pagaste ($10.000) y no hay devolución. ¿Querés continuar?')
  assert.equal(r.mensajes.intermediaTotal, 'Ya pasaron más de 24 horas desde tu reserva: si cancelás ahora se retiene la mitad del valor del servicio ($9.000) y se te devuelve $9.000. El cargo de TUS ($2.000) no es reembolsable. ¿Querés continuar?')
  assert.equal(r.mensajes.ultimoSena, 'Este turno comienza dentro de las próximas 24 horas. Si cancelás ahora, la seña no será reembolsada. ¿Querés continuar?')
  assert.equal(r.mensajes.ultimoTotal, 'Este turno comienza dentro de las próximas 24 horas. Si cancelás ahora, no se te devolverá ningún monto de lo abonado. ¿Querés continuar?')
  assert.equal(r.resumenes.graciaSena, 'Te corresponde la devolución de $9.000: TUS la procesa y te avisa. El cargo de TUS ($1.000) no es reembolsable.')
  assert.equal(r.resumenes.intermediaSena, 'No hay devolución: se retiene lo que pagaste ($10.000).')
  assert.equal(r.resumenes.intermediaTotal, 'Se retiene $9.000 y te corresponde la devolución de $9.000: TUS la procesa y te avisa. El cargo de TUS ($2.000) no es reembolsable.')
  assert.equal(r.resumenes.ultimoTotal, 'No hay devolución: se retiene lo que pagaste ($20.000).')
  assert.equal(r.resumenes.prestador, 'Te corresponde la devolución de lo que pagaste por el servicio ($18.000): TUS la procesa y te avisa.')
  assert.equal(r.resumenes.sinPago, '')
  assert.equal(r.version, '2026-10-v2')
  assert.match(r.textos[0], /dentro de las 24 horas de reservar, si faltan más de 24 horas para el turno\. Después la seña no es reembolsable\. El cargo de TUS nunca se devuelve\./u)
  assert.match(r.textos[1], /Después se retiene la mitad del valor del servicio, y con 24 horas o menos de anticipación no se te devolverá ningún monto\. El cargo de TUS nunca se devuelve\./u)
})

test('RECORDATORIOS textos y botones: the client is told about the deposit only when it paid something; the provider never is; the buttons carry which reminder and nothing else; the policy buttons carry the turno and the way of paying', () => {
  const r = runTypeScriptScenario(`
    const { textoRecordatorio, PLANTILLAS_RECORDATORIO, BOTONES_RECORDATORIO } = await import('./apps/api/src/tus/asistente/avisos-recordatorios.ts')
    const { idRecordatorio, leerRecordatorio, ANTICIPACION_RECORDATORIO_MS } = await import('./apps/api/src/tus/calendar/turnos-recordatorios.ts')
    const { idPolitica, leerPolitica, pedirPolitica } = await import('./apps/api/src/tus/asistente/orquestador.ts')
    const { WhatsappTemplateService } = await import('./apps/api/src/tus/asistente/plantillas.ts')
    const base = { recordatorioId: 'rec-12345678-aaaa', reservaId: 'res-1', cuentaId: 'c', nombre: 'Joaquin Ferretto', contraparte: 'Flor Perez', servicio: 'Masaje', inicio: new Date('2026-10-09T15:00:00.000-03:00'), conPago: true }
    const texto = (tipo, destinatario, conPago = true) => textoRecordatorio({ ...base, tipo, destinatario, conPago })
    const ids = [idRecordatorio('asiste', base.recordatorioId), idRecordatorio('nopuede', base.recordatorioId)]
    const servicio = new WhatsappTemplateService(new Set(['turno_recordatorio_24h']))
    const valores = { nombre: 'Joaquin', servicio: 'Masaje', fecha: '9 de octubre', hora: '15:00', contraparte: 'Flor Perez' }
    const intentar = (op) => { try { return op() } catch (e) { return e.code } }
    const politica = pedirPolitica('res-abc', 'sena', 'Seña de tu turno.')
    console.log(JSON.stringify({
      textos: [texto('24h', 'cliente'), texto('2h', 'cliente'), texto('24h', 'cliente', false), texto('24h', 'prestador'), texto('2h', 'prestador')],
      plantillas: PLANTILLAS_RECORDATORIO, botones: BOTONES_RECORDATORIO, anticipacion: ANTICIPACION_RECORDATORIO_MS,
      ids, leidos: [leerRecordatorio(ids[0]), leerRecordatorio(idRecordatorio('cancelar-perdida', base.recordatorioId)), leerRecordatorio('recordatorio:asiste:otra-cosa'), leerRecordatorio('turno:aceptar:res-1'), leerRecordatorio(null)],
      construida: servicio.construir('turno_recordatorio_24h', valores, ids),
      sinAprobar: intentar(() => servicio.construir('turno_recordatorio_2h', valores, ids)),
      sinBotones: intentar(() => servicio.construir('turno_recordatorio_24h', valores)),
      aprobadas: [servicio.aprobada('turno_recordatorio_24h'), servicio.aprobada('turno_recordatorio_2h'), new WhatsappTemplateService(new Set(['inventada'])).aprobada('inventada')],
      politica: [politica.type, politica.text, politica.buttons.map((b) => b.title), leerPolitica(politica.buttons[0].id), leerPolitica(idPolitica('volver', 'total', 'res-abc')), leerPolitica('politica:aceptar:saldo:res-abc')],
    }))
  `)
  assert.equal(r.textos[0], 'Hola, Joaquin. Te recordamos que mañana tenés un turno de Masaje el viernes 9 de octubre a las 15:00 con Flor Perez. Como se informó al reservar, desde este momento la seña no es reembolsable si cancelás el turno.')
  assert.equal(r.textos[1], 'Hola, Joaquin. Te recordamos que tu turno de Masaje es hoy a las 15:00 con Flor Perez. Si cancelás ahora, la seña abonada no es reembolsable.')
  assert.doesNotMatch(r.textos[2], /seña/u, 'a client that paid nothing is not told about a deposit')
  for (const texto of r.textos.slice(3)) assert.doesNotMatch(texto, /seña|reembols/u, 'the provider is never told about the deposit')
  assert.deepEqual(r.plantillas, { cliente: { '24h': 'turno_recordatorio_24h', '2h': 'turno_recordatorio_2h' }, prestador: { '24h': 'turno_recordatorio_24h_prestador', '2h': 'turno_recordatorio_2h_prestador' } })
  assert.deepEqual(r.botones, ['Confirmar asistencia', 'No puedo asistir'])
  assert.deepEqual(r.anticipacion, { '24h': 86_400_000, '2h': 7_200_000 })
  assert.deepEqual(r.leidos, [{ accion: 'asiste', recordatorioId: 'rec-12345678-aaaa' }, { accion: 'cancelar-perdida', recordatorioId: 'rec-12345678-aaaa' }, null, null, null])
  assert.deepEqual(r.construida, { type: 'template', name: 'turno_recordatorio_24h', language: 'es_AR', parameters: ['Joaquin', 'Masaje', '9 de octubre', '15:00', 'Flor Perez'], buttonPayloads: r.ids })
  assert.equal(r.sinAprobar, 'TEMPLATE_NOT_APPROVED', 'a template that is not enabled is never built')
  assert.equal(r.sinBotones, 'TEMPLATE_PARAMETERS')
  assert.deepEqual(r.aprobadas, [true, false, false], 'enabled in the configuration AND defined by TUS')
  assert.deepEqual(r.politica.slice(0, 3), ['buttons', 'Seña de tu turno. La seña reserva tu turno. Podés cancelar con devolución dentro de las 24 horas de reservar, si faltan más de 24 horas para el turno. Después la seña no es reembolsable. El cargo de TUS nunca se devuelve. ¿Aceptás y seguimos con el pago?', ['Aceptar y pagar', 'Volver']])
  assert.deepEqual(r.politica.slice(3), [{ accion: 'aceptar', tramo: 'sena', ref: 'res-abc' }, { accion: 'volver', tramo: 'total', ref: 'res-abc' }, null])
})

test('CANCELACION y RECORDATORIOS cableado: the Web shows both confirmations only when the API asks for them and sends the answer back; the server runs the reminders as a sweep over the database (no timer per turno, no language model); outside the window only the template is used', () => {
  const pagina = read('apps/web/src/features/turnos/mis-turnos-page.tsx')
  const cliente = read('apps/web/src/lib/tus-turnos-client.ts')
  const servidor = read('apps/api/src/server.ts')
  const servicio = read('apps/api/src/tus/calendar/turnos-recordatorios.ts')
  const canal = read('apps/api/src/tus/asistente/avisos-recordatorios.ts')
  const http = read('apps/api/src/tus/calendar/turnos-http.ts')
  const migracion = read('apps/api/prisma/migrations/20261114100000_tus_turnos_recordatorios_cancelacion/migration.sql')

  // Web: the policy before the payment, and the loss before a late cancellation.
  assert.match(pagina, /causa\.code === CODIGO_POLITICA_CANCELACION_REQUERIDA\) return setPolitica\(/u)
  assert.match(pagina, /data-politica-cancelacion[\s\S]{0,700}Vas a pagar una seña de \$\{formatearPesos\(turno\.sena\?\.monto \?\? 0\)\}\.`\} \{textoPoliticaCancelacion\(politica\.tramo\)\} Al continuar aceptás esta política de cancelación\./u)
  assert.match(pagina, /data-aceptar-politica[^>]*onClick=\{\(\) => void pagar\(turno, politica\.tramo, true\)\}[\s\S]{0,200}Aceptar y pagar[\s\S]{0,300}Volver/u)
  assert.match(pagina, /pagarTurno\(turno\.id, tramo, aceptaPolitica \? VERSION_POLITICA_CANCELACION : undefined\)/u)
  assert.match(pagina, /causa\.code === CODIGO_CANCELACION_TARDIA\) setPerdida\(\{ id: turno\.id, mensaje: causa\.message \}\)/u)
  assert.match(pagina, /data-cancelacion-tardia[\s\S]{0,400}\{perdida\.mensaje\}[\s\S]{0,500}data-confirmar-perdida[^>]*onClick=\{\(\) => void cancelar\(turno, true\)\}/u)
  // The Web never decides the 24 hours by itself.
  // The Web never decides the rule nor computes an amount: the API's words and amounts are shown.
  assert.doesNotMatch(pagina, /esCancelacionTardia|enPeriodoDeGracia|calcularCancelacion|VENTANA_CANCELACION_MS|24 \* 60/u)
  assert.match(pagina, /\{turno\.cancelacion\.resumen\}/u)
  assert.match(cliente, /code === CODIGO_CANCELACION_TARDIA && typeof body\?\.error === 'string'/u)
  assert.match(cliente, /JSON\.stringify\(\{ tramo, \.\.\.\(aceptaPolitica \? \{ aceptaPolitica \} : \{\}\) \}\)/u)
  assert.match(cliente, /cancelarMiTurno: \(id: string, confirmaPerdida = false\)[\s\S]{0,260}JSON\.stringify\(\{ confirmaPerdida: true \}\)/u)
  // API: the body of the cancellation carries only the confirmation; the canal is the server's.
  assert.match(http, /filter\(\(campo\) => campo !== 'confirmaPerdida'\)/u)
  assert.match(http, /confirmaPerdida: cuerpo\['confirmaPerdida'\] === true, canal: 'web'/u)

  // Reminders: a sweep, wired with a late-bound channel, stopped with the server.
  assert.match(servidor, /new ServicioRecordatoriosTurno\(prisma as unknown as PrismaClient, \(reservaId\) => servicioTurnos\.datosDeRecordatorio\(reservaId\), null\)/u)
  assert.match(servidor, /if \(whatsapp\) recordatorios\.conCanal\(whatsapp\.avisosRecordatorios\)/u)
  assert.match(servidor, /recordatoriosVivos[\s\S]{0,500}\.procesar\(\)[\s\S]{0,400}60_000\)[\s\S]{0,200}lifecycle\.register\('turno-reminder-sweep'/u)
  assert.doesNotMatch(servicio, /setTimeout|setInterval/u, 'no timer belongs to a turno')
  assert.doesNotMatch(servicio + canal, /groq|chat\.|completion|embedding/iu, 'no language model')
  assert.match(servicio, /where: \{ id: fila\.id, estado: 'pending' \}, data: \{ estado: 'sending'/u, 'a row is taken before it is sent')
  assert.match(servicio, /createMany\(\{ data: nuevos, skipDuplicates: true \}\)/u)
  // Outside the window: the template or nothing (never free text).
  assert.match(canal, /for \(const destino of abiertos\) contar\(await this\.enviar\(destino, interactivo, correlacion\), 'ventana'\)/u)
  assert.match(canal, /if \(cerrados\.length > 0\) \{\s*if \(!this\.plantillas\?\.aprobada\(nombrePlantilla\)\) sinPlantilla = true\s*else \{[\s\S]{0,700}this\.enviar\(\{ conversacion, contacto \}, plantilla, correlacion\), 'plantilla'\)/u)

  // Migration: additive, idempotency in the database, RLS like every table of TUS.
  assert.doesNotMatch(migracion, /\bDROP\b|\bDELETE FROM\b|\bUPDATE public\b|\bINSERT INTO\b|ALTER TABLE public\."(?!recordatorios_turno|aceptaciones_politica_cancelacion|cancelaciones_turno)/u)
  assert.match(migracion, /CREATE UNIQUE INDEX "uq_recordatorios_turno" ON public\."recordatorios_turno" \("reserva_id", "destinatario", "tipo", "turno_inicio"\)/u)
  assert.equal((migracion.match(/ENABLE ROW LEVEL SECURITY/gu) ?? []).length, 3)
  assert.match(migracion, /CHECK \("cancelada_por" = 'cliente' OR "penalizacion_minor" = 0\)/u, 'the penalty is only ever the client\'s')
  assert.match(migracion, /"servicio_pagado_minor" \+ "cargo_tus_minor" = "pagado_minor"\s+AND "reembolsable_minor" \+ "penalizacion_minor" = "servicio_pagado_minor"/u, 'the accounting always adds up, in the database too')
})
