import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// AGENDA-MATRIZ-01 together with ADMIN-CONTRASENA-TEMPORAL-01, on a DISPOSABLE PostgreSQL 16 with
// every migration applied (TUS_PERFIL_TURNOS_PG_URL). A client the ADMINISTRATION created is linked
// by a provider to a manual turno, and later receives a temporary password: it is the same account
// all along — the turno stays on it, no account is created or duplicated, and once the person
// chooses its password it finds that turno among its own.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'

test('AGENDA + contraseña temporal PostgreSQL: a client created by the administration is found by its whole verified email only, linked to a manual turno (origin MANUAL), and keeps that same account and turno when the administration sets its temporary password and when it chooses its own; nothing is duplicated', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
    const out = {}
    try {
      const estricto = new DurableIdentitySessionResolver(auth.store)
      const administrador = await cliente('administrador')
      const p = await prestador('agadm', 'Agenda Admin ' + run, [['Masaje', 30000]])
      const email = run + '-rosa@example.com'
      const INICIAL = 'clave inicial cargada por admin 1'
      const rosa = (await auth.service.createAccountAsAdmin({ actorId: administrador.id, email, password: INICIAL, displayName: 'Rosa Cliente' })).account
      const fila = (id) => prisma.account.findUnique({ where: { id } })
      const cuentas = () => prisma.account.count({ where: { user: { normalizedEmail: email } } })
      const buscar = (criterio) => turnos.buscarClienteParaTurno({ prestadorTenantId: p.tenantId, ...criterio }).then((x) => x.map((c) => c.cuentaId), (e) => e.code)

      // An account whose email nobody verified is not offered; once verified, only its WHOLE email finds it.
      out.sinVerificar = await buscar({ email })
      await auth.service.updateAccountAsAdmin({ actorId: administrador.id, accountId: rosa.id, emailVerified: true, reason: 'Email confirmado en persona' })
      out.busqueda = [await buscar({ email }), await buscar({ email: email.slice(0, 8) }), (await fila(rosa.id)).origin]

      // The provider loads a manual turno for that client.
      const manual = await turnos.crearTurnoManual({ prestadorTenantId: p.tenantId, oficioId: oficio.id, inicio: a(3, '10:00'), clienteNombre: 'Rosa (nombre tipeado)', clienteCuentaId: rosa.id })
      const reserva = () => prisma.reserva.findUnique({ where: { id: manual.id } })
      const antes = await reserva()
      out.vinculado = [antes.clienteId === rosa.id, antes.esInvitado, antes.origen, antes.estado, antes.clienteNombre, await cuentas(), await prisma.user.count({ where: { normalizedEmail: email } })]

      // The administration sets a temporary password on that same account.
      const TEMPORAL = 'temporal entregada en mano 77'
      const puesta = await auth.service.setTemporaryPasswordAsAdmin({ actorId: administrador.id, accountId: rosa.id, password: TEMPORAL, reason: 'Cliente cargado para turnos: pide entrar a su cuenta' })
      const s1 = await auth.service.signIn({ email, password: TEMPORAL })
      const trasTemporal = await reserva()
      out.temporal = [puesta.ok, s1.ok && s1.mustChangePassword === true, await estricto.resolve(s1.session.accessToken, 'c'), trasTemporal.clienteId === rosa.id, trasTemporal.origen, trasTemporal.estado === antes.estado, trasTemporal.version === antes.version, await cuentas()]
      // While the password is pending the account can still be found and linked by a provider
      // (that is the provider's own action, on its own agenda): nothing of the account opens.
      out.pendienteSigueSiendoCuenta = await buscar({ email })

      // The person chooses its password and finds its turno.
      const PROPIA = 'mi frase propia y bien larga 2026'
      await auth.service.changePassword({ actorId: rosa.id, currentPassword: TEMPORAL, newPassword: PROPIA })
      const s2 = await auth.service.signIn({ email, password: PROPIA })
      const contexto = await estricto.resolve(s2.session.accessToken, 'c')
      const suyos = await turnos.turnosCliente(contexto.subjectId)
      const final = await reserva()
      out.despues = [contexto.subjectId === rosa.id, suyos.some((t) => t.id === manual.id), suyos.find((t) => t.id === manual.id)?.origen, final.clienteId === rosa.id, (await fila(rosa.id)).tenantId === rosa.tenantId, (await fila(rosa.id)).mustChangePassword, await cuentas()]
      // The provider's own account is never offered to itself, and an unknown account is refused.
      out.limites = [await turnos.crearTurnoManual({ prestadorTenantId: p.tenantId, oficioId: oficio.id, inicio: a(3, '12:00'), clienteNombre: 'Nadie', clienteCuentaId: 'cuenta-inexistente' }).then(() => 'none', (e) => e.code), await prisma.account.count({ where: { id: 'cuenta-inexistente' } })]
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinVerificar, [], 'an account nobody verified is not offered to a provider')
  assert.equal(r.busqueda[0].length, 1)
  assert.deepEqual(r.busqueda.slice(1), ['INVALID_PARAMS', 'admin'], 'only the whole email finds it; the account was created by the administration')
  assert.deepEqual(r.vinculado, [true, false, 'manual', 'confirmed', 'Rosa Cliente', 1, 1], 'linked to the EXISTING account (its own name, not the typed one): origin MANUAL, one account, one user')
  assert.deepEqual(r.temporal, [true, true, null, true, 'manual', true, true, 1], 'the temporary password touches nothing of the turno and creates no account')
  assert.equal(r.pendienteSigueSiendoCuenta.length, 1)
  assert.deepEqual(r.despues, [true, true, 'manual', true, true, false, 1], 'the same account: once it chose its password, the person finds that turno among its own')
  assert.deepEqual(r.limites, ['CLIENT_NOT_FOUND', 0], 'an account that does not exist is never linked nor created')
})
