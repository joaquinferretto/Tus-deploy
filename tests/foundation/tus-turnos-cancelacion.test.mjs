import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// TURNOS-CANCELACION-01 / TURNOS-RECORDATORIOS-01 without a database: the rule of the 24 hours at
// its borders, the wording each party reads, and what the Web and the server are wired to do.
const root = join(import.meta.dirname, '../..')
const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')

test('CANCELACION regla de 24 horas: 24 h + 1 minuto is on time; exactly 24 h, 23 h 59 min and anything later are a late cancellation; the policy has a version and one text per way of paying', () => {
  const r = runTypeScriptScenario(`
    const c = await import('./packages/contracts/src/tus-turnos.ts')
    const inicio = Date.parse('2026-10-20T15:00:00.000-03:00')
    const HORA = 3600_000
    console.log(JSON.stringify({
      bordes: [inicio - 24 * HORA - 60_000, inicio - 24 * HORA - 1, inicio - 24 * HORA, inicio - 24 * HORA + 60_000, inicio - HORA, inicio].map((ahora) => c.esCancelacionTardia(new Date(inicio), ahora)),
      formas: [c.esCancelacionTardia(new Date(inicio).toISOString(), inicio - 25 * HORA), c.esCancelacionTardia(inicio, inicio - 23 * HORA)],
      ventana: c.VENTANA_CANCELACION_MS,
      version: c.VERSION_POLITICA_CANCELACION,
      textos: [c.textoPoliticaCancelacion('sena'), c.textoPoliticaCancelacion('total'), c.MENSAJE_CANCELACION_TARDIA],
      mensajes: [c.mensajeErrorTurno(c.CODIGO_CANCELACION_TARDIA, 'x'), c.mensajeErrorTurno(c.CODIGO_POLITICA_CANCELACION_REQUERIDA, 'x')],
    }))
  `)
  assert.deepEqual(r.bordes, [false, false, true, true, true, true], '24 h + 1 min and 24 h + 1 ms are on time; exactly 24 h and less are late')
  assert.deepEqual(r.formas, [false, true])
  assert.equal(r.ventana, 24 * 60 * 60 * 1000)
  assert.match(r.version, /^\d{4}-\d{2}-v\d+$/u)
  assert.equal(r.textos[0], 'La seña reserva tu turno. Si cancelás con 24 horas o menos de anticipación, la seña no es reembolsable.')
  assert.match(r.textos[1], /no se te devolverá ningún monto de lo abonado/u)
  assert.equal(r.textos[2], 'Este turno comienza dentro de las próximas 24 horas. Si cancelás ahora, la seña no será reembolsada. ¿Querés continuar?')
  assert.deepEqual(r.mensajes, [r.textos[2], r.textos[0]])
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
  assert.deepEqual(r.politica.slice(0, 3), ['buttons', 'Seña de tu turno. La seña reserva tu turno. Si cancelás con 24 horas o menos de anticipación, la seña no es reembolsable. ¿Aceptás y seguimos con el pago?', ['Aceptar y pagar', 'Volver']])
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
  assert.match(pagina, /data-politica-cancelacion[\s\S]{0,900}Al continuar aceptás que, si cancelás el turno con 24 horas o menos de anticipación, la seña no será reembolsable\./u)
  assert.match(pagina, /data-aceptar-politica[^>]*onClick=\{\(\) => void pagar\(turno, politica\.tramo, true\)\}[\s\S]{0,200}Aceptar y pagar[\s\S]{0,300}Volver/u)
  assert.match(pagina, /pagarTurno\(turno\.id, tramo, aceptaPolitica \? VERSION_POLITICA_CANCELACION : undefined\)/u)
  assert.match(pagina, /causa\.code === CODIGO_CANCELACION_TARDIA\) setPerdida\(turno\.id\)/u)
  assert.match(pagina, /data-cancelacion-tardia[\s\S]{0,400}\{MENSAJE_CANCELACION_TARDIA\}[\s\S]{0,500}data-confirmar-perdida[^>]*onClick=\{\(\) => void cancelar\(turno, true\)\}/u)
  // The Web never decides the 24 hours by itself.
  assert.doesNotMatch(pagina, /esCancelacionTardia|VENTANA_CANCELACION_MS|24 \* 60/u)
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
  assert.match(migracion, /CHECK \(NOT "tardia" OR "cancelada_por" = 'cliente'\)/u, 'the penalty is only ever the client\'s')
})
