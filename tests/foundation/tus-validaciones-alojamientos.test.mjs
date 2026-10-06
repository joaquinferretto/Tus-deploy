import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// VALIDACIONES-01, lodging (docs/VALIDACIONES_DATOS_TUS.md): what the lodging routes accept from
// a body. The routes answer 400 with the field; the behaviour against PostgreSQL is in
// tus-alojamientos-http.test.mjs and tus-alojamientos-postgres.test.mjs.

test('VALIDACIONES alojamientos: a reservation, a rating, a lodging, a unit, a tarifa, an image and a block are read field by field — real dates in order, whole non-negative prices in ARS, closed lists, https images, no unknown field', () => {
  const r = runTypeScriptScenario(`
    const a = await import('./apps/api/src/tus/alojamientos/alojamientos-entrada.ts')
    const ahora = Date.parse('2026-10-05T12:00:00.000Z')
    const campo = (x) => x.ok ? 'ok' : x.campo
    const reserva = (extra = {}) => a.leerReserva({ unidadId: 'uni-1', alojamientoId: 'aloj-1', clienteNombre: 'María José Pérez', fechaInicio: '2026-10-10', fechaFin: '2026-10-12', ...extra }, ahora)
    const valida = reserva({ clienteEmail: ' Ana@Example.com ', clienteTelefono: '3794 123456', cantidadPersonas: '3', notas: '  Llegamos tarde  ', modalidad: 'noche' })
    const out = {}
    out.sinClienteDelCuerpo = 'clienteId' in reserva({ clienteId: 'cuenta-de-otro' }).valor
    out.reserva = [valida.ok, valida.valor.clienteEmail, valida.valor.clienteTelefono.startsWith('+54'), valida.valor.cantidadPersonas, valida.valor.notas]
    out.reservaInvalida = [
      reserva({ fechaFin: '2026-10-09' }), reserva({ fechaInicio: 'el lunes' }), reserva({ fechaFin: '2028-10-12' }), reserva({ fechaInicio: '2040-01-01', fechaFin: '2040-01-03' }),
      reserva({ clienteNombre: 'x' }), reserva({ clienteNombre: { nombre: 'x' } }), reserva({ clienteEmail: 'no-email' }), reserva({ clienteTelefono: '12' }),
      reserva({ cantidadPersonas: 0 }), reserva({ cantidadPersonas: 2.5 }), reserva({ modalidad: 'por_minuto' }), reserva({ notas: 'x'.repeat(501) }),
      reserva({ clienteId: 'cuenta-de-otro' }), reserva({ estado: 'confirmed' }), reserva({ precioFinal: 1 }), reserva({ unidadId: 'a b' }), reserva({ alojamientoId: undefined }),
    ].map(campo)
    const calificar = (extra = {}) => campo(a.leerCalificacion({ reservaId: 'res-1', puntuacion: 5, comentario: 'Muy bueno', ...extra }))
    out.calificacion = [calificar(), calificar({ puntuacion: 6 }), calificar({ puntuacion: 4.5 }), calificar({ puntuacion: 'cinco' }), calificar({ comentario: 'x'.repeat(1001) }), calificar({ clienteId: 'otro' })]
    const alojamiento = (extra = {}) => a.leerAlojamiento({ tipoId: 'tipo-cabana', nombre: 'Cabañas del Río', slug: 'cabanas-del-rio', direccion: 'Ruta 12 km 5', latitud: -27.47, longitud: -58.83, ...extra })
    const creado = alojamiento({ comodidades: [' wifi ', 'pileta', 'wifi'], checkInHora: '14:00', publicado: false, propietarioId: ' cuenta-1 ' })
    out.alojamiento = [creado.ok, creado.valor.comodidades, creado.valor.publicado, creado.valor.propietarioId]
    out.alojamientoInvalido = [
      alojamiento({ latitud: 91 }), alojamiento({ longitud: '−58' }), alojamiento({ latitud: Number.NaN }), alojamiento({ slug: 'Con Espacios' }), alojamiento({ slug: '../admin' }),
      alojamiento({ nombre: '' }), alojamiento({ checkInHora: '25:00' }), alojamiento({ publicado: 'si' }), alojamiento({ comodidades: 'wifi' }), alojamiento({ comodidades: [1, 2] }),
      alojamiento({ descripcion: 'x'.repeat(4001) }), alojamiento({ estado: 'publicado' }), alojamiento({ ratingPromedio: 5 }),
    ].map(campo)
    const unidad = (extra = {}) => campo(a.leerUnidad({ nombre: 'Cabaña 1', ...extra }))
    out.unidad = [unidad(), unidad({ capacidadPersonas: 0 }), unidad({ capacidadPersonas: 'muchas' }), unidad({ banosCantidad: -1 }), unidad({ nombre: 5 }), unidad({ alojamientoId: 'otro' })]
    const tarifa = (extra = {}) => a.leerTarifaAlojamiento({ precio: 45000, ...extra })
    const base = tarifa()
    out.tarifa = [base.ok, base.valor.precio.toString(), base.valor.moneda, base.valor.modalidad, base.valor.diasSemana.length, base.valor.minimoEstadia]
    out.tarifaInvalida = [
      tarifa({ precio: -1 }), tarifa({ precio: 100.5 }), tarifa({ precio: 'gratis' }), tarifa({ precio: null }), tarifa({ moneda: 'USD' }), tarifa({ modalidad: 'mensual' }),
      tarifa({ diasSemana: [7] }), tarifa({ diasSemana: [] }), tarifa({ diasSemana: 'todos' }), tarifa({ minimoEstadia: 0 }), tarifa({ minimoEstadia: 3, maximoEstadia: 2 }),
      tarifa({ modalidad: 'bloque_horas' }), tarifa({ duracionHoras: 0 }), tarifa({ activa: false }),
    ].map(campo)
    const imagen = (extra = {}, conCategoria = true) => campo(a.leerImagen({ url: 'https://cdn.example.com/a.jpg', ...extra }, conCategoria))
    out.imagen = [imagen(), imagen({ categoria: 'exterior', esPrincipal: true, orden: 2, alt: 'Frente' }), imagen({ url: 'javascript:alert(1)' }), imagen({ url: 'data:image/png;base64,AAAA' }), imagen({ url: 'http://cdn.example.com/a.jpg' }), imagen({ url: '/local.jpg' }), imagen({ esPrincipal: 'true' }), imagen({ orden: -1 }), imagen({ categoria: '<b>' }), imagen({ categoria: 'exterior' }, false), imagen({ alt: 'x'.repeat(201) })]
    const bloqueo = (extra = {}) => campo(a.leerBloqueoUnidad({ fechaInicio: '2026-10-10', fechaFin: '2026-10-12', motivo: 'Mantenimiento', ...extra }, ahora))
    out.bloqueo = [bloqueo(), bloqueo({ fechaFin: '2026-10-10' }), bloqueo({ motivo: '' }), bloqueo({ motivo: 'x'.repeat(201) }), bloqueo({ fechaFin: '2029-01-01' }), bloqueo({ creadoPorUsuarioId: 'otro' })]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.reserva, [true, 'ana@example.com', true, 3, 'Llegamos tarde'], 'a valid reservation is normalized (email, canonical phone, integers)')
  assert.deepEqual(r.reservaInvalida, ['fechaFin', 'fechaInicio', 'fechaFin', 'fechaInicio', 'clienteNombre', 'clienteNombre', 'clienteEmail', 'clienteTelefono', 'cantidadPersonas', 'cantidadPersonas', 'modalidad', 'notas', 'ok', 'estado', 'precioFinal', 'unidadId', 'alojamientoId'], 'each refusal names its field; the state and the price never come from the body; a clienteId is tolerated and never read')
  assert.equal(r.sinClienteDelCuerpo, false, 'the client of the body is never part of what was read')
  assert.deepEqual(r.calificacion, ['ok', 'puntuacion', 'puntuacion', 'puntuacion', 'comentario', 'ok'])
  assert.deepEqual(r.alojamiento, [true, ['wifi', 'pileta'], false, 'cuenta-1'])
  assert.deepEqual(r.alojamientoInvalido, ['latitud', 'longitud', 'latitud', 'slug', 'slug', 'nombre', 'checkInHora', 'publicado', 'comodidades', 'comodidades', 'descripcion', 'estado', 'ratingPromedio'], 'coordinates in range, a clean slug, real hours and booleans; the state and the rating are not fields of the form')
  assert.deepEqual(r.unidad, ['ok', 'capacidadPersonas', 'capacidadPersonas', 'banosCantidad', 'nombre', 'alojamientoId'])
  assert.deepEqual(r.tarifa, [true, '45000', 'ARS', 'noche', 7, 1])
  assert.deepEqual(r.tarifaInvalida, ['precio', 'precio', 'precio', 'precio', 'moneda', 'modalidad', 'diasSemana', 'diasSemana', 'diasSemana', 'minimoEstadia', 'maximoEstadia', 'duracionHoras', 'duracionHoras', 'activa'], 'a price is a whole non-negative amount in ARS; modes and days are closed lists')
  assert.deepEqual(r.imagen, ['ok', 'ok', 'url', 'url', 'url', 'url', 'esPrincipal', 'orden', 'categoria', 'categoria', 'alt'], 'an image is an https address, never javascript: or data:')
  assert.deepEqual(r.bloqueo, ['ok', 'fechaFin', 'motivo', 'motivo', 'fechaFin', 'creadoPorUsuarioId'])
})
