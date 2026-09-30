import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const express = require('../../apps/api/node_modules/express')
import { crearRutasAlojamientos } from '../../apps/api/src/tus/alojamientos/alojamientos-routes.ts'

function crearAppTest(mockPrisma) {
  const app = express()
  app.use(express.json())
  app.use('/api/alojamientos', crearRutasAlojamientos(mockPrisma))
  return app
}

function crearMockPrisma() {
  const tipos = [
    { id: 't-1', slug: 'hotel', nombre: 'Hotel', descripcion: 'Hotel completo', icono: 'hotel', orden: 1, activo: true },
    { id: 't-2', slug: 'cabana', nombre: 'Cabaña', descripcion: 'Cabañas en la naturaleza', icono: 'home', orden: 2, activo: true },
  ]

  const alojamientos = [
    {
      id: 'aloj-test-1',
      propietarioId: null,
      tipoId: 't-1',
      tipo: tipos[0],
      nombre: 'Hotel Test Plaza',
      slug: 'hotel-test-plaza',
      descripcion: 'Hotel de prueba',
      direccion: 'Calle Falsa 123',
      latitud: -34.6,
      longitud: -58.4,
      barrioId: 'b-1',
      zonaId: 'z-1',
      barrio: { id: 'b-1', nombre: 'Palermo' },
      zona: { id: 'z-1', nombre: 'Norte' },
      checkInHora: '14:00',
      checkOutHora: '10:00',
      politicas: 'Sin humo',
      comodidades: ['wifi', 'estacionamiento'],
      estado: 'publicado',
      publicado: true,
      ratingPromedio: 4.5,
      ratingCantidad: 10,
      imagenes: [
        { id: 'img-1', alojamientoId: 'aloj-test-1', url: 'https://cdn.tus.com.ar/h1.jpg', alt: 'Fachada', categoria: 'fachada', orden: 0, esPrincipal: true }
      ],
      unidades: [
        {
          id: 'uni-1',
          alojamientoId: 'aloj-test-1',
          nombre: 'Habitación Doble',
          descripcion: 'Cama matrimonial',
          capacidadPersonas: 2,
          camasDetalle: '1 Doble',
          banosCantidad: 1,
          comodidades: ['tv', 'ac'],
          estado: 'activa',
          orden: 1,
          imagenes: [], // fallback to general photos
          tarifas: [
            { id: 'tar-1', unidadId: 'uni-1', modalidad: 'noche', duracionHoras: null, precio: 40000n, moneda: 'ARS', diasSemana: [0,1,2,3,4,5,6], minimoEstadia: 1, maximoEstadia: null, activa: true }
          ],
          reservas: [],
          bloqueos: []
        }
      ]
    }
  ]

  const reservas = []
  const calificaciones = []

  return {
    tipoAlojamiento: {
      findMany: async () => tipos,
    },
    alojamiento: {
      findMany: async () => alojamientos,
      findFirst: async ({ where }) => {
        const idOrSlug = where.OR?.[0]?.id || where.OR?.[1]?.slug
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
          const u = a.unidades.find(un => un.id === where.id)
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
      create: async ({ data }) => data
    },
    imagenAlojamiento: {
      create: async ({ data }) => data
    },
    imagenUnidadAlojamiento: {
      create: async ({ data }) => data
    },
    bloqueoUnidadAlojamiento: {
      create: async ({ data }) => data,
      findMany: async () => []
    },
    reservaAlojamiento: {
      create: async ({ data }) => {
        reservas.push(data)
        return data
      },
      findUnique: async ({ where }) => {
        const r = reservas.find(res => res.id === where.id)
        if (!r) return null
        const u = alojamientos[0].unidades[0]
        return { ...r, unidad: { ...u, alojamiento: alojamientos[0] }, calificacion: calificaciones.find(c => c.reservaId === r.id) }
      },
      update: async ({ where, data }) => {
        const r = reservas.find(res => res.id === where.id)
        if (r) Object.assign(r, data)
        const u = alojamientos[0].unidades[0]
        return { ...r, unidad: { ...u, alojamiento: alojamientos[0] } }
      }
    },
    calificacionAlojamiento: {
      create: async ({ data }) => {
        calificaciones.push(data)
        return data
      },
      findMany: async () => calificaciones
    },
    $transaction: async (fn) => fn(this)
  }
}

test('HTTP ALOJAMIENTOS: Catálogo de tipos responde 200 con lista', async () => {
  const mockPrisma = crearMockPrisma()
  const app = crearAppTest(mockPrisma)
  const server = app.listen(0)
  const port = server.address().port

  try {
    const res = await fetch(`http://localhost:${port}/api/alojamientos/tipos`)
    assert.equal(res.status, 200)
    const json = await res.json()
    assert.equal(json.items.length, 2)
    assert.equal(json.items[0].slug, 'hotel')
  } finally {
    server.close()
  }
})

test('HTTP ALOJAMIENTOS: Flujo completo de Hold y Checkout Sandbox', async () => {
  const mockPrisma = crearMockPrisma()
  const app = crearAppTest(mockPrisma)
  const server = app.listen(0)
  const port = server.address().port

  try {
    // 1. Crear hold
    const holdRes = await fetch(`http://localhost:${port}/api/alojamientos/reservas/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unidadId: 'uni-1',
        alojamientoId: 'aloj-test-1',
        clienteNombre: 'Juan Perez',
        clienteEmail: 'juan@test.com',
        fechaInicio: '2026-11-20T14:00:00.000Z',
        fechaFin: '2026-11-22T10:00:00.000Z',
      })
    })

    assert.equal(holdRes.status, 201)
    const hold = await holdRes.json()
    assert.equal(hold.estado, 'pending_payment')
    assert.equal(hold.precioFinalSnapshot, 80000) // 2 noches x $40.000

    // 2. Obtener preferencia de checkout
    const prefRes = await fetch(`http://localhost:${port}/api/alojamientos/reservas/${hold.id}/checkout-preference`, {
      method: 'POST'
    })
    assert.equal(prefRes.status, 200)
    const pref = await prefRes.json()
    assert.ok(pref.preferenceId)
    assert.ok(pref.initPoint)

    // 3. Simular pago
    const simRes = await fetch(`http://localhost:${port}/api/alojamientos/reservas/${hold.id}/simular-pago`, {
      method: 'POST'
    })
    assert.equal(simRes.status, 200)
    const sim = await simRes.json()
    assert.equal(sim.ok, true)
    assert.equal(sim.reserva.estado, 'confirmed')
  } finally {
    server.close()
  }
})
