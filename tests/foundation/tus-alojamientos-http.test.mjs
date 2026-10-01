import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const express = require('../../apps/api/node_modules/express')
import { crearRutasAlojamientos } from '../../apps/api/src/tus/alojamientos/alojamientos-routes.ts'

const ADMIN = 'tus:providers:admin'

// Sesiones de prueba: el router solo conoce el contrato TusSessionResolverPort.
const SESIONES = {
  'tok-admin': { subjectId: 'acct-admin', tenantId: 'tenant-admin', roles: ['owner'], permissions: ['tus:marketplace:read', ADMIN] },
  'tok-owner-a': { subjectId: 'acct-owner-a', tenantId: 'tenant-a', roles: ['owner'], permissions: ['tus:marketplace:read'] },
  'tok-owner-b': { subjectId: 'acct-owner-b', tenantId: 'tenant-b', roles: ['owner'], permissions: ['tus:marketplace:read'] },
  'tok-cliente': { subjectId: 'acct-cliente', tenantId: 'tenant-c', roles: ['owner'], permissions: ['tus:marketplace:read'] },
  'tok-cliente-2': { subjectId: 'acct-cliente-2', tenantId: 'tenant-d', roles: ['owner'], permissions: ['tus:marketplace:read'] },
}

const sessions = {
  resolve: async (accessToken, correlationId) => {
    const sesion = SESIONES[accessToken]
    return sesion ? { ...sesion, sessionId: `ses-${accessToken}`, correlationId } : null
  },
}

function crearAppTest(mockPrisma, opciones = {}) {
  const app = express()
  app.use(express.json())
  app.use('/api/alojamientos', crearRutasAlojamientos(mockPrisma, { sessions, ...opciones }))
  return app
}

function unidad(id, alojamientoId) {
  return {
    id,
    alojamientoId,
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
      { id: `tar-${id}`, unidadId: id, modalidad: 'noche', duracionHoras: null, precio: 40000n, moneda: 'ARS', diasSemana: [0,1,2,3,4,5,6], minimoEstadia: 1, maximoEstadia: null, activa: true }
    ],
    reservas: [],
    bloqueos: []
  }
}

function crearMockPrisma() {
  const tipos = [
    { id: 't-1', slug: 'hotel', nombre: 'Hotel', descripcion: 'Hotel completo', icono: 'hotel', orden: 1, activo: true },
    { id: 't-2', slug: 'cabana', nombre: 'Cabaña', descripcion: 'Cabañas en la naturaleza', icono: 'home', orden: 2, activo: true },
  ]

  const alojamiento = (id, propietarioId, slug, unidadId) => ({
    id,
    propietarioId,
    tipoId: 't-1',
    tipo: tipos[0],
    nombre: `Hotel ${slug}`,
    slug,
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
      { id: `img-${id}`, alojamientoId: id, url: 'https://cdn.tus.com.ar/h1.jpg', alt: 'Fachada', categoria: 'fachada', orden: 0, esPrincipal: true }
    ],
    unidades: [unidad(unidadId, id)],
  })

  // Un alojamiento de cada propietario: A no debe poder operar sobre el de B.
  const alojamientos = [
    alojamiento('aloj-test-1', 'acct-owner-a', 'hotel-test-plaza', 'uni-1'),
    alojamiento('aloj-test-2', 'acct-owner-b', 'hotel-test-centro', 'uni-2'),
  ]

  const reservas = []
  const calificaciones = []
  const bloqueos = []
  const tarifas = []
  const imagenes = []

  const unidadPorId = (id) => {
    for (const a of alojamientos) {
      const u = a.unidades.find((un) => un.id === id)
      if (u) return { ...u, alojamiento: a }
    }
    return null
  }
  const reservaCompleta = (r) => {
    const a = alojamientos.find((al) => al.id === r.alojamientoId)
    return { ...r, alojamiento: a, unidad: unidadPorId(r.unidadId), calificacion: calificaciones.find((c) => c.reservaId === r.id) ?? null }
  }

  const db = {
    tipoAlojamiento: {
      findMany: async () => tipos,
    },
    alojamiento: {
      findMany: async () => alojamientos,
      findFirst: async ({ where }) => {
        const idOrSlug = where.OR?.[0]?.id || where.OR?.[1]?.slug
        return alojamientos.find(a => a.id === idOrSlug || a.slug === idOrSlug) || null
      },
      findUnique: async ({ where }) => alojamientos.find((a) => a.id === where.id) ?? null,
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
      findUnique: async ({ where }) => unidadPorId(where.id),
      create: async ({ data }) => {
        const a = alojamientos.find(al => al.id === data.alojamientoId)
        const unit = { ...data, imagenes: [], tarifas: [], reservas: [], bloqueos: [] }
        if (a) a.unidades.push(unit)
        return unit
      }
    },
    tarifaAlojamiento: {
      create: async ({ data }) => { tarifas.push(data); return data }
    },
    imagenAlojamiento: {
      create: async ({ data }) => { imagenes.push(data); return data }
    },
    imagenUnidadAlojamiento: {
      create: async ({ data }) => { imagenes.push(data); return data }
    },
    bloqueoUnidadAlojamiento: {
      create: async ({ data }) => { bloqueos.push(data); return data },
      findMany: async () => []
    },
    reservaAlojamiento: {
      create: async ({ data }) => {
        reservas.push(data)
        return data
      },
      findUnique: async ({ where }) => {
        const r = reservas.find(res => res.id === where.id)
        return r ? reservaCompleta(r) : null
      },
      findMany: async ({ where }) => reservas.filter((r) => r.alojamientoId === where.alojamientoId).map(reservaCompleta),
      update: async ({ where, data }) => {
        const r = reservas.find(res => res.id === where.id)
        if (r) Object.assign(r, data)
        return reservaCompleta(r)
      },
      // Conditional update: by id and/or unit, by state (one or a list) and by expired hold.
      updateMany: async ({ where, data }) => {
        let count = 0
        const estados = typeof where.estado === 'string' ? [where.estado] : where.estado?.in
        for (const r of reservas) {
          if (where.id !== undefined && r.id !== where.id) continue
          if (where.unidadId !== undefined && r.unidadId !== where.unidadId) continue
          if (estados && !estados.includes(r.estado)) continue
          if (where.holdExpiracion?.lt && !(r.holdExpiracion && r.holdExpiracion < where.holdExpiracion.lt)) continue
          Object.assign(r, data)
          count++
        }
        return { count }
      }
    },
    calificacionAlojamiento: {
      create: async ({ data }) => {
        calificaciones.push(data)
        return data
      },
      findMany: async () => calificaciones
    },
  }
  db.$transaction = async (fn) => fn(db)
  // SELECT ... FOR UPDATE (row locks): nothing to serialize in a single-threaded double.
  db.$queryRaw = async () => [{ ok: 1 }]
  return { db, alojamientos, reservas, calificaciones, bloqueos, tarifas, imagenes }
}

async function conServidor(app, fn) {
  const server = app.listen(0)
  try {
    return await fn(`http://localhost:${server.address().port}/api/alojamientos`)
  } finally {
    server.close()
  }
}

const cabeceras = (token) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}`, 'X-Correlation-Id': `corr-${token}` } : {}),
})

const pedir = (base, method, path, token, body) =>
  fetch(`${base}${path}`, { method, headers: cabeceras(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

const HOLD = {
  unidadId: 'uni-1',
  alojamientoId: 'aloj-test-1',
  clienteNombre: 'Juan Perez',
  clienteEmail: 'juan@test.com',
  fechaInicio: '2026-11-20T14:00:00.000Z',
  fechaFin: '2026-11-22T10:00:00.000Z',
}

const crearHold = async (base, token, extra = {}) => {
  const res = await pedir(base, 'POST', '/reservas/hold', token, { ...HOLD, ...extra })
  assert.equal(res.status, 201)
  return res.json()
}

// Rutas de gestión (admin o propietario). El router no define rutas DELETE ni PUT.
const RUTAS_GESTION = [
  ['GET', '/aloj-test-1/reservas'],
  ['POST', '/', { tipoId: 't-1', nombre: 'Nuevo', slug: 'nuevo', direccion: 'Calle 1', latitud: -27.4, longitud: -58.8 }],
  ['POST', '/aloj-test-1/unidades', { nombre: 'Suite' }],
  ['POST', '/unidades/uni-1/tarifas', { precio: 50000 }],
  ['POST', '/aloj-test-1/imagenes', { url: 'https://cdn.tus.com.ar/x.jpg' }],
  ['POST', '/unidades/uni-1/imagenes', { url: 'https://cdn.tus.com.ar/y.jpg' }],
  ['POST', '/unidades/uni-1/bloquear', { fechaInicio: '2026-12-01T00:00:00.000Z', fechaFin: '2026-12-02T00:00:00.000Z', motivo: 'Mantenimiento' }],
  ['PATCH', '/reservas/res-cualquiera/estado', { estado: 'cancelled' }],
]

test('HTTP ALOJAMIENTOS: Catálogo de tipos responde 200 con lista', async () => {
  const { db } = crearMockPrisma()
  await conServidor(crearAppTest(db), async (base) => {
    const res = await fetch(`${base}/tipos`)
    assert.equal(res.status, 200)
    const json = await res.json()
    assert.equal(json.items.length, 2)
    assert.equal(json.items[0].slug, 'hotel')
  })
})

test('HTTP ALOJAMIENTOS: búsqueda y detalle siguen siendo públicos', async () => {
  const { db } = crearMockPrisma()
  await conServidor(crearAppTest(db), async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 200)
    assert.equal((await fetch(`${base}/hotel-test-plaza`)).status, 200)
  })
})

test('HTTP ALOJAMIENTOS: Flujo completo de Hold y Checkout Sandbox (pago simulado habilitado: dev/test)', async () => {
  const { db } = crearMockPrisma()
  await conServidor(crearAppTest(db, { pagoSimuladoHabilitado: true }), async (base) => {
    // 1. Crear hold
    const hold = await crearHold(base)
    assert.equal(hold.estado, 'pending_payment')
    assert.equal(hold.precioFinalSnapshot, 80000) // 2 noches x $40.000

    // 2. Obtener preferencia de checkout
    const prefRes = await pedir(base, 'POST', `/reservas/${hold.id}/checkout-preference`)
    assert.equal(prefRes.status, 200)
    const pref = await prefRes.json()
    assert.ok(pref.preferenceId)
    assert.ok(pref.initPoint)

    // 3. Simular pago
    const simRes = await pedir(base, 'POST', `/reservas/${hold.id}/simular-pago`)
    assert.equal(simRes.status, 200)
    const sim = await simRes.json()
    assert.equal(sim.ok, true)
    assert.equal(sim.reserva.estado, 'confirmed')
  })
})

test('SEGURIDAD ALOJAMIENTOS: sin sesión, toda ruta de gestión responde 401 y no escribe nada', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    for (const [method, path, body] of RUTAS_GESTION) {
      const res = await pedir(base, method, path, null, body)
      assert.equal(res.status, 401, `${method} ${path}`)
      assert.equal((await res.json()).error.code, 'UNAUTHORIZED')
    }
    const calificar = await pedir(base, 'POST', '/calificar', null, { reservaId: 'x', puntuacion: 5 })
    assert.equal(calificar.status, 401)

    // Un token válido sin X-Correlation-Id no resuelve sesión (mismo contrato que el resto de TUS).
    const sinCorrelacion = await fetch(`${base}/aloj-test-1/reservas`, { headers: { Authorization: 'Bearer tok-admin' } })
    assert.equal(sinCorrelacion.status, 401)
    // Un token desconocido tampoco.
    assert.equal((await pedir(base, 'GET', '/aloj-test-1/reservas', 'tok-inexistente')).status, 401)
  })
  assert.equal(mock.alojamientos.length, 2)
  assert.equal(mock.alojamientos[0].unidades.length, 1)
  assert.deepEqual([mock.tarifas.length, mock.imagenes.length, mock.bloqueos.length, mock.calificaciones.length], [0, 0, 0, 0])
})

test('SEGURIDAD ALOJAMIENTOS: el admin de plataforma administra cualquier alojamiento', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    assert.equal((await pedir(base, 'GET', '/aloj-test-1/reservas', 'tok-admin')).status, 200)
    assert.equal((await pedir(base, 'GET', '/aloj-test-2/reservas', 'tok-admin')).status, 200)
    assert.equal((await pedir(base, 'POST', '/aloj-test-2/unidades', 'tok-admin', { nombre: 'Suite' })).status, 201)
    assert.equal((await pedir(base, 'POST', '/unidades/uni-2/tarifas', 'tok-admin', { precio: 50000 })).status, 201)

    // Alta: solo admin, que además decide a qué cuenta pertenece.
    const alta = await pedir(base, 'POST', '/', 'tok-admin', { tipoId: 't-1', nombre: 'Nuevo', slug: 'nuevo', direccion: 'Calle 1', latitud: -27.4, longitud: -58.8, propietarioId: 'acct-owner-b' })
    assert.equal(alta.status, 201)
    assert.equal(mock.alojamientos.at(-1).propietarioId, 'acct-owner-b')

    // Para el admin, un recurso inexistente es 404.
    assert.equal((await pedir(base, 'GET', '/aloj-no-existe/reservas', 'tok-admin')).status, 404)
  })
})

test('SEGURIDAD ALOJAMIENTOS: el propietario opera sobre su alojamiento', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    const hold = await crearHold(base)
    const reservas = await pedir(base, 'GET', '/aloj-test-1/reservas', 'tok-owner-a')
    assert.equal(reservas.status, 200)
    assert.equal(reservas.headers.get('cache-control'), 'no-store')
    assert.equal((await reservas.json()).items.length, 1)

    assert.equal((await pedir(base, 'POST', '/aloj-test-1/unidades', 'tok-owner-a', { nombre: 'Suite' })).status, 201)
    assert.equal((await pedir(base, 'POST', '/unidades/uni-1/tarifas', 'tok-owner-a', { precio: 50000 })).status, 201)
    assert.equal((await pedir(base, 'POST', '/aloj-test-1/imagenes', 'tok-owner-a', { url: 'https://cdn.tus.com.ar/x.jpg' })).status, 201)
    assert.equal((await pedir(base, 'POST', '/unidades/uni-1/imagenes', 'tok-owner-a', { url: 'https://cdn.tus.com.ar/y.jpg' })).status, 201)

    const bloqueo = await pedir(base, 'POST', '/unidades/uni-1/bloquear', 'tok-owner-a', { fechaInicio: '2026-12-01T00:00:00.000Z', fechaFin: '2026-12-02T00:00:00.000Z', motivo: 'Mantenimiento' })
    assert.equal(bloqueo.status, 201)
    assert.equal(mock.bloqueos[0].creadoPorUsuarioId, 'acct-owner-a', 'el autor del bloqueo sale de la sesión')

    assert.equal((await pedir(base, 'PATCH', `/reservas/${hold.id}/estado`, 'tok-owner-a', { estado: 'cancelled' })).status, 200)
    assert.equal(mock.reservas[0].estado, 'cancelled')
  })
})

test('SEGURIDAD ALOJAMIENTOS: el propietario A no accede ni modifica el alojamiento de B', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    const holdDeB = await crearHold(base, null, { unidadId: 'uni-2', alojamientoId: 'aloj-test-2' })

    const intentos = [
      ['GET', '/aloj-test-2/reservas'],
      ['POST', '/aloj-test-2/unidades', { nombre: 'Suite' }],
      ['POST', '/unidades/uni-2/tarifas', { precio: 1 }],
      ['POST', '/aloj-test-2/imagenes', { url: 'https://cdn.tus.com.ar/x.jpg' }],
      ['POST', '/unidades/uni-2/imagenes', { url: 'https://cdn.tus.com.ar/y.jpg' }],
      ['POST', '/unidades/uni-2/bloquear', { fechaInicio: '2026-12-01T00:00:00.000Z', fechaFin: '2026-12-02T00:00:00.000Z', motivo: 'x' }],
      ['PATCH', `/reservas/${holdDeB.id}/estado`, { estado: 'cancelled' }],
    ]
    for (const [method, path, body] of intentos) {
      const res = await pedir(base, method, path, 'tok-owner-a', body)
      assert.equal(res.status, 403, `${method} ${path}`)
      assert.equal((await res.json()).error.code, 'FORBIDDEN')
    }

    // Un id inexistente responde igual que uno ajeno: no revela qué ids existen.
    assert.equal((await pedir(base, 'GET', '/aloj-no-existe/reservas', 'tok-owner-a')).status, 403)
    // Ser propietario no habilita el alta de alojamientos.
    assert.equal((await pedir(base, 'POST', '/', 'tok-owner-a', RUTAS_GESTION[1][2])).status, 403)
  })
  assert.equal(mock.alojamientos.length, 2)
  assert.equal(mock.alojamientos[1].unidades.length, 1)
  assert.equal(mock.reservas[0].estado, 'pending_payment', 'la reserva de B no cambió')
  assert.deepEqual([mock.tarifas.length, mock.imagenes.length, mock.bloqueos.length], [0, 0, 0])
})

test('SEGURIDAD ALOJAMIENTOS: un cliente no usa la API de propietario ni de admin', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    for (const [method, path, body] of RUTAS_GESTION) {
      const res = await pedir(base, method, path, 'tok-cliente', body)
      assert.equal(res.status, 403, `${method} ${path}`)
    }
  })
  assert.equal(mock.alojamientos.length, 2)
  assert.deepEqual([mock.tarifas.length, mock.imagenes.length, mock.bloqueos.length], [0, 0, 0])
})

test('SEGURIDAD ALOJAMIENTOS: el cliente de la reserva sale de la sesión, nunca del body', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    // Con sesión: aunque el body nombre a otra cuenta, la reserva es de quien está autenticado.
    const propia = await crearHold(base, 'tok-cliente', { clienteId: 'acct-cliente-2' })
    assert.equal(propia.clienteId, 'acct-cliente')
    assert.equal(propia.esInvitado, false)

    // Sin sesión: un clienteId del body no convierte la reserva en la de esa cuenta.
    const invitado = await crearHold(base, null, { clienteId: 'acct-cliente-2', fechaInicio: '2026-11-25T14:00:00.000Z', fechaFin: '2026-11-26T10:00:00.000Z' })
    assert.equal(invitado.clienteId, null)
    assert.equal(invitado.esInvitado, true)
  })
})

test('SEGURIDAD ALOJAMIENTOS: solo la cuenta titular califica su reserva', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    const hold = await crearHold(base, 'tok-cliente')
    const invitado = await crearHold(base, null, { fechaInicio: '2026-11-25T14:00:00.000Z', fechaFin: '2026-11-26T10:00:00.000Z' })
    for (const id of [hold.id, invitado.id]) {
      assert.equal((await pedir(base, 'PATCH', `/reservas/${id}/estado`, 'tok-admin', { estado: 'completed' })).status, 200)
    }

    // Otra cuenta, haciéndose pasar por la titular en el body.
    const suplantacion = await pedir(base, 'POST', '/calificar', 'tok-cliente-2', { reservaId: hold.id, puntuacion: 1, clienteId: 'acct-cliente' })
    assert.equal(suplantacion.status, 403)
    // Una reserva de invitado no tiene cuenta titular: nadie la califica por API.
    assert.equal((await pedir(base, 'POST', '/calificar', 'tok-cliente', { reservaId: invitado.id, puntuacion: 5 })).status, 403)
    // Una reserva inexistente responde igual.
    assert.equal((await pedir(base, 'POST', '/calificar', 'tok-cliente', { reservaId: 'res-no-existe', puntuacion: 5 })).status, 403)
    assert.equal(mock.calificaciones.length, 0)

    // La titular califica; el cliente registrado es el de la sesión aunque el body diga otra cosa.
    const propia = await pedir(base, 'POST', '/calificar', 'tok-cliente', { reservaId: hold.id, puntuacion: 5, clienteId: 'acct-cliente-2' })
    assert.equal(propia.status, 200)
    assert.equal(mock.calificaciones.length, 1)
    assert.equal(mock.calificaciones[0].clienteId, 'acct-cliente')
  })
})

test('SEGURIDAD ALOJAMIENTOS: la preferencia de checkout es de la cuenta titular', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    const hold = await crearHold(base, 'tok-cliente')
    const ruta = `/reservas/${hold.id}/checkout-preference`
    assert.equal((await pedir(base, 'POST', ruta)).status, 401)
    assert.equal((await pedir(base, 'POST', ruta, 'tok-cliente-2')).status, 403)
    assert.equal((await pedir(base, 'POST', ruta, 'tok-cliente')).status, 200)
    assert.equal((await pedir(base, 'POST', '/reservas/res-no-existe/checkout-preference')).status, 404)
  })
})

test('SEGURIDAD ALOJAMIENTOS: simular-pago está apagado salvo habilitación explícita', async () => {
  const mock = crearMockPrisma()
  // Sin la opción (producción): nadie confirma una reserva sin pago, tampoco un admin.
  await conServidor(crearAppTest(mock.db), async (base) => {
    const hold = await crearHold(base)
    for (const token of [null, 'tok-cliente', 'tok-admin']) {
      const res = await pedir(base, 'POST', `/reservas/${hold.id}/simular-pago`, token)
      assert.equal(res.status, 403)
      assert.equal((await res.json()).error.code, 'PAYMENT_SIMULATION_DISABLED')
    }
    assert.equal(mock.reservas[0].estado, 'pending_payment')
    assert.equal(mock.reservas[0].paymentId ?? null, null)
  })

  // Habilitado (dev/test): sigue exigiendo ser titular de la reserva.
  const dev = crearMockPrisma()
  await conServidor(crearAppTest(dev.db, { pagoSimuladoHabilitado: true }), async (base) => {
    const hold = await crearHold(base, 'tok-cliente')
    assert.equal((await pedir(base, 'POST', `/reservas/${hold.id}/simular-pago`)).status, 401)
    assert.equal((await pedir(base, 'POST', `/reservas/${hold.id}/simular-pago`, 'tok-cliente-2')).status, 403)
    assert.equal(dev.reservas[0].estado, 'pending_payment')
    assert.equal((await pedir(base, 'POST', `/reservas/${hold.id}/simular-pago`, 'tok-cliente')).status, 200)
    assert.equal(dev.reservas[0].estado, 'confirmed')
  })
})

test('SEGURIDAD ALOJAMIENTOS: el servidor monta el router con la sesión TUS y sin pago simulado en producción', () => {
  const server = readFileSync(new URL('../../apps/api/src/server.ts', import.meta.url), 'utf8')
  const montaje = server.slice(server.indexOf("app.use('/api/alojamientos'"), server.indexOf("app.use('/api/alojamientos'") + 400)
  assert.match(montaje, /sessions,/)
  // Lista de entornos permitidos (no "distinto de producción"): un NODE_ENV ausente lo deja apagado.
  assert.match(montaje, /pagoSimuladoHabilitado: process\.env\['NODE_ENV'\] === 'development' \|\| process\.env\['NODE_ENV'\] === 'test'/)
  assert.doesNotMatch(montaje, /!== 'production'/)
})

test('SEGURIDAD ALOJAMIENTOS: el cliente Web envía la sesión y X-Correlation-Id a la API', () => {
  const cliente = readFileSync(new URL('../../apps/web/src/features/alojamientos/alojamientos-client.ts', import.meta.url), 'utf8')
  assert.match(cliente, /fetchWithSession\(/)
  assert.match(cliente, /'X-Correlation-Id': crypto\.randomUUID\(\)/)
  assert.match(cliente, /resolveWebApiBaseUrl\(/)
  assert.doesNotMatch(cliente, /clienteId/, 'el cliente Web nunca envía un id de cliente')
})

test('SEGURIDAD ALOJAMIENTOS: los pagos en revisión solo los ve la administración de plataforma', async () => {
  const mock = crearMockPrisma()
  await conServidor(crearAppTest(mock.db), async (base) => {
    const ruta = '/reservas/pagos-en-revision'
    assert.equal((await pedir(base, 'GET', ruta, null)).status, 401)
    assert.equal((await pedir(base, 'GET', ruta, 'tok-cliente')).status, 403)
    const admin = await pedir(base, 'GET', ruta, 'tok-admin')
    assert.equal(admin.status, 200)
    assert.ok(Array.isArray((await admin.json()).items))
  })
})
