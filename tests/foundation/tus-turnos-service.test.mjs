import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  return JSON.parse(
    execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  )
}

test('TURNOS: disponibilidad y switches de atencion por prestador y por servicio', () => {
  const result = runTypeScriptScenario(`
    const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')

    // Mock prisma client in memory
    const perfiles = [
      {
        id: 'perf-1',
        tenantId: 'ten-1',
        prestadorId: 'pres-1',
        nombrePublico: 'Masajista Juan',
        visible: true,
        aceptaTurnos: true,
        aceptaSolicitudes: true,
        servicios: [
          { oficioId: 'masajes', turnosHabilitados: true, duracionMinutos: 60, bufferMinutos: 15, precioBase: 25000n },
          { oficioId: 'electricidad', turnosHabilitados: false, duracionMinutos: 60, bufferMinutos: 0, precioBase: null }
        ],
        tarifas: [
          { id: 'tar-30', oficioId: 'masajes', nombre: '30 minutos', duracionMinutos: 30, precio: 15000n, activo: true, orden: 0 },
          { id: 'tar-60', oficioId: 'masajes', nombre: '60 minutos', duracionMinutos: 60, precio: 25000n, activo: true, orden: 1 },
          { id: 'tar-90', oficioId: 'masajes', nombre: '90 minutos', duracionMinutos: 90, precio: 33000n, activo: true, orden: 2 }
        ]
      },
      {
        id: 'perf-2',
        tenantId: 'ten-2',
        prestadorId: 'pres-2',
        nombrePublico: 'Plomero Pedro',
        visible: true,
        aceptaTurnos: false,
        aceptaSolicitudes: true,
        servicios: [
          { oficioId: 'plomeria', turnosHabilitados: false, duracionMinutos: 60, bufferMinutos: 0, precioBase: null }
        ],
        tarifas: []
      }
    ]

    const calendarios = [
      {
        id: 'cal-1',
        tenantId: 'ten-1',
        prestadorId: 'pres-1',
        granularidadMinutos: 15,
        bufferMinutos: 0
      }
    ]

    const reglas = [
      // Lunes a viernes 09:00 a 12:00
      { calendarioId: 'cal-1', diaSemana: 1, horaInicio: '09:00', horaFin: '12:00' },
      { calendarioId: 'cal-1', diaSemana: 2, horaInicio: '09:00', horaFin: '12:00' },
      { calendarioId: 'cal-1', diaSemana: 3, horaInicio: '09:00', horaFin: '12:00' },
      { calendarioId: 'cal-1', diaSemana: 4, horaInicio: '09:00', horaFin: '12:00' },
      { calendarioId: 'cal-1', diaSemana: 5, horaInicio: '09:00', horaFin: '12:00' }
    ]

    const reservas = []

    const mockPrisma = {
      perfilPublicoPrestador: {
        findFirst: async ({ where, include }) => {
          const id = where.OR?.[0]?.id || where.id || where.tenantId
          const p = perfiles.find(p => p.id === id || p.prestadorId === id || p.tenantId === id)
          if (!p) return null
          const servicios = include?.servicios?.where?.oficioId
            ? p.servicios.filter(s => s.oficioId === include.servicios.where.oficioId)
            : p.servicios
          const tarifas = include?.tarifas?.where?.oficioId
            ? p.tarifas.filter(t => t.oficioId === include.tarifas.where.oficioId)
            : p.tarifas
          return { ...p, servicios, tarifas }
        }
      },
      calendario: {
        findUnique: async () => calendarios[0],
        create: async ({ data }) => { calendarios.push(data); return data }
      },
      reglaCalendario: {
        findMany: async ({ where }) => reglas.filter(r => r.calendarioId === where.calendarioId && r.diaSemana === where.diaSemana)
      },
      excepcionCalendario: {
        findMany: async () => []
      },
      reserva: {
        findMany: async () => reservas
      }
    }

    const servicio = new ServicioTurnos(mockPrisma)

    // 1. Prestador con turnos apagados
    const r2 = await servicio.disponibilidadPublica({
      prestadorId: 'perf-2',
      oficioId: 'plomeria',
      fecha: '2026-10-19' // Lunes
    })

    // 2. Prestador con turnos prendidos pero servicio con turnos apagados
    const rElectr = await servicio.disponibilidadPublica({
      prestadorId: 'perf-1',
      oficioId: 'electricidad',
      fecha: '2026-10-19'
    })

    // 3. Prestador y servicio con turnos prendidos y tarifas
    const rMasajes = await servicio.disponibilidadPublica({
      prestadorId: 'perf-1',
      oficioId: 'masajes',
      fecha: '2026-10-19' // Lunes
    })

    console.log(JSON.stringify({
      turnosApagadosPrestador: r2.slots.length === 0 && !!r2.mensaje,
      turnosApagadosServicio: rElectr.slots.length === 0 && !!rElectr.mensaje,
      masajesSlots: rMasajes.slots.length,
      tarifasCount: rMasajes.tarifas.length,
      primeraTarifa: rMasajes.tarifas[0]
    }))
  `)

  assert.equal(result.turnosApagadosPrestador, true)
  assert.equal(result.turnosApagadosServicio, true)
  assert.ok(result.masajesSlots > 0, 'Debe haber slots disponibles')
  assert.equal(result.tarifasCount, 3)
  assert.equal(result.primeraTarifa.nombre, '30 minutos')
  assert.equal(result.primeraTarifa.precio, 15000)
})

test('TURNOS: snapshot historico de precio y auditoria admin obligatoria', () => {
  const result = runTypeScriptScenario(`
    const { ServicioTurnos } = await import('./apps/api/src/tus/calendar/turnos-service.ts')

    const perfil = {
      id: 'perf-1',
      tenantId: 'ten-1',
      prestadorId: 'pres-1',
      nombrePublico: 'Masajista Juan',
      visible: true,
      aceptaTurnos: true,
      aceptaSolicitudes: true,
      servicios: [{ oficioId: 'masajes', turnosHabilitados: true, duracionMinutos: 60, precioBase: 25000n }],
      tarifas: [
        { id: 'tar-60', oficioId: 'masajes', nombre: '60 minutos', duracionMinutos: 60, precio: 25000n, activo: true }
      ]
    }

    const calendario = { id: 'cal-1', tenantId: 'ten-1', prestadorId: 'pres-1' }
    let reservaCreada = null

    const mockPrisma = {
      perfilPublicoPrestador: {
        findFirst: async () => perfil
      },
      calendario: {
        findUnique: async () => calendario
      },
      // A booking is only accepted inside the real availability (TURNOS-ADMIN-01), so the agenda
      // of the provider is part of the fixture: Monday 9 to 18, no blocks, no other turnos.
      reglaCalendario: {
        findMany: async () => [{ diaSemana: 1, horaInicio: '09:00', horaFin: '18:00' }]
      },
      // A booking runs with the agenda locked (transaction + SELECT ... FOR UPDATE on its calendar).
      $transaction: async (operation) => operation(mockPrisma),
      $queryRaw: async () => [{ ok: 1 }],
      excepcionCalendario: {
        findMany: async () => []
      },
      oficioServicio: {
        findMany: async () => []
      },
      reserva: {
        findMany: async () => [],
        // Overdue requests are expired when the agenda is locked: none here.
        updateMany: async () => ({ count: 0 }),
        findUnique: async () => reservaCreada,
        create: async ({ data }) => {
          reservaCreada = { ...data, id: data.id }
          return reservaCreada
        },
        findFirst: async () => reservaCreada,
        update: async ({ data }) => {
          reservaCreada = { ...reservaCreada, ...data }
          return reservaCreada
        }
      }
    }

    const servicio = new ServicioTurnos(mockPrisma)

    // Crear reserva con snapshot
    const turno = await servicio.reservarTurno({
      prestadorId: 'perf-1',
      oficioId: 'masajes',
      tarifaId: 'tar-60',
      inicio: '2026-10-19T10:00:00.000-03:00',
      clienteNombre: 'Carlos Gomez',
      clienteTelefono: '3794112233'
    })

    // Intentar modificar precio sin motivo -> Debe fallar
    let falloSinMotivo = false
    try {
      await servicio.adminModificarPrecio({
        reservaId: turno.reservaId,
        nuevoPrecio: 20000n,
        motivo: '',
        adminId: 'admin-1'
      })
    } catch (e) {
      falloSinMotivo = e.code === 'MOTIVO_REQUIRED'
    }

    // Modificar precio con motivo valido
    const turnoModificado = await servicio.adminModificarPrecio({
      reservaId: turno.reservaId,
      nuevoPrecio: 20000n,
      motivo: 'Descuento especial autorizado por promocion apertura',
      adminId: 'admin-1'
    })

    console.log(JSON.stringify({
      precioListaOriginal: turno.precioLista,
      precioFinalOriginal: turno.precioFinal,
      falloSinMotivo,
      precioFinalNuevo: turnoModificado.precioFinal,
      motivo: turnoModificado.motivoModificacionPrecio,
      adminId: turnoModificado.modificadoPorAdminId
    }))
  `)

  assert.equal(result.precioListaOriginal, 25000)
  assert.equal(result.precioFinalOriginal, 25000)
  assert.equal(result.falloSinMotivo, true)
  assert.equal(result.precioFinalNuevo, 20000)
  assert.equal(result.motivo, 'Descuento especial autorizado por promocion apertura')
  assert.equal(result.adminId, 'admin-1')
})
