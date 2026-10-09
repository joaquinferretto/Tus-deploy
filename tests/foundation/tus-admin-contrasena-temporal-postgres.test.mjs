import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { turnosPagosSetup } from './fixtures/turnos-pagos-pg.mjs'

// ADMIN-CONTRASENA-TEMPORAL-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_PERFIL_TURNOS_PG_URL): the real identity store, the real sessions and the real turnos.
const url = process.env.TUS_PERFIL_TURNOS_PG_URL
const skip = !url && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)'
// The statement of the migration that classifies the accounts that already existed.
const RELLENO = /UPDATE public\."Account"[\s\S]*?;/u.exec(readFileSync(join(root, 'apps/api/prisma/migrations/20261120100000_tus_cuenta_origen_contrasena_temporal/migration.sql'), 'utf8'))[0]

test('CONTRASEÑA TEMPORAL PostgreSQL: the origin and the obligation are stored on the account; the temporary password closes the stored sessions and is kept only as a hash; the client keeps its account, its turno and its tenant; the migration classifies existing accounts from the audit only, and the database refuses any other origin', { skip, timeout: 600000 }, () => {
  const r = runTypeScriptScenario(`${turnosPagosSetup(url)}
    const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
    const out = {}
    try {
      const estricto = new DurableIdentitySessionResolver(auth.store)
      const soloPendientes = new DurableIdentitySessionResolver(auth.store, undefined, 'solo-pendientes')
      const administrador = await cliente('administrador')
      const fila = (id) => prisma.account.findUnique({ where: { id } })
      const sesionesAbiertas = (id) => prisma.session.count({ where: { accountId: id, revokedAt: null } })
      const entrar = async (email, password) => { const x = await auth.service.signIn({ email, password }); return x.ok ? { token: x.session.accessToken, debeCambiar: x.mustChangePassword === true } : { code: x.code } }

      // A client the administration creates, with a turno of its own.
      const email = run + '-rosa@example.com'
      const INICIAL = 'clave inicial cargada por admin 1'
      const creada = await auth.service.createAccountAsAdmin({ actorId: administrador.id, email, password: INICIAL, displayName: 'Rosa Cliente' })
      const rosa = creada.account
      out.creada = [creada.ok, (await fila(rosa.id)).origin, (await fila(rosa.id)).mustChangePassword, (await fila(administrador.id)).origin]
      await auth.service.updateAccountAsAdmin({ actorId: administrador.id, accountId: rosa.id, emailVerified: true, reason: 'Email confirmado en persona' })
      const p = await prestador('ct', 'Contraseña ' + run, [['Masaje', 30000]])
      const turno = await turnos.solicitarTurno({ prestadorId: p.perfilId, oficioId: oficio.id, inicio: a(2, '10:00'), tarifaId: p.tarifas['Masaje'], clienteId: rosa.id, clienteTenantId: rosa.tenantId })
      const reservaAntes = await prisma.reserva.findUnique({ where: { id: turno.id } })
      const s1 = await entrar(email, INICIAL)
      out.antes = [Boolean(await estricto.resolve(s1.token, 'c')), await sesionesAbiertas(rosa.id)]

      // The temporary password.
      const TEMPORAL = 'temporal entregada en mano 77'
      const puesta = await auth.service.setTemporaryPasswordAsAdmin({ actorId: administrador.id, accountId: rosa.id, password: TEMPORAL, reason: 'Cliente cargado para turnos: pide entrar a su cuenta' })
      const credencial = await prisma.passwordCredential.findUnique({ where: { accountId: rosa.id } })
      out.puesta = [puesta.ok, puesta.generatedPassword, (await fila(rosa.id)).mustChangePassword, await sesionesAbiertas(rosa.id), await estricto.resolve(s1.token, 'c'), credencial.passwordHash.includes(TEMPORAL), credencial.status, await prisma.passwordCredential.count({ where: { accountId: rosa.id } })]
      const s2 = await entrar(email, TEMPORAL)
      const pendiente = await soloPendientes.resolve(s2.token, 'c')
      out.primerIngreso = [s2.debeCambiar, await estricto.resolve(s2.token, 'c'), pendiente?.passwordChangeRequired, pendiente?.permissions]
      const PROPIA = 'mi frase propia y bien larga 2026'
      const cambio = await auth.service.changePassword({ actorId: rosa.id, currentPassword: TEMPORAL, newPassword: PROPIA })
      const s3 = await entrar(email, PROPIA)
      out.despues = [cambio.ok, (await fila(rosa.id)).mustChangePassword, await sesionesAbiertas(rosa.id), s3.debeCambiar, Boolean(await estricto.resolve(s3.token, 'c')), (await entrar(email, TEMPORAL)).code]
      // The same account: its turno, its tenant, one account for that email.
      const reservaDespues = await prisma.reserva.findUnique({ where: { id: turno.id } })
      const final = await fila(rosa.id)
      out.mismaCuenta = [reservaDespues.clienteId === rosa.id, reservaDespues.clienteId === reservaAntes.clienteId, reservaDespues.estado === reservaAntes.estado, final.tenantId === rosa.tenantId, final.origin, await prisma.user.count({ where: { normalizedEmail: email } }), await prisma.account.count({ where: { user: { normalizedEmail: email } } })]
      // The audit of the administration: no password, no hash.
      const eventos = await prisma.auditEvent.findMany({ where: { actorId: administrador.id } })
      const propios = eventos.filter((e) => e.metadata?.action === 'temporary_password_set')
      out.auditoria = [propios.length, propios[0]?.eventType, propios[0]?.metadata.targetAccountId === rosa.id, propios[0]?.metadata.reason, [TEMPORAL, PROPIA, INICIAL, credencial.passwordHash].some((secreto) => JSON.stringify(eventos).includes(secreto))]
      // An account a person registered is not reachable.
      const propia = await cliente('propia')
      out.cuentaPropia = [(await auth.service.setTemporaryPasswordAsAdmin({ actorId: administrador.id, accountId: propia.id, password: TEMPORAL, reason: 'no corresponde a esta cuenta' })).message, (await fila(propia.id)).mustChangePassword]

      // ---- The migration: existing accounts are classified by the audit of their creation only.
      const vieja = await cliente('vieja')
      const sinRegistro = await cliente('sin-registro')
      await prisma.account.update({ where: { id: rosa.id }, data: { origin: 'self' } })
      await prisma.auditEvent.create({ data: { id: run + '-audit-vieja', tenantId: vieja.tenantId, actorId: administrador.id, correlationId: 'c', eventType: 'account.admin_created', outcome: 'success', metadata: { targetAccountId: vieja.id, action: 'created' }, occurredAt: new Date() } })
      await db.query(${JSON.stringify(RELLENO)})
      out.relleno = [(await fila(vieja.id)).origin, (await fila(rosa.id)).origin, (await fila(sinRegistro.id)).origin, (await fila(administrador.id)).origin]
      out.restriccion = await sqlError('UPDATE public."Account" SET "origin" = $1 WHERE "id" = $2', ['otro', sinRegistro.id])
    } finally { await cerrar() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.creada, [true, 'admin', false, 'self'])
  assert.deepEqual(r.antes, [true, 1])
  assert.deepEqual(r.puesta, [true, null, true, 0, null, false, 'active', 1], 'stored: the obligation on the account, every session revoked, one credential holding a hash')
  assert.deepEqual(r.primerIngreso, [true, null, true, []])
  assert.deepEqual(r.despues, [true, false, 1, false, true, 'INVALID_CREDENTIALS'], 'chosen: no obligation, only the new session is open, the temporary password is dead')
  assert.deepEqual(r.mismaCuenta, [true, true, true, true, 'admin', 1, 1], 'the same account, the same turno, the same tenant: nothing duplicated')
  assert.deepEqual(r.auditoria, [1, 'account.admin_updated', true, 'Cliente cargado para turnos: pide entrar a su cuenta', false])
  assert.deepEqual(r.cuentaPropia, ['NOT_ADMIN_CREATED', false])
  assert.deepEqual(r.relleno, ['admin', 'admin', 'self', 'self'], 'classified by the audit of its creation (the first event of rosa is real); no record: "self"')
  assert.equal(r.restriccion, 'ck_account_origin')
})
