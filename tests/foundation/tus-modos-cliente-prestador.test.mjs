import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// MODOS-01 (docs/MODOS_CLIENTE_PRESTADOR_TUS.md): one account, two ways of using TUS. The modes
// are derived by the server from the real provider state; a stored or a sent mode grants nothing.
// In memory. The PostgreSQL side is in tus-modos-cliente-prestador-postgres.test.mjs.

test('MODOS resolución: every account is a client; only an APPROVED provider also has the provider mode; a stored mode is a preference that is ignored as soon as it is not valid', () => {
  const r = runTypeScriptScenario(`
    const m = await import('./apps/api/src/auth-security/modes/modos.ts')
    const de = (estadoPrestador, activeMode = null, lastMode = null) => { const x = m.resolverModos({ estadoPrestador, activeMode, lastMode }); return [x.availableModes.join('+'), x.activeMode, x.providerStatus, x.modeNotice ?? null] }
    console.log(JSON.stringify({
      estado: [m.estadoPrestadorDeCuenta(null), m.estadoPrestadorDeCuenta(undefined), m.estadoPrestadorDeCuenta({ status: 'approved' }), m.estadoPrestadorDeCuenta({ status: 'suspended' }), m.estadoPrestadorDeCuenta({ status: 'pending' }), m.estadoPrestadorDeCuenta({ status: 'rejected' }), m.estadoPrestadorDeCuenta({})],
      soloCliente: [de('none'), de('none', 'PROVIDER'), de('none', null, 'PROVIDER'), de('none', 'CLIENT')],
      aprobado: [de('approved'), de('approved', null, 'PROVIDER'), de('approved', null, 'CLIENT'), de('approved', 'PROVIDER', 'CLIENT'), de('approved', 'CLIENT', 'PROVIDER')],
      suspendido: [de('suspended'), de('suspended', 'PROVIDER', 'PROVIDER'), de('suspended', null, 'PROVIDER'), de('suspended', 'CLIENT')],
      basura: [de('approved', 'ADMIN', 'ROOT'), de('approved', { mode: 'PROVIDER' }, 7), de('none', 'ADMIN')],
    }))
  `)
  assert.deepEqual(r.estado, ['none', 'none', 'approved', 'suspended', 'suspended', 'suspended', 'suspended'], 'only exactly "approved" is an enabled provider; any other state of an existing provider is not')
  assert.deepEqual(r.soloCliente, [['CLIENT', 'CLIENT', 'none', null], ['CLIENT', 'CLIENT', 'none', 'provider_unavailable'], ['CLIENT', 'CLIENT', 'none', null], ['CLIENT', 'CLIENT', 'none', null]], 'an account without a provider is a client, whatever is stored')
  assert.deepEqual(r.aprobado, [['CLIENT+PROVIDER', null, 'approved', null], ['CLIENT+PROVIDER', 'PROVIDER', 'approved', null], ['CLIENT+PROVIDER', 'CLIENT', 'approved', null], ['CLIENT+PROVIDER', 'PROVIDER', 'approved', null], ['CLIENT+PROVIDER', 'CLIENT', 'approved', null]], 'an approved provider chooses (null) unless the session or the last mode say which')
  assert.deepEqual(r.suspendido, [['CLIENT', 'CLIENT', 'suspended', null], ['CLIENT', 'CLIENT', 'suspended', 'provider_unavailable'], ['CLIENT', 'CLIENT', 'suspended', null], ['CLIENT', 'CLIENT', 'suspended', null]], 'a suspended provider is a client only; a session that was a provider falls back with a notice')
  assert.deepEqual(r.basura, [['CLIENT+PROVIDER', null, 'approved', null], ['CLIENT+PROVIDER', null, 'approved', null], ['CLIENT', 'CLIENT', 'none', null]], 'anything that is not a mode is not a mode')
})

const APP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const m = await import('./apps/api/src/auth-security/modes/modos.ts')
  // The real state: the test changes it like the administration would.
  const PRESTADORES = { 't-joaquin': { status: 'approved' }, 't-suspendida': { status: 'suspended' } }
  const estadoPrestador = async (context) => m.estadoPrestadorDeCuenta(PRESTADORES[context.tenantId] ?? null)
  const almacen = new m.AlmacenModosEnMemoria()
  const servicio = new m.ServicioModos(almacen, estadoPrestador)
  const sesion = (token, cuenta, tenant) => [token, { subjectId: cuenta, tenantId: tenant, sessionId: 'ses-' + token, roles: ['owner'], permissions: ['tus:checkout', 'tus:marketplace:read', 'tus:read', 'tus:marketplace:write'], correlationId: 'c' }]
  const SESIONES = new Map([sesion('ana', 'ana', 't-ana'), sesion('joaquin', 'joaquin', 't-joaquin'), sesion('joaquin-2', 'joaquin', 't-joaquin'), sesion('suspendida', 'sus', 't-suspendida')])
  // A suspended ACCOUNT has no session at all: its token resolves to nothing.
  const sessions = { resolve: async (token) => SESIONES.get(token) ?? null }
  const llegaron = []
  const app = express()
  app.use(express.json())
  app.use(m.createProviderSuspensionGuard({ sessions, estadoPrestador }))
  app.use(m.createModeRouter({ servicio, sessions }))
  // Stand-ins for the provider surface and for a client operation: they only record that they ran.
  app.all(/^\\/tus\\/.*/u, (req, res) => { llegaron.push(req.method + ' ' + req.path); res.status(200).json({ ok: true }) })
  const server = app.listen(0)
  const base = 'http://127.0.0.1:' + server.address().port
  const pedir = async (token, method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'c', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const json = await r.json().catch(() => ({}))
    return { status: r.status, code: json.error?.code ?? json.code ?? null, json }
  }
  const modo = (token, body) => pedir(token, 'POST', '/auth/session/mode', body)
  const ver = async (token) => { const x = await servicio.deSesion(SESIONES.get(token)); return [x.availableModes.join('+'), x.activeMode, x.providerStatus, x.modeNotice ?? null] }
`

test('MODOS sesión y cambio (API): a client cannot become a provider by asking; an approved provider switches both ways in the same session; suspension and reactivation move only the provider side; unknown fields and identities in the body are refused', () => {
  const r = runTypeScriptScenario(`${APP}
    const out = {}
    try {
      // ---- A plain account.
      out.cliente = [await ver('ana'), (await modo('ana', { mode: 'CLIENT' })).status, [(await modo('ana', { mode: 'PROVIDER' })).status, (await modo('ana', { mode: 'PROVIDER' })).code], await ver('ana')]
      // ---- An approved provider: asked to choose, then switches, in the same session.
      out.eleccion = await ver('joaquin')
      const aPrestador = await modo('joaquin', { mode: 'PROVIDER' })
      out.aPrestador = [aPrestador.status, aPrestador.json.activeMode, aPrestador.json.availableModes, await ver('joaquin')]
      const aCliente = await modo('joaquin', { mode: 'CLIENT' })
      out.aCliente = [aCliente.status, aCliente.json.activeMode, await ver('joaquin')]
      await modo('joaquin', { mode: 'PROVIDER' })
      // Another session of the same account: starts from the last mode, and then keeps its own.
      out.otraSesion = [await ver('joaquin-2'), (await modo('joaquin-2', { mode: 'CLIENT' })).status, await ver('joaquin-2'), await ver('joaquin')]
      out.guardado = [almacen.sesiones.get('joaquin|ses-joaquin'), almacen.sesiones.get('joaquin|ses-joaquin-2'), almacen.cuentas.get('joaquin')]

      // ---- Input.
      out.entrada = [
        await modo('joaquin', { mode: 'ADMIN' }), await modo('joaquin', { mode: 'provider' }), await modo('joaquin', {}), await modo('joaquin', { mode: ['PROVIDER'] }),
        await modo('joaquin', { mode: 'PROVIDER', accountId: 'ana' }), await modo('joaquin', { mode: 'CLIENT', tenantId: 't-ana' }), await modo('ana', { mode: 'CLIENT', role: 'admin', permissions: ['tus:providers:admin'] }),
        await modo(null, { mode: 'CLIENT' }), await modo('cuenta-suspendida', { mode: 'CLIENT' }),
      ].map((x) => [x.status, x.code])
      // A mode sent by hand grants nothing: ana still has no provider mode and the provider surface
      // of a real client is decided by each route (here it simply ran: the guard only stops a SUSPENDED provider).
      await almacen.fijarSesion('ses-ana', 'ana', 'PROVIDER'); await almacen.fijarPreferencia('ana', 'PROVIDER')
      out.manipulado = await ver('ana')

      // ---- The administration suspends the provider while it is working as a provider.
      await modo('joaquin', { mode: 'PROVIDER' })
      PRESTADORES['t-joaquin'].status = 'suspended'
      out.suspendidoEnSesion = [await ver('joaquin'), [(await modo('joaquin', { mode: 'PROVIDER' })).status, (await modo('joaquin', { mode: 'PROVIDER' })).json.providerStatus], (await modo('joaquin', { mode: 'CLIENT' })).status]
      const antes = llegaron.length
      out.guardSuspendido = [
        await pedir('joaquin', 'POST', '/tus/v1/prestador/turnos/abc/aceptar', {}), await pedir('joaquin', 'POST', '/tus/v1/prestador/solicitudes/abc/postular', {}), await pedir('joaquin', 'PUT', '/tus/v1/prestador/perfil-publico', {}),
        await pedir('joaquin', 'POST', '/tus/v1/provider/earnings/payouts', {}), await pedir('joaquin', 'POST', '/tus/v1/work/commitments/c1/accept', {}), await pedir('joaquin', 'POST', '/tus/work/commitments/c1/accept', {}),
      ].map((x) => [x.status, x.code])
      out.nadaLlego = llegaron.length === antes
      // The same person as a client, and the history of the provider: untouched.
      out.sigueComoCliente = [
        await pedir('joaquin', 'POST', '/tus/v1/solicitudes', {}), await pedir('joaquin', 'POST', '/tus/v1/prestadores/otro/turnos/solicitudes', {}), await pedir('joaquin', 'POST', '/tus/v1/work/w1/budgets/1/accept', {}),
        await pedir('joaquin', 'GET', '/tus/v1/prestador/turnos'), await pedir('joaquin', 'GET', '/tus/v1/provider/earnings/history'),
      ].map((x) => x.status)
      // Nobody else is affected, and without a session the route itself answers.
      out.otros = [(await pedir('ana', 'POST', '/tus/v1/prestador/solicitudes/abc/postular', {})).status, (await pedir(null, 'POST', '/tus/v1/prestador/turnos/abc/aceptar', {})).status]
      // ---- Reactivation: the provider mode is back, with the same account and session.
      PRESTADORES['t-joaquin'].status = 'approved'
      out.reactivado = [await ver('joaquin'), (await modo('joaquin', { mode: 'PROVIDER' })).status, await ver('joaquin'), (await pedir('joaquin', 'POST', '/tus/v1/prestador/turnos/abc/aceptar', {})).status]
      // A new sign-in after a suspension: the last mode says PROVIDER, the session is a client.
      PRESTADORES['t-joaquin'].status = 'suspended'
      SESIONES.set('joaquin-3', { ...SESIONES.get('joaquin'), sessionId: 'ses-joaquin-3' })
      out.loginTrasSuspension = [almacen.cuentas.get('joaquin'), await ver('joaquin-3')]
      // An account that was always suspended as a provider.
      out.siempreSuspendida = [await ver('suspendida'), (await modo('suspendida', { mode: 'PROVIDER' })).status]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.cliente, [['CLIENT', 'CLIENT', 'none', null], 200, [403, 'MODE_NOT_AVAILABLE'], ['CLIENT', 'CLIENT', 'none', null]], 'a plain account is a client and cannot activate the provider mode')
  assert.deepEqual(r.eleccion, ['CLIENT+PROVIDER', null, 'approved', null], 'an approved provider without a preference is asked how to use TUS')
  assert.deepEqual(r.aPrestador, [200, 'PROVIDER', ['CLIENT', 'PROVIDER'], ['CLIENT+PROVIDER', 'PROVIDER', 'approved', null]])
  assert.deepEqual(r.aCliente, [200, 'CLIENT', ['CLIENT+PROVIDER', 'CLIENT', 'approved', null]], 'and back, in the same session')
  assert.deepEqual(r.otraSesion, [['CLIENT+PROVIDER', 'PROVIDER', 'approved', null], 200, ['CLIENT+PROVIDER', 'CLIENT', 'approved', null], ['CLIENT+PROVIDER', 'PROVIDER', 'approved', null]], 'a new session starts in the last mode; each session then keeps its own')
  assert.deepEqual(r.guardado, ['PROVIDER', 'CLIENT', 'CLIENT'], 'the mode lives in the session; the preference in the account')
  assert.deepEqual(r.entrada, [[422, 'INVALID_MODE'], [422, 'INVALID_MODE'], [422, 'INVALID_MODE'], [422, 'INVALID_MODE'], [422, 'INVALID_REQUEST'], [422, 'INVALID_REQUEST'], [422, 'INVALID_REQUEST'], [401, 'UNAUTHORIZED'], [401, 'UNAUTHORIZED']], 'a closed body; no account, tenant, role or permission from it; a suspended account has no session')
  assert.deepEqual(r.manipulado, ['CLIENT', 'CLIENT', 'none', 'provider_unavailable'], 'a provider mode written by hand is ignored')
  assert.deepEqual(r.suspendidoEnSesion, [['CLIENT', 'CLIENT', 'suspended', 'provider_unavailable'], [403, 'suspended'], 200], 'suspended while working as a provider: the next resolution is a client, with a notice')
  assert.deepEqual(r.guardSuspendido, Array(6).fill([403, 'PROVIDER_SUSPENDED']), 'a suspended provider cannot write on the provider surface nor take new work')
  assert.equal(r.nadaLlego, true)
  assert.deepEqual(r.sigueComoCliente, [200, 200, 200, 200, 200], 'the same person keeps operating as a client and reading its provider history')
  assert.deepEqual(r.otros, [200, 200], 'the guard only stops a suspended provider')
  assert.deepEqual(r.reactivado, [['CLIENT+PROVIDER', 'CLIENT', 'approved', null], 200, ['CLIENT+PROVIDER', 'PROVIDER', 'approved', null], 200], 'approved again: the provider mode is available again, same account, same session')
  assert.deepEqual(r.loginTrasSuspension, ['PROVIDER', ['CLIENT', 'CLIENT', 'suspended', null]], 'a last mode that is no longer valid is ignored at the next sign-in')
  assert.deepEqual(r.siempreSuspendida, [['CLIENT', 'CLIENT', 'suspended', null], 403])
})
