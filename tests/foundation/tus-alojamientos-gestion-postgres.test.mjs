import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ALOJAMIENTOS-GESTION-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL). Never a shared or production database. Real Prisma, real
// constraints and the real routes: an owner publishes its alojamiento, a guest searches, reserves,
// sees and cancels its reservation, and two guests never end up with the same dates.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

const SETUP = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
  const { crearRutasAlojamientos } = await import('./apps/api/src/tus/alojamientos/alojamientos-routes.ts')
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const run = 'al' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const cuentas = {}
  async function cuenta(tag, permisos = []) {
    const id = run + '-acc-' + tag
    await prisma.$executeRawUnsafe('INSERT INTO "User"(id, email, "normalizedEmail", "displayName", "updatedAt") VALUES ($1, $2, $2, $3, now())', run + '-u-' + tag, tag + '-' + run + '@t.invalid', 'Persona ' + tag)
    await prisma.tusTenant.create({ data: { id: run + '-t-' + tag, slug: run + '-t-' + tag, name: 'Tenant ' + tag, status: 'active', createdAt: new Date(), updatedAt: new Date() } })
    await prisma.$executeRawUnsafe('INSERT INTO "Account"(id, "userId", "tenantId", status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, now(), now())', id, run + '-u-' + tag, run + '-t-' + tag, 'active')
    cuentas['tok-' + tag] = { subjectId: id, sessionId: 's-' + tag, tenantId: run + '-t-' + tag, roles: [], permissions: permisos, correlationId: 'c' }
    return id
  }
  const app = express()
  app.use(express.json())
  app.use(express.raw({ type: 'application/octet-stream', limit: '6mb' }))
  app.use('/api/alojamientos', crearRutasAlojamientos(prisma, { sessions: { resolve: async (token) => cuentas[token] ?? null } }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = 'http://127.0.0.1:' + server.address().port + '/api/alojamientos'
  async function pedir(method, path, token, body) {
    const binario = Buffer.isBuffer(body)
    const response = await fetch(base + path, { method, headers: { 'x-correlation-id': 'c-1', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'content-type': binario ? 'application/octet-stream' : 'application/json' }) }, ...(body === undefined ? {} : { body: binario ? body : JSON.stringify(body) }) })
    const tipo = response.headers.get('content-type') ?? ''
    return { status: response.status, body: tipo.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()), tipo }
  }
  const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); return b }
  const pngChunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
  const png = (ancho, alto, extra = []) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', Buffer.concat([u32(ancho), u32(alto), Buffer.from([8, 2, 0, 0, 0])])), ...extra.map(([type, data]) => pngChunk(type, Buffer.from(data, 'utf8'))), pngChunk('IDAT', Buffer.alloc(600, 7)), pngChunk('IEND', Buffer.alloc(0))])
  const tipo = await prisma.tipoAlojamiento.findFirst({ where: { activo: true }, orderBy: { orden: 'asc' } })
  const barrio = await prisma.barrio.findFirst({ where: { activo: true, latitud: { not: null } }, orderBy: { orden: 'asc' } })
  // Calendar dates in the future (Argentina): day 0 is 30 days from today.
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const dia = (n) => new Date(Date.parse(hoy + 'T00:00:00.000Z') + (30 + n) * 86_400_000).toISOString().slice(0, 10)
  const FORM = { tipoId: tipo.id, nombre: 'Casa del Río ' + run, descripcion: 'Casa con patio y parrilla.', direccion: 'Calle Privada 1234', barrioId: barrio.id, checkInHora: '14:00', checkOutHora: '10:00', politicas: 'No se admiten fiestas.', comodidades: ['Wifi', 'Parrilla'], capacidadPersonas: 4, camasDetalle: '1 matrimonial, 2 simples', banosCantidad: 1, precioNoche: 50000 }
  const reserva = (unidadId, alojamientoId, desde, hasta, extra = {}) => ({ unidadId, alojamientoId, clienteNombre: 'Huésped', fechaInicio: dia(desde), fechaFin: dia(hasta), cantidadPersonas: 2, ...extra })
`
const FIN = `
      await new Promise((resolve) => server.close(resolve))
      await prisma.$disconnect()
`

test('ALOJAMIENTOS gestión PostgreSQL: an owner creates, edits and publishes its alojamiento with the account of the session; data and photos are validated; nobody manages what is not theirs; the public answers hide the owner and the exact address', { skip, timeout: 240_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      const ana = await cuenta('ana')
      await cuenta('beto')
      await cuenta('admin', ['tus:providers:admin'])
      // 1-2. create: valid, invalid, unknown and sensitive fields
      out.sinSesion = (await pedir('POST', '/mios', null, FORM)).status
      const invalidos = {}
      for (const [nombre, cambio] of Object.entries({ titulo: { nombre: 'a' }, precioCero: { precioNoche: 0 }, precioDecimal: { precioNoche: 10.5 }, precioTexto: { precioNoche: 'gratis' }, capacidad: { capacidadPersonas: 0 }, hora: { checkInHora: '25:00' }, tipo: { tipoId: 'no-existe' }, barrio: { barrioId: 'no-existe' }, propietario: { propietarioId: ana }, estado: { estado: 'publicado' }, publicado: { publicado: true }, slug: { slug: 'x-y-z' }, extra: { loQueSea: 1 } })) {
        const res = await pedir('POST', '/mios', 'tok-ana', { ...FORM, ...cambio })
        invalidos[nombre] = res.status + ':' + (res.body.error?.fields?.[0] ?? res.body.error?.code)
      }
      out.invalidos = invalidos
      const alta = await pedir('POST', '/mios', 'tok-ana', FORM)
      out.alta = alta.status
      const id = alta.body.id
      const fila = await prisma.alojamiento.findUnique({ where: { id }, include: { unidades: { include: { tarifas: true } } } })
      out.creado = { propietario: fila.propietarioId === ana, estado: fila.estado, publicado: fila.publicado, zona: fila.zonaId === barrio.zonaId, punto: fila.latitud === barrio.latitud, unidades: fila.unidades.length, capacidad: fila.unidades[0].capacidadPersonas, precio: Number(fila.unidades[0].tarifas[0].precio), moneda: fila.unidades[0].tarifas[0].moneda }
      const unidadId = fila.unidades[0].id
      // a draft is not public and cannot be reserved
      out.borradorEnBusqueda = (await pedir('GET', '/?q=' + encodeURIComponent(run), null)).body.items.length
      out.borradorReserva = (await pedir('POST', '/reservas', 'tok-beto', reserva(unidadId, id, 0, 2))).status
      // 3-4. edit own / someone else's
      const editado = await pedir('PUT', '/mios/' + id, 'tok-ana', { ...FORM, nombre: 'Casa del Río renovada ' + run, capacidadPersonas: 6, precioNoche: 60000 })
      out.editar = editado.status
      out.editarAjeno = (await pedir('PUT', '/mios/' + id, 'tok-beto', FORM)).status
      out.editarInvalido = (await pedir('PUT', '/mios/' + id, 'tok-ana', { ...FORM, precioNoche: -1 })).status
      const tras = await prisma.unidadAlojamiento.findUnique({ where: { id: unidadId }, include: { tarifas: { orderBy: { creadoEn: 'asc' } } } })
      out.editado = { capacidad: tras.capacidadPersonas, tarifas: tras.tarifas.map((t) => Number(t.precio) + ':' + t.activa) }
      // 5. publish / unpublish
      out.publicarAjeno = (await pedir('POST', '/' + id + '/publicacion', 'tok-beto', { publicado: true })).status
      out.publicarCuerpo = (await pedir('POST', '/' + id + '/publicacion', 'tok-ana', { publicado: 'si' })).status
      out.publicar = (await pedir('POST', '/' + id + '/publicacion', 'tok-ana', { publicado: true })).body
      const mios = await pedir('GET', '/mios', 'tok-ana')
      out.mios = mios.body.items.map((a) => ({ nombre: a.nombre.startsWith('Casa del Río renovada'), publicado: a.publicado, direccion: a.direccion, precio: a.unidades[0].precioNoche, puede: a.puedePublicarse }))
      out.miosDeOtro = (await pedir('GET', '/mios', 'tok-beto')).body.items.length
      out.miosSinSesion = (await pedir('GET', '/mios', null)).status
      // 19. photos: a real image, an invalid one, metadata removed, order, limit, ownership
      const subida = await pedir('POST', '/' + id + '/fotos', 'tok-ana', png(400, 300, [['tEXt', 'Location\\u0000-27.4,-58.8']]))
      out.foto = subida.status
      const segunda = await pedir('POST', '/' + id + '/fotos', 'tok-ana', png(500, 300))
      out.fotoAjena = (await pedir('POST', '/' + id + '/fotos', 'tok-beto', png(400, 300))).status
      out.fotoTexto = (await pedir('POST', '/' + id + '/fotos', 'tok-ana', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).status
      out.fotoRenombrada = (await pedir('POST', '/' + id + '/fotos', 'tok-ana', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200)]))).status
      out.fotoChica = (await pedir('POST', '/' + id + '/fotos', 'tok-ana', png(10, 10))).status
      out.fotoGrande = (await pedir('POST', '/' + id + '/fotos', 'tok-ana', Buffer.concat([png(400, 300), Buffer.alloc(2 * 1024 * 1024 + 10)]))).status
      out.fotoJson = (await pedir('POST', '/' + id + '/fotos', 'tok-ana', { url: 'https://example.com/a.png' })).status
      const servida = await pedir('GET', subida.body.url.replace('/api/alojamientos', ''), null)
      out.servida = { status: servida.status, tipo: servida.tipo, sinMetadata: !servida.body.includes('Location'), png: servida.body.subarray(1, 4).toString('latin1') }
      out.orden = (await pedir('PUT', '/' + id + '/imagenes/orden', 'tok-ana', { orden: [segunda.body.id, subida.body.id] })).status
      out.ordenIncompleto = (await pedir('PUT', '/' + id + '/imagenes/orden', 'tok-ana', { orden: [segunda.body.id] })).status
      out.ordenAjeno = (await pedir('PUT', '/' + id + '/imagenes/orden', 'tok-beto', { orden: [segunda.body.id, subida.body.id] })).status
      const galeria = await prisma.imagenAlojamiento.findMany({ where: { alojamientoId: id }, orderBy: { orden: 'asc' } })
      out.galeria = galeria.map((img) => (img.id === segunda.body.id ? 'segunda' : 'primera') + ':' + img.esPrincipal)
      out.quitarFotoAjena = (await pedir('DELETE', '/imagenes/' + segunda.body.id, 'tok-beto')).status
      out.quitarFoto = (await pedir('DELETE', '/imagenes/' + segunda.body.id, 'tok-ana')).status
      out.trasQuitar = (await prisma.imagenAlojamiento.findMany({ where: { alojamientoId: id } })).map((img) => img.esPrincipal)
      out.archivoHuerfano = await prisma.archivoImagenAlojamiento.count({ where: { imagenId: segunda.body.id } })
      for (let n = 0; n < 11; n += 1) await pedir('POST', '/' + id + '/fotos', 'tok-ana', png(200 + n, 200))
      out.fotoTrece = (await pedir('POST', '/' + id + '/fotos', 'tok-ana', png(300, 300))).body.error?.code
      // 21. privacy: the public answers never carry the owner, the address or the exact point
      const busqueda = await pedir('GET', '/?q=' + encodeURIComponent('renovada ' + run), null)
      const publico = busqueda.body.items[0]
      const detalle = (await pedir('GET', '/' + id, null)).body
      const metros = (a, b) => Math.hypot((a.latitud - b.latitud) * 111320, (a.longitud - b.longitud) * 111320 * Math.cos(a.latitud * Math.PI / 180))
      out.privacidad = { encontrados: busqueda.body.items.length, propietario: publico.propietarioId, direccion: publico.direccion, detallePropietario: detalle.propietarioId, detalleDireccion: detalle.direccion, textoSinDireccion: !JSON.stringify([busqueda.body, detalle]).includes('Calle Privada'), corrido: metros(publico, fila) > 100 && metros(publico, fila) < 500, estable: publico.latitud === detalle.latitud, zona: publico.barrioNombre === barrio.nombre }
      out.porDireccion = (await pedir('GET', '/?q=' + encodeURIComponent('Calle Privada 1234'), null)).body.items.length
      // unpublish: gone from the search, no reservations
      out.despublicar = (await pedir('POST', '/' + id + '/publicacion', 'tok-ana', { publicado: false })).body
      out.despublicadoEnBusqueda = (await pedir('GET', '/?q=' + encodeURIComponent(run), null)).body.items.length
      out.despublicadoReserva = (await pedir('POST', '/reservas', 'tok-beto', reserva(unidadId, id, 0, 2))).status
      // 22. a suspension by the administration is not lifted by the owner
      await prisma.alojamiento.update({ where: { id }, data: { estado: 'suspendido', publicado: false } })
      out.suspendidoPropietario = (await pedir('POST', '/' + id + '/publicacion', 'tok-ana', { publicado: true })).body.error?.code
      out.suspendidoAdmin = (await pedir('POST', '/' + id + '/publicacion', 'tok-admin', { publicado: true })).body.estado
      console.log(JSON.stringify(out))
    } finally {${FIN}    }
  `)
  assert.equal(r.sinSesion, 401)
  assert.deepEqual(r.invalidos, { titulo: '400:nombre', precioCero: '400:precioNoche', precioDecimal: '400:precioNoche', precioTexto: '400:precioNoche', capacidad: '400:capacidadPersonas', hora: '400:checkInHora', tipo: '400:BAD_REQUEST', barrio: '400:BAD_REQUEST', propietario: '400:propietarioId', estado: '400:estado', publicado: '400:publicado', slug: '400:slug', extra: '400:loQueSea' })
  assert.equal(r.alta, 201)
  assert.deepEqual(r.creado, { propietario: true, estado: 'borrador', publicado: false, zona: true, punto: true, unidades: 1, capacidad: 4, precio: 50000, moneda: 'ARS' })
  assert.equal(r.borradorEnBusqueda, 0, 'a draft is not in the search')
  assert.equal(r.borradorReserva, 404, 'a draft cannot be reserved')
  assert.deepEqual([r.editar, r.editarAjeno, r.editarInvalido], [200, 403, 400])
  assert.deepEqual(r.editado, { capacidad: 6, tarifas: ['50000:false', '60000:true'] }, 'a new price retires the previous rate, it does not rewrite it')
  assert.deepEqual([r.publicarAjeno, r.publicarCuerpo], [403, 400])
  assert.deepEqual(r.publicar, { estado: 'publicado', publicado: true })
  assert.deepEqual(r.mios, [{ nombre: true, publicado: true, direccion: 'Calle Privada 1234', precio: 60000, puede: true }])
  assert.equal(r.miosDeOtro, 0)
  assert.equal(r.miosSinSesion, 401)
  assert.equal(r.foto, 201)
  assert.deepEqual([r.fotoAjena, r.fotoTexto, r.fotoRenombrada, r.fotoChica, r.fotoGrande, r.fotoJson], [403, 415, 415, 422, 413, 415], 'the type is decided by the bytes, never by a name or a header')
  assert.deepEqual(r.servida, { status: 200, tipo: 'image/png', sinMetadata: true, png: 'PNG' })
  assert.deepEqual([r.orden, r.ordenIncompleto, r.ordenAjeno], [200, 400, 403])
  assert.deepEqual(r.galeria, ['segunda:true', 'primera:false'], 'the first photo of the order is the main one')
  assert.deepEqual([r.quitarFotoAjena, r.quitarFoto], [403, 200])
  assert.deepEqual(r.trasQuitar, [true], 'the next photo becomes the main one')
  assert.equal(r.archivoHuerfano, 0)
  assert.equal(r.fotoTrece, 'TOO_MANY_PHOTOS')
  assert.deepEqual(r.privacidad, { encontrados: 1, propietario: null, direccion: null, detallePropietario: null, detalleDireccion: null, textoSinDireccion: true, corrido: true, estable: true, zona: true })
  assert.equal(r.porDireccion, 0, 'the exact address is not a way to find an alojamiento')
  assert.deepEqual(r.despublicar, { estado: 'pausado', publicado: false })
  assert.equal(r.despublicadoEnBusqueda, 0)
  assert.equal(r.despublicadoReserva, 404)
  assert.equal(r.suspendidoPropietario, 'LISTING_SUSPENDED')
  assert.equal(r.suspendidoAdmin, 'publicado')
})

test('ALOJAMIENTOS reservas PostgreSQL: search by dates and guests is decided by the API; a reservation is confirmed with the total computed by the backend; overlapping dates are refused, back to back ones are not; two simultaneous guests never share dates; blocks, cancellations with history, and nobody sees or changes what is not theirs', { skip, timeout: 240_000 }, () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      await cuenta('ana')
      const beto = await cuenta('beto')
      await cuenta('caro')
      await cuenta('admin', ['tus:providers:admin'])
      const { id } = (await pedir('POST', '/mios', 'tok-ana', FORM)).body
      await pedir('POST', '/' + id + '/publicacion', 'tok-ana', { publicado: true })
      const unidadId = (await prisma.unidadAlojamiento.findFirst({ where: { alojamientoId: id } })).id
      const buscar = async (query) => { const res = await pedir('GET', '/?q=' + encodeURIComponent(run) + (query ? '&' + query : ''), null); return res.status === 200 ? res.body.items.map((a) => a.precioDesde?.amount ?? 0) : res.status + ':' + res.body.error?.fields?.[0] }
      // 6-7. search: dates, guests, invalid ranges
      out.busca = { libre: await buscar(''), fechas: await buscar('checkIn=' + dia(0) + '&checkOut=' + dia(3)), cuatro: await buscar('personas=4'), cinco: await buscar('personas=5'), alReves: await buscar('checkIn=' + dia(3) + '&checkOut=' + dia(0)), ceroNoches: await buscar('checkIn=' + dia(0) + '&checkOut=' + dia(0)), soloEntrada: await buscar('checkIn=' + dia(0)), imposible: await buscar('checkIn=2027-02-30&checkOut=2027-03-02'), pasado: await buscar('checkIn=2020-01-01&checkOut=2020-01-03'), personasTexto: await buscar('personas=muchas'), otroDestino: (await pedir('GET', '/?q=zzzz-no-existe-' + run, null)).body.items.length }
      // 9-10, 16-18. reserve: session required, ranges, total by the backend
      out.sinSesion = (await pedir('POST', '/reservas', null, reserva(unidadId, id, 0, 3))).status
      const invalidas = {}
      for (const [nombre, cuerpo] of Object.entries({ alReves: reserva(unidadId, id, 3, 0), ceroNoches: reserva(unidadId, id, 2, 2), pasada: { ...reserva(unidadId, id, 0, 2), fechaInicio: '2020-01-01', fechaFin: '2020-01-03' }, imposible: { ...reserva(unidadId, id, 0, 2), fechaInicio: 'mañana' }, conHora: { ...reserva(unidadId, id, 0, 2), fechaInicio: dia(0) + 'T14:00:00.000-03:00' }, capacidad: reserva(unidadId, id, 0, 2, { cantidadPersonas: 5 }), total: reserva(unidadId, id, 0, 2, { precioFinalSnapshot: 1 }), estado: reserva(unidadId, id, 0, 2, { estado: 'completed' }), cliente: reserva(unidadId, id, 0, 2, { clienteIdFalso: beto }) })) {
        const res = await pedir('POST', '/reservas', 'tok-beto', cuerpo)
        invalidas[nombre] = res.status + ':' + (res.body.error?.fields?.[0] ?? res.body.error?.code)
      }
      out.invalidas = invalidas
      const hecha = await pedir('POST', '/reservas', 'tok-beto', reserva(unidadId, id, 0, 3, { clienteId: 'otra-cuenta' }))
      out.reserva = { status: hecha.status, estado: hecha.body.estado, total: hecha.body.precioFinalSnapshot, moneda: hecha.body.moneda, cliente: hecha.body.clienteId === beto, hold: hecha.body.holdExpiracion }
      const reservaId = hecha.body.id
      // 11. overlap refused; back to back accepted
      out.solapada = (await pedir('POST', '/reservas', 'tok-caro', reserva(unidadId, id, 2, 5))).body.error?.code
      out.contenida = (await pedir('POST', '/reservas', 'tok-caro', reserva(unidadId, id, 1, 2))).body.error?.code
      const seguida = await pedir('POST', '/reservas', 'tok-caro', reserva(unidadId, id, 3, 5))
      out.seguida = { status: seguida.status, total: seguida.body.precioFinalSnapshot }
      out.buscaOcupado = { ocupado: await buscar('checkIn=' + dia(1) + '&checkOut=' + dia(4)), libre: await buscar('checkIn=' + dia(5) + '&checkOut=' + dia(7)) }
      // 12. two guests, the same dates, at the same time
      const carrera = await Promise.all(['tok-beto', 'tok-caro', 'tok-beto', 'tok-caro'].map((token) => pedir('POST', '/reservas', token, reserva(unidadId, id, 10, 13))))
      out.carrera = carrera.map((res) => res.status === 201 ? 'ok' : res.body.error?.code).sort()
      out.carreraFilas = await prisma.reservaAlojamiento.count({ where: { unidadId, estado: 'confirmed', fechaInicio: new Date(dia(10)) } })
      // 14-15. blocks of the owner
      out.bloqueoAjeno = (await pedir('POST', '/unidades/' + unidadId + '/bloquear', 'tok-beto', { fechaInicio: dia(20), fechaFin: dia(25), motivo: 'Mantenimiento' })).status
      out.bloqueoConReserva = (await pedir('POST', '/unidades/' + unidadId + '/bloquear', 'tok-ana', { fechaInicio: dia(2), fechaFin: dia(4), motivo: 'Mantenimiento' })).body.error?.code
      const bloqueo = await pedir('POST', '/unidades/' + unidadId + '/bloquear', 'tok-ana', { fechaInicio: dia(20), fechaFin: dia(25), motivo: 'Uso personal' })
      out.bloqueo = bloqueo.status
      out.bloqueoUnDia = (await pedir('POST', '/unidades/' + unidadId + '/bloquear', 'tok-ana', { fechaInicio: dia(27), fechaFin: dia(28), motivo: 'Reformas' })).status
      out.bloqueos = (await pedir('GET', '/unidades/' + unidadId + '/bloqueos', 'tok-ana')).body.items.map((b) => b.motivo)
      out.bloqueosAjenos = (await pedir('GET', '/unidades/' + unidadId + '/bloqueos', 'tok-beto')).status
      // 8. blocked dates: not in the search, not reservable; the day the block ends is free
      out.buscaBloqueado = { dentro: await buscar('checkIn=' + dia(22) + '&checkOut=' + dia(24)), borde: await buscar('checkIn=' + dia(19) + '&checkOut=' + dia(21)), despues: await buscar('checkIn=' + dia(25) + '&checkOut=' + dia(26)) }
      out.reservaBloqueada = (await pedir('POST', '/reservas', 'tok-beto', reserva(unidadId, id, 21, 23))).body.error?.code
      const publicoDetalle = JSON.stringify((await pedir('GET', '/' + id + '?checkIn=' + dia(22) + '&checkOut=' + dia(24), null)).body)
      out.motivoPrivado = !publicoDetalle.includes('Uso personal')
      // a block and a reservation at the same time: never both
      const cruce = await Promise.all([pedir('POST', '/unidades/' + unidadId + '/bloquear', 'tok-ana', { fechaInicio: dia(40), fechaFin: dia(44), motivo: 'Vacaciones' }), pedir('POST', '/reservas', 'tok-caro', reserva(unidadId, id, 41, 43))])
      out.cruce = cruce.map((res) => res.status === 201 ? 'ok' : res.body.error?.code).sort()
      out.quitarBloqueoAjeno = (await pedir('DELETE', '/bloqueos/' + bloqueo.body.id, 'tok-beto')).status
      out.quitarBloqueo = (await pedir('DELETE', '/bloqueos/' + bloqueo.body.id, 'tok-ana')).status
      out.trasQuitarBloqueo = await buscar('checkIn=' + dia(22) + '&checkOut=' + dia(24))
      // 23. the guest sees its own reservations, with the address once confirmed
      const mias = (await pedir('GET', '/reservas/mias', 'tok-beto')).body.items
      const mia = mias.find((x) => x.id === reservaId)
      out.mias = { todasMias: mias.every((x) => x.clienteId === beto), noches: mia.noches, total: mia.precioFinalSnapshot, direccion: mia.direccion, estado: mia.estado, puede: mia.puedeCancelar, checkIn: mia.checkInHora }
      out.miasSinSesion = (await pedir('GET', '/reservas/mias', null)).status
      // 24-25. the owner sees the reservations of its alojamiento; nobody else does
      out.reservasPropietario = (await pedir('GET', '/' + id + '/reservas', 'tok-ana')).body.items.length >= 3
      out.reservasAjenas = (await pedir('GET', '/' + id + '/reservas', 'tok-beto')).status
      out.estadoAjeno = (await pedir('PATCH', '/reservas/' + reservaId + '/estado', 'tok-caro', { estado: 'cancelled' })).status
      // 13. cancellation: only its own, with history, the row stays, the dates come back
      out.cancelarAjena = (await pedir('POST', '/reservas/' + reservaId + '/cancelar', 'tok-caro', {})).status
      out.cancelarExtra = (await pedir('POST', '/reservas/' + reservaId + '/cancelar', 'tok-beto', { estado: 'completed' })).status
      out.cancelar = (await pedir('POST', '/reservas/' + reservaId + '/cancelar', 'tok-beto', { motivo: 'Cambio de planes' })).status
      out.cancelarDosVeces = (await pedir('POST', '/reservas/' + reservaId + '/cancelar', 'tok-beto', {})).body.error?.code
      out.filaCancelada = (await prisma.reservaAlojamiento.findUnique({ where: { id: reservaId } })).estado
      out.historial = (await pedir('GET', '/reservas/' + reservaId + '/historial', 'tok-ana')).body.items.map((h) => [h.estadoAnterior, h.estadoNuevo, h.actorRol, h.motivo].join('|'))
      out.historialAjeno = (await pedir('GET', '/reservas/' + reservaId + '/historial', 'tok-caro')).status
      out.trasCancelar = (await pedir('POST', '/reservas', 'tok-caro', reserva(unidadId, id, 0, 3))).status
      out.miaCancelada = (await pedir('GET', '/reservas/mias', 'tok-beto')).body.items.filter((x) => x.id === reservaId).map((x) => [x.estado, x.direccion, x.puedeCancelar].join('|'))
      // the owner cancels a reservation of its alojamiento; it is kept in the history as the owner
      const delPropietario = seguida.body.id
      out.cancelaPropietario = (await pedir('PATCH', '/reservas/' + delPropietario + '/estado', 'tok-ana', { estado: 'cancelled' })).status
      out.historialPropietario = (await pedir('GET', '/reservas/' + delPropietario + '/historial', 'tok-admin')).body.items.map((h) => [h.estadoAnterior, h.estadoNuevo, h.actorRol].join('|'))
      out.revivir = (await pedir('PATCH', '/reservas/' + delPropietario + '/estado', 'tok-ana', { estado: 'checked_in' })).body.error?.code
      // a stay that already started is not cancelled by the guest
      const enCurso = 'res-' + run
      await prisma.reservaAlojamiento.create({ data: { id: enCurso, unidadId, alojamientoId: id, clienteId: beto, clienteNombre: 'Huésped', fechaInicio: new Date(Date.parse(hoy)), fechaFin: new Date(Date.parse(hoy) + 2 * 86_400_000), modalidad: 'noche', precioListaSnapshot: 1n, precioFinalSnapshot: 1n, estado: 'confirmed' } })
      out.cancelarEnCurso = (await pedir('POST', '/reservas/' + enCurso + '/cancelar', 'tok-beto', {})).body.error?.code
      console.log(JSON.stringify(out))
    } finally {${FIN}    }
  `)
  assert.deepEqual(r.busca, { libre: [50000], fechas: [150000], cuatro: [50000], cinco: [], alReves: '400:checkOut', ceroNoches: '400:checkOut', soloEntrada: '400:checkOut', imposible: '400:checkIn', pasado: '400:checkIn', personasTexto: '400:personas', otroDestino: 0 }, 'three nights are three times the price per night; the API decides who fits')
  assert.equal(r.sinSesion, 401)
  assert.deepEqual(r.invalidas, { alReves: '400:fechaFin', ceroNoches: '400:fechaFin', pasada: '400:fechaInicio', imposible: '400:fechaInicio', conHora: '400:fechaInicio', capacidad: '400:CAPACITY_EXCEEDED', total: '400:precioFinalSnapshot', estado: '400:estado', cliente: '400:clienteIdFalso' })
  assert.deepEqual(r.reserva, { status: 201, estado: 'confirmed', total: 150000, moneda: 'ARS', cliente: true, hold: null }, 'nights x price per night, computed by the backend; the guest is the session')
  assert.equal(r.solapada, 'SLOT_OCCUPIED')
  assert.equal(r.contenida, 'SLOT_OCCUPIED')
  assert.deepEqual(r.seguida, { status: 201, total: 100000 }, 'check-in on the day of a check-out is allowed')
  assert.deepEqual(r.buscaOcupado, { ocupado: [], libre: [100000] })
  assert.deepEqual(r.carrera, ['SLOT_OCCUPIED', 'SLOT_OCCUPIED', 'SLOT_OCCUPIED', 'ok'], 'one reservation wins, the others get a conflict')
  assert.equal(r.carreraFilas, 1)
  assert.equal(r.bloqueoAjeno, 403)
  assert.equal(r.bloqueoConReserva, 'UNIT_HAS_RESERVATIONS', 'a block never covers a live reservation')
  assert.deepEqual([r.bloqueo, r.bloqueoUnDia], [201, 201])
  assert.deepEqual(r.bloqueos, ['Uso personal', 'Reformas'])
  assert.equal(r.bloqueosAjenos, 403)
  assert.deepEqual(r.buscaBloqueado, { dentro: [], borde: [], despues: [50000] })
  assert.equal(r.reservaBloqueada, 'UNIT_BLOCKED')
  assert.equal(r.motivoPrivado, true, 'the reason of a block is private')
  assert.equal(r.cruce.filter((x) => x === 'ok').length, 1, `a block and a reservation of the same dates: only one (${r.cruce})`)
  assert.deepEqual([r.quitarBloqueoAjeno, r.quitarBloqueo], [403, 200])
  assert.deepEqual(r.trasQuitarBloqueo, [100000], 'removing a block gives the dates back')
  assert.deepEqual(r.mias, { todasMias: true, noches: 3, total: 150000, direccion: 'Calle Privada 1234', estado: 'confirmed', puede: true, checkIn: '14:00' })
  assert.equal(r.miasSinSesion, 401)
  assert.equal(r.reservasPropietario, true)
  assert.deepEqual([r.reservasAjenas, r.estadoAjeno], [403, 403])
  assert.deepEqual([r.cancelarAjena, r.cancelarExtra, r.cancelar], [404, 400, 200])
  assert.equal(r.cancelarDosVeces, 'CANCELLATION_NOT_ALLOWED')
  assert.equal(r.filaCancelada, 'cancelled', 'a cancellation is a state, never a deleted row')
  assert.deepEqual(r.historial, ['|confirmed|cliente|', 'confirmed|cancelled|cliente|Cambio de planes'])
  assert.equal(r.historialAjeno, 403)
  assert.equal(r.trasCancelar, 201, 'the dates of a cancelled reservation can be reserved again')
  assert.deepEqual(r.miaCancelada, ['cancelled||false'], 'a cancelled reservation no longer shows the address')
  assert.equal(r.cancelaPropietario, 200)
  assert.deepEqual(r.historialPropietario, ['|confirmed|cliente', 'confirmed|cancelled|propietario'])
  assert.equal(r.revivir, 'INVALID_STATE')
  assert.equal(r.cancelarEnCurso, 'CANCELLATION_NOT_ALLOWED')
})
