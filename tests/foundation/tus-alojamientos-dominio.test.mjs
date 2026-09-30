import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AlojamientosService, ErrorAlojamiento } from '../../apps/api/src/tus/alojamientos/alojamientos-service.ts'

// Mock en memoria con semántica equivalente a Prisma para probar la lógica de dominio
function crearPrismaAlojamientosMock() {
  const tipos = [
    { id: 't-1', slug: 'hotel', nombre: 'Hotel', descripcion: 'Hotel completo', icono: 'hotel', orden: 1, activo: true },
    { id: 't-2', slug: 'cabana', nombre: 'Cabaña', descripcion: 'Cabaña natural', icono: 'home', orden: 2, activo: true },
    { id: 't-3', slug: 'motel', nombre: 'Motel', descripcion: 'Por horas o noche', icono: 'clock', orden: 3, activo: true },
  ]

  let alojamientos = [
    {
      id: 'aloj-1',
      propietarioId: null, // Admin fictitious accommodation
      tipoId: 't-1',
      tipo: tipos[0],
      nombre: 'Gran Hotel Central',
      slug: 'gran-hotel-central',
      descripcion: 'Excelente hotel céntrico',
      direccion: 'Av. San Martín 450',
      latitud: -34.6037,
      longitud: -58.3816,
      barrioId: 'barrio-centro',
      zonaId: 'zona-centro',
      barrio: { id: 'barrio-centro', nombre: 'Centro' },
      zona: { id: 'zona-centro', nombre: 'Zona Céntrica' },
      checkInHora: '14:00',
      checkOutHora: '10:00',
      politicas: 'No fumar en habitaciones',
      comodidades: ['wifi', 'piscina', 'desayuno'],
      estado: 'publicado',
      publicado: true,
      ratingPromedio: 4.8,
      ratingCantidad: 12,
      imagenes: [
        { id: 'img-g1', alojamientoId: 'aloj-1', url: 'https://cdn.tus.com.ar/hotel-fachada.jpg', alt: 'Fachada', categoria: 'fachada', orden: 0, esPrincipal: true },
        { id: 'img-g2', alojamientoId: 'aloj-1', url: 'https://cdn.tus.com.ar/hotel-piscina.jpg', alt: 'Piscina', categoria: 'piscina', orden: 1, esPrincipal: false },
      ],
      unidades: [
        {
          id: 'uni-101',
          alojamientoId: 'aloj-1',
          nombre: 'Habitación Suite King',
          descripcion: 'Cama King, jacuzzi',
          capacidadPersonas: 2,
          camasDetalle: '1 King',
          banosCantidad: 1,
          comodidades: ['jacuzzi', 'tv'],
          estado: 'activa',
          orden: 1,
          imagenes: [
            { id: 'img-u1', unidadId: 'uni-101', url: 'https://cdn.tus.com.ar/suite-cama.jpg', alt: 'Cama Suite', orden: 0, esPrincipal: true }
          ],
          tarifas: [
            { id: 'tar-1', unidadId: 'uni-101', modalidad: 'noche', duracionHoras: null, precio: 50000n, moneda: 'ARS', diasSemana: [0,1,2,3,4,5,6], minimoEstadia: 1, maximoEstadia: null, activa: true }
          ],
          reservas: [],
          bloqueos: []
        },
        {
          id: 'uni-102',
          alojamientoId: 'aloj-1',
          nombre: 'Habitación Standard',
          descripcion: 'Cama Doble, sin fotos propias',
          capacidadPersonas: 2,
          camasDetalle: '1 Doble',
          banosCantidad: 1,
          comodidades: ['tv'],
          estado: 'activa',
          orden: 2,
          imagenes: [], // SIN FOTOS PROPIAS -> DEBE USAR FALLBACK GENERAL
          tarifas: [
            { id: 'tar-2', unidadId: 'uni-102', modalidad: 'noche', duracionHoras: null, precio: 35000n, moneda: 'ARS', diasSemana: [0,1,2,3,4,5,6], minimoEstadia: 2, maximoEstadia: 10, activa: true }
          ],
          reservas: [],
          bloqueos: []
        }
      ]
    }
  ]

  let reservas = []
  let bloqueos = []
  let calificaciones = []

  const mockPrisma = {
    tipoAlojamiento: {
      findMany: async () => tipos.filter(t => t.activo),
    },
    alojamiento: {
      findMany: async (args) => {
        return alojamientos.filter(a => {
          if (args.where?.publicado && !a.publicado) return false
          if (args.where?.tipo?.slug && a.tipo.slug !== args.where.tipo.slug) return false
          if (args.where?.zonaId && a.zonaId !== args.where.zonaId) return false
          return true
        })
      },
      findFirst: async (args) => {
        const idOrSlug = args.where?.OR?.[0]?.id || args.where?.OR?.[1]?.slug
        return alojamientos.find(a => a.id === idOrSlug || a.slug === idOrSlug) || null
      },
      create: async ({ data }) => {
        const item = { ...data, tipo: tipos.find(t => t.id === data.tipoId), imagenes: [], unidades: [] }
        alojamientos.push(item)
        return item
      },
      update: async ({ where, data }) => {
        const item = alojamientos.find(a => a.id === where.id)
        if (item) Object.assign(item, data)
        return item
      }
    },
    unidadAlojamiento: {
      findUnique: async ({ where }) => {
        for (const a of alojamientos) {
          const u = a.unidades.find(u => u.id === where.id)
          if (u) return { ...u, alojamiento: a }
        }
        return null
      },
      create: async ({ data }) => {
        const a = alojamientos.find(al => al.id === data.alojamientoId)
        const unit = { ...data, imagenes: [], tarifas: [], reservas: [], bloqueos: [] }
        if (a) a.unidades.push(unit)
        return unit
      }
    },
    tarifaAlojamiento: {
      create: async ({ data }) => {
        for (const a of alojamientos) {
          const u = a.unidades.find(u => u.id === data.unidadId)
          if (u) {
            u.tarifas.push(data)
            return data
          }
        }
        return data
      }
    },
    imagenAlojamiento: {
      create: async ({ data }) => {
        const a = alojamientos.find(al => al.id === data.alojamientoId)
        if (a) a.imagenes.push(data)
        return data
      }
    },
    imagenUnidadAlojamiento: {
      create: async ({ data }) => {
        for (const a of alojamientos) {
          const u = a.unidades.find(u => u.id === data.unidadId)
          if (u) {
            u.imagenes.push(data)
            return data
          }
        }
        return data
      }
    },
    bloqueoUnidadAlojamiento: {
      create: async ({ data }) => {
        bloqueos.push(data)
        return data
      },
      findMany: async ({ where }) => {
        return bloqueos.filter(b => b.unidadId === where.unidadId)
      }
    },
    reservaAlojamiento: {
      create: async ({ data }) => {
        // Simular exclusion constraint
        const solapada = reservas.find(r =>
          r.unidadId === data.unidadId &&
          ['pending_payment', 'confirmed', 'checked_in'].includes(r.estado) &&
          !(data.fechaFin <= r.fechaInicio || data.fechaInicio >= r.fechaFin)
        )
        if (solapada) {
          const err = new Error('ex_reservas_alojamiento_sin_solapamiento 23P01')
          throw err
        }
        reservas.push(data)
        return data
      },
      findUnique: async ({ where }) => {
        const r = reservas.find(res => res.id === where.id)
        if (!r) return null
        let uFound = null
        for (const a of alojamientos) {
          const u = a.unidades.find(un => un.id === r.unidadId)
          if (u) {
            uFound = { ...u, alojamiento: a }
            break
          }
        }
        return { ...r, unidad: uFound, calificacion: calificaciones.find(c => c.reservaId === r.id) }
      },
      update: async ({ where, data }) => {
        const r = reservas.find(res => res.id === where.id)
        if (r) Object.assign(r, data)
        let uFound = null
        for (const a of alojamientos) {
          const u = a.unidades.find(un => un.id === r.unidadId)
          if (u) {
            uFound = { ...u, alojamiento: a }
            break
          }
        }
        return { ...r, unidad: uFound }
      },
      updateMany: async ({ where, data }) => {
        let count = 0
        const ahora = new Date()
        for (const r of reservas) {
          if (r.estado === where.estado && r.holdExpiracion < ahora) {
            Object.assign(r, data)
            count++
          }
        }
        return { count }
      },
      findMany: async ({ where }) => {
        return reservas.filter(r => r.alojamientoId === where.alojamientoId).map(r => {
          let uFound = null
          for (const a of alojamientos) {
            const u = a.unidades.find(un => un.id === r.unidadId)
            if (u) {
              uFound = { ...u, alojamiento: a }
              break
            }
          }
          return { ...r, unidad: uFound }
        })
      }
    },
    calificacionAlojamiento: {
      findMany: async ({ where }) => calificaciones.filter(c => c.alojamientoId === where.alojamientoId),
      create: async ({ data }) => {
        calificaciones.push(data)
        return data
      }
    },
    $transaction: async (fn) => fn(mockPrisma)
  }

  return { mockPrisma, alojamientos, reservas, bloqueos, calificaciones }
}

test('ALOJAMIENTOS: Catálogo de tipos de alojamiento', async () => {
  const { mockPrisma } = crearPrismaAlojamientosMock()
  const service = new AlojamientosService(mockPrisma)

  const tipos = await service.listarTipos()
  assert.equal(tipos.length, 3)
  assert.equal(tipos[0].slug, 'hotel')
})

test('ALOJAMIENTOS: Jerarquía de fotos por unidad con fallback a fotos generales', async () => {
  const { mockPrisma } = crearPrismaAlojamientosMock()
  const service = new AlojamientosService(mockPrisma)

  const detalle = await service.obtenerDetallePublico('gran-hotel-central')

  assert.equal(detalle.nombre, 'Gran Hotel Central')
  assert.equal(detalle.unidades.length, 2)

  // Unidad 1 (Suite) tiene foto propia
  const suite = detalle.unidades.find(u => u.id === 'uni-101')
  assert.equal(suite.imagenes.length, 1)
  assert.equal(suite.imagenes[0].esFotoGeneralFallback, false)
  assert.equal(suite.imagenes[0].url, 'https://cdn.tus.com.ar/suite-cama.jpg')

  // Unidad 2 (Standard) NO tiene foto propia -> DEBE usar fotos generales del alojamiento con flag fallback
  const standard = detalle.unidades.find(u => u.id === 'uni-102')
  assert.equal(standard.imagenes.length, 2)
  assert.equal(standard.imagenes[0].esFotoGeneralFallback, true)
  assert.equal(standard.imagenes[0].url, 'https://cdn.tus.com.ar/hotel-fachada.jpg')
})

test('ALOJAMIENTOS: Cálculo de tarifas y validación de estadía mínima', async () => {
  const { mockPrisma } = crearPrismaAlojamientosMock()
  const service = new AlojamientosService(mockPrisma)

  // Standard requiere mínimo 2 noches. Si se pide 1 noche, debe rechazar
  await assert.rejects(
    async () => {
      await service.crearHoldReserva({
        unidadId: 'uni-102',
        alojamientoId: 'aloj-1',
        clienteNombre: 'Huésped Test',
        fechaInicio: '2026-11-10T14:00:00.000Z',
        fechaFin: '2026-11-11T10:00:00.000Z', // 1 noche
      })
    },
    (err) => err instanceof ErrorAlojamiento && err.codigo === 'MIN_STAY_NOT_MET'
  )

  // Con 2 noches debe calcular exactamente $70.000 ($35.000 x 2)
  const hold = await service.crearHoldReserva({
    unidadId: 'uni-102',
    alojamientoId: 'aloj-1',
    clienteNombre: 'Huésped Test',
    fechaInicio: '2026-11-10T14:00:00.000Z',
    fechaFin: '2026-11-12T10:00:00.000Z', // 2 noches
  })

  assert.equal(hold.precioFinalSnapshot, 70000)
  assert.equal(hold.estado, 'pending_payment')
  assert.ok(hold.holdExpiracion)
})

test('ALOJAMIENTOS: Detección de solapamiento en hold', async () => {
  const { mockPrisma } = crearPrismaAlojamientosMock()
  const service = new AlojamientosService(mockPrisma)

  // Cliente 1 reserva Suite del 15 al 18
  await service.crearHoldReserva({
    unidadId: 'uni-101',
    alojamientoId: 'aloj-1',
    clienteNombre: 'Cliente 1',
    fechaInicio: '2026-11-15T14:00:00.000Z',
    fechaFin: '2026-11-18T10:00:00.000Z',
  })

  // Cliente 2 intenta reservar la misma suite del 16 al 19 -> debe lanzar SLOT_OCCUPIED (409)
  await assert.rejects(
    async () => {
      await service.crearHoldReserva({
        unidadId: 'uni-101',
        alojamientoId: 'aloj-1',
        clienteNombre: 'Cliente 2',
        fechaInicio: '2026-11-16T14:00:00.000Z',
        fechaFin: '2026-11-19T10:00:00.000Z',
      })
    },
    (err) => err instanceof ErrorAlojamiento && err.codigo === 'SLOT_OCCUPIED' && err.statusCode === 409
  )
})

test('ALOJAMIENTOS: Calificaciones únicamente para reservas completed', async () => {
  const { mockPrisma } = crearPrismaAlojamientosMock()
  const service = new AlojamientosService(mockPrisma)

  // Crear y confirmar reserva
  const hold = await service.crearHoldReserva({
    unidadId: 'uni-101',
    alojamientoId: 'aloj-1',
    clienteNombre: 'Huésped Calificador',
    fechaInicio: '2026-12-01T14:00:00.000Z',
    fechaFin: '2026-12-03T10:00:00.000Z',
  })

  await service.confirmarReserva({
    reservaId: hold.id,
    paymentId: 'pay-12345',
  })

  // Intentar calificar en confirmed -> debe fallar con NOT_COMPLETED
  await assert.rejects(
    async () => {
      await service.calificarAlojamiento({
        reservaId: hold.id,
        puntuacion: 5,
        comentario: 'Excelente estadía',
      })
    },
    (err) => err instanceof ErrorAlojamiento && err.codigo === 'NOT_COMPLETED'
  )

  // Pasar a completed
  await service.actualizarEstadoReserva(hold.id, 'completed')

  // Calificar en completed -> éxito
  await service.calificarAlojamiento({
    reservaId: hold.id,
    puntuacion: 5,
    comentario: 'Excelente estadía',
  })

  // Intentar calificar por segunda vez -> ALREADY_RATED
  await assert.rejects(
    async () => {
      await service.calificarAlojamiento({
        reservaId: hold.id,
        puntuacion: 4,
      })
    },
    (err) => err instanceof ErrorAlojamiento && err.codigo === 'ALREADY_RATED'
  )
})

test('ALOJAMIENTOS: Admin crea alojamiento ficticio para pruebas sin cuenta requerida', async () => {
  const { mockPrisma } = crearPrismaAlojamientosMock()
  const service = new AlojamientosService(mockPrisma)

  const nuevo = await service.crearAlojamiento({
    propietarioId: undefined, // Ficticio sin usuario
    tipoId: 't-2',
    nombre: 'Cabañas Las Sierras Test',
    slug: 'cabanas-las-sierras-test',
    direccion: 'Ruta 5 Km 80',
    latitud: -31.65,
    longitud: -64.42,
  })

  assert.ok(nuevo.id.startsWith('aloj-'))
  assert.equal(nuevo.slug, 'cabanas-las-sierras-test')

  // Agregar unidad
  const unidad = await service.crearUnidad({
    alojamientoId: nuevo.id,
    nombre: 'Cabaña 1 (4 personas)',
    capacidadPersonas: 4,
  })
  assert.ok(unidad.id.startsWith('uni-'))

  // Agregar tarifa por noche
  const tarifa = await service.crearTarifa({
    unidadId: unidad.id,
    modalidad: 'noche',
    precio: 45000,
  })
  assert.ok(tarifa.id.startsWith('tar-'))
})
