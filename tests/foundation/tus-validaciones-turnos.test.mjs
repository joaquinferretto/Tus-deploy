import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// VALIDACIONES-01 (docs/VALIDACIONES_DATOS_TUS.md). Reading of untrusted input, and the agenda
// routes as a direct API caller would hit them: bad input is a 400 that names the field, never a
// 500 and never a silent coercion. No database: the service is a recorder.

test('VALIDACIONES entrada: nothing is coerced — a text is a text, an integer an integer, an amount a non-negative whole number, a boolean a boolean, an instant carries its offset', () => {
  const r = runTypeScriptScenario(`
    const e = await import('./apps/api/src/tus/validacion/entrada.ts')
    const v = (x) => e.esInvalido(x) ? 'INVALIDO' : typeof x === 'bigint' ? x.toString() + 'n' : x instanceof Date ? x.toISOString() : x
    console.log(JSON.stringify({
      texto: [e.texto('  José   Muñoz ', { min: 2, max: 20 }), e.texto('a', { min: 2, max: 20 }), e.texto('x'.repeat(21), { max: 20 }), e.texto(12, { max: 20 }), e.texto({}, { max: 20 }), e.texto('hola\\u0000', { max: 20 }), e.texto('a\\u202Eb', { max: 20 }), e.texto('😀'.repeat(20), { max: 20 }), e.texto('linea 1\\r\\n\\r\\n\\r\\n\\r\\nlinea 2', { max: 40, lineas: true }), e.texto('una\\notra', { max: 40 })].map(v),
      opcional: [e.textoOpcional(undefined, { max: 5 }), e.textoOpcional('   ', { max: 5 }), e.textoOpcional('abc', { max: 5 }), e.textoOpcional('abcdef', { max: 5 }), e.textoOpcional(7, { max: 5 })].map(v),
      entero: [e.entero(30, { min: 5, max: 1440 }), e.entero('30', { min: 5, max: 1440 }), e.entero(30.5, { min: 5, max: 1440 }), e.entero('abc', { min: 5, max: 1440 }), e.entero(Number.NaN, { min: 5, max: 1440 }), e.entero(Infinity, { min: 5, max: 1440 }), e.entero(4, { min: 5, max: 1440 }), e.entero(1441, { min: 5, max: 1440 }), e.entero(true, { min: 0, max: 5 }), e.entero('1e3', { min: 0, max: 5000 })].map(v),
      monto: [e.monto(1500), e.monto('1500'), e.monto(0), e.monto(-1), e.monto('-1'), e.monto(1500.5), e.monto('1500.50'), e.monto('abc'), e.monto(Number.NaN), e.monto(Infinity), e.monto(100000000), e.monto(100000001), e.monto('9'.repeat(30)), e.monto(null), e.monto([1])].map(v),
      booleano: [e.booleano(true), e.booleano(false), e.booleano('false'), e.booleano(0), e.booleano(null)].map(v),
      instante: [e.instante('2026-10-05T14:00:00.000Z'), e.instante('2026-10-05T11:00-03:00'), e.instante('2026-10-05T14:00:00'), e.instante('2026-10-05'), e.instante('2026-13-45T99:00:00Z'), e.instante(1791208800000), e.instante('mañana')].map(v),
      enumerado: [e.enumerado('local', ['local', 'domicilio']), e.enumerado('LOCAL', ['local', 'domicilio']), e.enumerado(['local'], ['local'])].map(v),
      id: [e.identificador('oficio-plomeria'), e.identificador('a b'), e.identificador('../etc'), e.identificador(''), e.identificador('x'.repeat(121))].map(v),
      url: [e.urlHttps('https://cdn.example.com/foto.jpg'), e.urlHttps('http://cdn.example.com/foto.jpg'), e.urlHttps('javascript:alert(1)'), e.urlHttps('data:image/png;base64,AAAA'), e.urlHttps('/relativa.jpg'), e.urlHttps('https://usuario:clave@example.com/x'), e.urlHttps('https://localhost/x'), e.urlHttps('https://example.com/a b')].map(v),
      hora: [e.hora('09:30'), e.hora('24:00'), e.hora('9:30'), e.hora('09:60')].map(v),
      desconocidos: e.camposDesconocidos({ a: 1, role: 'admin', b: 2 }, ['a', 'b']),
    }))
  `)
  assert.deepEqual(r.texto, ['José Muñoz', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', '😀'.repeat(20), 'linea 1\n\nlinea 2', 'una otra'], 'Unicode is kept and counted by characters; control and bidi characters are refused')
  assert.deepEqual(r.opcional, [null, null, 'abc', 'INVALIDO', 'INVALIDO'])
  assert.deepEqual(r.entero, [30, 30, 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO'])
  assert.deepEqual(r.monto, ['1500n', '1500n', '0n', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', '100000000n', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO'], 'no negative, no decimal, no NaN, no Infinity, bounded')
  assert.deepEqual(r.booleano, [true, false, 'INVALIDO', 'INVALIDO', 'INVALIDO'], '"false" is not false')
  assert.deepEqual(r.instante, ['2026-10-05T14:00:00.000Z', '2026-10-05T14:00:00.000Z', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO'], 'an instant without its offset is not an instant')
  assert.deepEqual(r.enumerado, ['local', 'INVALIDO', 'INVALIDO'])
  assert.deepEqual(r.id, ['oficio-plomeria', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO'])
  assert.deepEqual(r.url, ['https://cdn.example.com/foto.jpg', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO', 'INVALIDO'], 'only https addresses of a real host')
  assert.deepEqual(r.hora, ['09:30', 'INVALIDO', 'INVALIDO', 'INVALIDO'])
  assert.deepEqual(r.desconocidos, ['role'])
})

const RUTAS_SETUP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { crearRouterTurnos } = await import('./apps/api/src/tus/calendar/turnos-http.ts')
  const llamadas = []
  // Records what reaches the service: a refused body must never get here.
  const servicio = new Proxy({}, { get: (_t, metodo) => async (input) => { llamadas.push([metodo, input]); return metodo === 'perfilDeTenant' ? { id: 'perfil-1' } : { ok: true, id: 'x', precioBase: null } } })
  const SESIONES = { prestador: { subjectId: 'cuenta-p', tenantId: 'tenant-p', sessionId: 's', roles: ['owner'], permissions: ['tus:marketplace:write'], correlationId: 'c' }, admin: { subjectId: 'cuenta-admin', tenantId: 'tenant-a', sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:payments:admin', 'tus:whatsapp:admin'], correlationId: 'c' } }
  const sessions = { resolve: async (token) => SESIONES[token] ?? null }
  const app = express()
  app.use(express.json())
  app.use(crearRouterTurnos({ servicio, sessions }))
  app.use((error, _req, res, _next) => res.status(500).json({ code: 'CRASH', error: String(error?.message) }))
  const server = app.listen(0)
  const base = 'http://127.0.0.1:' + server.address().port
  const pedir = async (quien, method, path, body) => {
    const antes = llamadas.length
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + quien, 'x-correlation-id': 'c' }, body: JSON.stringify(body) })
    const json = await r.json().catch(() => ({}))
    const llego = llamadas.slice(antes).filter(([m]) => m !== 'perfilDeTenant')
    return { status: r.status, code: json.code ?? null, campo: json.fields?.[0] ?? null, llego: llego.length, input: llego[0]?.[1] ?? null }
  }
  const resumen = (x) => [x.status, x.campo, x.llego]
  const en = (horas) => new Date(Date.now() + horas * 3600_000).toISOString()
`

test('VALIDACIONES turnos (API directa): a turno written by hand, a block, a service configuration, tarifas and a price change are refused with the field that failed — a decimal price, a negative one, "abc", a date without offset, an unknown field or a provider id in the body never reach the service', () => {
  const r = runTypeScriptScenario(`${RUTAS_SETUP}
    const out = {}
    try {
      const manual = (body) => pedir('prestador', 'POST', '/tus/v1/prestador/turnos/manual', { oficioId: 'oficio-masaje', inicio: en(48), clienteNombre: 'María José Pérez-Gómez', ...body })
      const valido = await manual({ clienteTelefono: '3794 123456', clienteEmail: ' Cliente@Example.COM ', precioFinal: 1500, duracionMinutos: '45', notas: 'Trae estudios' })
      out.manualValido = [valido.status, valido.llego, valido.input.prestadorTenantId, valido.input.precioFinal?.toString(), valido.input.duracionMinutos, valido.input.clienteNombre, valido.input.clienteTelefono?.startsWith('+54'), valido.input.clienteEmail, valido.input.notas]
      out.manualInvalido = {
        precioDecimal: resumen(await manual({ precioFinal: 1500.5 })),
        precioTexto: resumen(await manual({ precioFinal: 'abc' })),
        precioNegativo: resumen(await manual({ precioFinal: -100 })),
        precioEnorme: resumen(await manual({ precioFinal: '999999999999999999' })),
        duracionTexto: resumen(await manual({ duracionMinutos: 'media hora' })),
        duracionCero: resumen(await manual({ duracionMinutos: 0 })),
        inicioSinZona: resumen(await manual({ inicio: '2026-12-01T10:00:00' })),
        inicioBasura: resumen(await manual({ inicio: 'mañana a las 10' })),
        inicioLejano: resumen(await manual({ inicio: '2099-01-01T10:00:00.000Z' })),
        finAntes: resumen(await manual({ inicio: en(48), fin: en(47) })),
        nombreCorto: resumen(await manual({ clienteNombre: ' a ' })),
        nombreObjeto: resumen(await manual({ clienteNombre: { $ne: null } })),
        nombreLargo: resumen(await manual({ clienteNombre: 'x'.repeat(121) })),
        telefonoMalo: resumen(await manual({ clienteTelefono: '12ab' })),
        emailMalo: resumen(await manual({ clienteEmail: 'no-es-un-email' })),
        notasLargas: resumen(await manual({ notas: 'x'.repeat(501) })),
        tenantAjeno: resumen(await manual({ prestadorTenantId: 'tenant-de-otro' })),
        estadoInterno: resumen(await manual({ estado: 'completed' })),
        oficioMalo: resumen(await manual({ oficioId: '../../x' })),
      }
      const bloquear = (body) => pedir('prestador', 'POST', '/tus/v1/prestador/turnos/bloquear', body)
      const bloqueo = await bloquear({ inicio: en(24), fin: en(26), motivo: '  Vacaciones  ' })
      out.bloqueo = [bloqueo.status, bloqueo.input.prestadorTenantId, bloqueo.input.motivo, resumen(await bloquear({ inicio: en(26), fin: en(24) })), resumen(await bloquear({ inicio: 'x', fin: en(24) })), resumen(await bloquear({ inicio: en(1), fin: en(24 * 400) })), resumen(await bloquear({ inicio: en(1), fin: en(2), motivo: 'x'.repeat(201) })), resumen(await bloquear({ inicio: en(1), fin: en(2), prestadorTenantId: 'otro' }))]

      const config = (body) => pedir('prestador', 'PUT', '/tus/v1/prestador/servicios/oficio-masaje/turnos-config', body)
      const configurada = await config({ turnosHabilitados: false, precioBase: '2500', duracionMinutos: 60, bufferMinutos: 15, modalidad: 'mixto' })
      out.config = [configurada.status, configurada.input.perfilId, configurada.input.turnosHabilitados, configurada.input.precioBase.toString(), configurada.input.modalidad]
      out.configInvalida = {
        booleanoTexto: resumen(await config({ turnosHabilitados: 'false' })),
        precioNegativo: resumen(await config({ precioBase: -1 })),
        precioDecimal: resumen(await config({ precioBase: '10.5' })),
        duracionDecimal: resumen(await config({ duracionMinutos: 30.5 })),
        duracionEnorme: resumen(await config({ duracionMinutos: 100000 })),
        bufferNegativo: resumen(await config({ bufferMinutos: -5 })),
        modalidadLibre: resumen(await config({ modalidad: 'teletransporte' })),
        perfilAjeno: resumen(await config({ perfilId: 'perfil-de-otro', turnosHabilitados: true })),
        verificado: resumen(await config({ verified: true })),
      }
      const tarifas = (lista) => pedir('prestador', 'PUT', '/tus/v1/prestador/servicios/oficio-masaje/tarifas', { tarifas: lista })
      const guardadas = await tarifas([{ nombre: ' Sesión  completa ', duracionMinutos: 60, precio: 3000 }])
      out.tarifas = [guardadas.status, guardadas.input.tarifas[0].nombre, guardadas.input.tarifas[0].precio.toString(), resumen(await tarifas([{ nombre: 'A', duracionMinutos: 60, precio: 10.5 }])), resumen(await tarifas([{ nombre: 'A', duracionMinutos: 60, precio: -1 }])), resumen(await tarifas([{ nombre: '', duracionMinutos: 60, precio: 1 }])), resumen(await tarifas([{ nombre: 'A', duracionMinutos: 'x', precio: 1 }])), resumen(await tarifas(['x'])), resumen(await tarifas([{ nombre: 'A', duracionMinutos: 60, precio: 1, perfilId: 'otro' }])), resumen(await tarifas(Array.from({ length: 21 }, () => ({ nombre: 'A', duracionMinutos: 60, precio: 1 })))), resumen(await pedir('prestador', 'PUT', '/tus/v1/prestador/servicios/oficio-masaje/tarifas', { tarifas: 'todas' }))]

      const estado = (body) => pedir('prestador', 'PATCH', '/tus/v1/prestador/turnos/res-1/estado', body)
      out.estado = [(await estado({ estado: 'no-show', motivo: 'No vino' })).status, resumen(await estado({ estado: 'confirmed' })), resumen(await estado({ estado: { x: 1 } })), resumen(await estado({ estado: 'cancelled', motivo: 'x'.repeat(301) })), resumen(await estado({ estado: 'cancelled', precioFinal: 0 }))]

      // The administration.
      const precio = (body) => pedir('admin', 'PATCH', '/tus/v1/admin/turnos/res-1/precio', body)
      const cambiado = await precio({ precioFinal: 1800, motivo: 'Acordado con el cliente' })
      out.precio = [cambiado.status, cambiado.input.nuevoPrecio.toString(), cambiado.input.adminId, resumen(await precio({ precioFinal: -5, motivo: 'Acordado con el cliente' })), resumen(await precio({ precioFinal: 'gratis', motivo: 'Acordado con el cliente' })), resumen(await precio({ precioFinal: 10.25, motivo: 'Acordado con el cliente' })), resumen(await precio({ motivo: 'Acordado con el cliente' })), resumen(await precio({ precioFinal: 100, motivo: 'no' })), resumen(await precio({ precioFinal: 100, motivo: 'Acordado con el cliente', adminId: 'otro-admin' }))]
      const forzar = (body) => pedir('admin', 'POST', '/tus/v1/admin/turnos/forzar', { prestadorId: 'prestador-1', oficioId: 'oficio-masaje', inicio: en(72), clienteNombre: "Sofía O'Connor", motivoForzado: 'Pedido del prestador', ...body })
      const forzado = await forzar({})
      out.forzar = [forzado.status, forzado.input.adminId, forzado.input.clienteNombre, resumen(await forzar({ precioFinal: 'abc' })), resumen(await forzar({ motivoForzado: 'no' })), resumen(await forzar({ adminId: 'otro-admin' })), resumen(await forzar({ prestadorId: 'a b' }))]
      const switches = (body) => pedir('admin', 'PUT', '/tus/v1/admin/prestadores/perfil-1/turnos-switches', body)
      out.switches = [(await switches({ aceptaTurnos: false })).status, resumen(await switches({ aceptaTurnos: 'false' })), resumen(await switches({})), resumen(await switches({ aceptaTurnos: true, verificado: true }))]
      // The same routes are closed to a session that is not the administration.
      out.sinPermiso = [(await pedir('prestador', 'PATCH', '/tus/v1/admin/turnos/res-1/precio', { precioFinal: 1, motivo: 'Acordado con el cliente' })).status, (await pedir('nadie', 'POST', '/tus/v1/prestador/turnos/manual', {})).status]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.manualValido, [201, 1, 'tenant-p', '1500', 45, 'María José Pérez-Gómez', true, 'cliente@example.com', 'Trae estudios'], 'a valid turno reaches the service normalized, for the tenant of the session')
  const campos = { precioDecimal: 'precioFinal', precioTexto: 'precioFinal', precioNegativo: 'precioFinal', precioEnorme: 'precioFinal', duracionTexto: 'duracionMinutos', duracionCero: 'duracionMinutos', inicioSinZona: 'inicio', inicioBasura: 'inicio', inicioLejano: 'inicio', finAntes: 'fin', nombreCorto: 'clienteNombre', nombreObjeto: 'clienteNombre', nombreLargo: 'clienteNombre', telefonoMalo: 'clienteTelefono', emailMalo: 'clienteEmail', notasLargas: 'notas', tenantAjeno: 'prestadorTenantId', estadoInterno: 'estado', oficioMalo: 'oficioId' }
  for (const [caso, campo] of Object.entries(campos)) assert.deepEqual(r.manualInvalido[caso], [400, campo, 0], `manual turno, ${caso}: 400 on ${campo}, nothing reaches the service`)
  assert.deepEqual(r.bloqueo, [201, 'tenant-p', 'Vacaciones', [400, 'fin', 0], [400, 'inicio', 0], [400, 'fin', 0], [400, 'motivo', 0], [400, 'prestadorTenantId', 0]])
  assert.deepEqual(r.config, [200, 'perfil-1', false, '2500', 'mixto'], 'the profile is the one of the session')
  const camposConfig = { booleanoTexto: 'turnosHabilitados', precioNegativo: 'precioBase', precioDecimal: 'precioBase', duracionDecimal: 'duracionMinutos', duracionEnorme: 'duracionMinutos', bufferNegativo: 'bufferMinutos', modalidadLibre: 'modalidad', perfilAjeno: 'perfilId', verificado: 'verified' }
  for (const [caso, campo] of Object.entries(camposConfig)) assert.deepEqual(r.configInvalida[caso], [400, campo, 0], `service configuration, ${caso}`)
  assert.deepEqual(r.tarifas.slice(0, 3), [200, 'Sesión completa', '3000'])
  for (const fila of r.tarifas.slice(3)) assert.deepEqual([fila[0], fila[2]], [400, 0], `an invalid tarifa list is refused: ${JSON.stringify(fila)}`)
  assert.deepEqual(r.estado, [200, [400, null, 0], [400, 'estado', 0], [400, 'motivo', 0], [400, 'precioFinal', 0]], 'only the states a provider may set, a bounded reason, nothing else')
  assert.deepEqual(r.precio, [200, '1800', 'cuenta-admin', [400, 'precioFinal', 0], [400, 'precioFinal', 0], [400, 'precioFinal', 0], [400, 'precioFinal', 0], [400, 'motivo', 0], [400, 'adminId', 0]], 'the administrator is the session, never the body')
  assert.deepEqual(r.forzar, [201, 'cuenta-admin', "Sofía O'Connor", [400, 'precioFinal', 0], [400, null, 0], [400, 'adminId', 0], [400, null, 0]])
  assert.deepEqual(r.switches, [200, [400, 'aceptaTurnos', 0], [400, 'aceptaTurnos', 0], [400, 'verificado', 0]])
  assert.deepEqual(r.sinPermiso, [403, 401])
})
