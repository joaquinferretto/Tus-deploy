import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ALOJAMIENTOS-AVISOS-01. The owner of a lodging hears of a reservation and of its cancellation.
// The real notifier with a fake email transport: nothing is sent anywhere.
test('ALOJAMIENTOS avisos: a confirmed reservation and its cancellation are told to the account of the owner (its own email, the guest, the dates, the people, the total to pay at the place); a hold that is not confirmed, a lodging with no owner or an inactive owner tell nobody; a notice never undoes a reservation and decides nothing of money', () => {
  const r = runTypeScriptScenario(`
    const { AvisosAlojamientosEmail } = await import('./apps/api/src/tus/alojamientos/alojamientos-avisos.ts')
    const enviados = []
    const transporte = { send: async (mensaje) => { enviados.push(mensaje) } }
    const reservas = new Map()
    const base = { clienteNombre: 'Ana Gómez', fechaInicio: new Date('2031-01-10T00:00:00.000Z'), fechaFin: new Date('2031-01-13T00:00:00.000Z'), cantidadPersonas: 2, precioFinalSnapshot: 150000n, moneda: 'ARS', unidad: { nombre: 'Cabaña 1' } }
    reservas.set('r-ok', { ...base, id: 'r-ok', estado: 'confirmed', alojamiento: { nombre: 'Cabañas del Río', propietarioId: 'cuenta-duenio' } })
    reservas.set('r-hold', { ...base, id: 'r-hold', estado: 'pending_payment', alojamiento: { nombre: 'Cabañas del Río', propietarioId: 'cuenta-duenio' } })
    reservas.set('r-cancelada', { ...base, id: 'r-cancelada', estado: 'cancelled', cantidadPersonas: 1, alojamiento: { nombre: 'Cabañas del Río', propietarioId: 'cuenta-duenio' } })
    reservas.set('r-sin-duenio', { ...base, id: 'r-sin-duenio', estado: 'confirmed', alojamiento: { nombre: 'Sin dueño', propietarioId: null } })
    reservas.set('r-inactivo', { ...base, id: 'r-inactivo', estado: 'confirmed', alojamiento: { nombre: 'Otro', propietarioId: 'cuenta-inactiva' } })
    const consultas = []
    const prisma = {
      reservaAlojamiento: { findUnique: async ({ where }) => reservas.get(where.id) ?? null },
      account: { findFirst: async ({ where }) => { consultas.push(where); return where.id === 'cuenta-duenio' && where.status === 'active' ? { user: { email: 'duenio@example.com' } } : null } },
    }
    const avisos = new AvisosAlojamientosEmail(prisma, transporte, 'https://tusservicios.shop/')
    await avisos.reservaRecibida('r-ok')
    await avisos.reservaRecibida('r-hold')
    await avisos.reservaRecibida('r-sin-duenio')
    await avisos.reservaRecibida('r-inactivo')
    await avisos.reservaRecibida('no-existe')
    await avisos.reservaCancelada('r-cancelada')
    await avisos.reservaCancelada('r-ok')
    const sinTransporte = AvisosAlojamientosEmail.desdeEnv(prisma, {})
    console.log(JSON.stringify({ enviados: enviados.map((m) => [m.to, m.subject, m.idempotencyKey, m.text]), soloActivas: consultas.every((w) => w.status === 'active'), sinTransporte: sinTransporte === null }))
  `)
  assert.equal(r.enviados.length, 2, 'one notice for the confirmed reservation and one for the cancelled one')
  const [recibida, cancelada] = r.enviados
  assert.deepEqual(recibida.slice(0, 3), ['duenio@example.com', 'Nueva reserva en Cabañas del Río', 'alojamiento-reserva/r-ok/propietario'])
  for (const texto of ['Ana Gómez reservó Cabaña 1 en Cabañas del Río.', 'Entrada: 10/01/2031. Salida: 13/01/2031. Personas: 2.', 'Total: $150.000, a pagar en el alojamiento. TUS no cobra esta reserva.', 'https://tusservicios.shop/propietario/alojamientos']) assert.ok(recibida[3].includes(texto), texto)
  assert.deepEqual(cancelada.slice(0, 3), ['duenio@example.com', 'Se canceló una reserva en Cabañas del Río', 'alojamiento-reserva-cancelada/r-cancelada/propietario'])
  assert.ok(cancelada[3].includes('Era del 10/01/2031 al 13/01/2031, para 1 persona. Esas fechas vuelven a estar disponibles.'))
  assert.equal(r.soloActivas, true, 'only an active account of the owner is written to')
  assert.equal(r.sinTransporte, true, 'no email transport configured: no notifier, the reservation works the same')
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const rutas = read('apps/api/src/tus/alojamientos/alojamientos-routes.ts')
  assert.match(rutas, /const reserva = await alojamientosService\.crearHoldReserva\(\{ \.\.\.entrada\.valor, clienteId: context\.subjectId, inmediata: true \}\)\n[\s\S]{0,120}void opciones\.avisos\?\.reservaRecibida\(reserva\.id\)\.catch\(\(\) => undefined\)\n\s+return res\.status\(201\)/u, 'told after the reservation exists; a failing notice never fails it')
  assert.match(rutas, /await gestion\.cancelarComoCliente\([^)]*\)\n\s+void opciones\.avisos\?\.reservaCancelada\(req\.params\['id'\]!\)\.catch\(\(\) => undefined\)/u)
  const avisos = read('apps/api/src/tus/alojamientos/alojamientos-avisos.ts')
  assert.doesNotMatch(avisos.replace(/^\s*\/\/.*$/gmu, ''), /clienteEmail|clienteTelefono|\.update\(|\.create\(|payment|refund/iu, 'the contact of the guest is not mailed, nothing is written and no money is touched')
})
