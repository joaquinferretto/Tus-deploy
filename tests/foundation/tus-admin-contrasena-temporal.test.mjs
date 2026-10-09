import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ADMIN-CONTRASENA-TEMPORAL-01. The administration sets a TEMPORARY password on an account IT
// created (a client loaded to manage its turnos), so that person can enter its own account. The
// real auth service (its canonical hasher, its sessions, its audit), the real session resolvers
// and the real admin router; the identity store is the in-memory one.
const read = (file) => readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n')

const SETUP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  const { crearRouterAdmin } = await import('./apps/api/src/tus/admin/http.ts')
  const { CuentasAdminEnMemoria, ActividadAdminEnMemoria } = await import('./apps/api/src/tus/admin/fuentes.ts')
  const identityStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: identityStore, platformAdminEmails: ['admin@example.com'] }), store: identityStore }
  const PASSWORD = 'una frase larga y segura 2026'
  async function cuenta(email, displayName) {
    const created = await auth.service.register({ email, password: PASSWORD, displayName })
    await auth.service.verifyEmail({ token: auth.email.messages.filter((m) => m.email === email && m.kind === 'verification').at(-1).token })
    return created.account
  }
  const adminAccount = await cuenta('admin@example.com', 'Admin TUS')
  const admin = { subjectId: adminAccount.id, tenantId: adminAccount.tenantId, sessionId: 's', roles: ['owner'], permissions: ['tus:providers:admin', 'tus:identity:admin'], correlationId: 'c' }
  // The administration session (MFA-elevated: it carries the identity-admin permission), one with
  // no such permission, and one of a plain client.
  const sessions = { resolve: async (token) => token === 'admin' ? admin : token === 'admin-sin-mfa' ? { ...admin, permissions: ['tus:providers:admin'] } : token === 'client' ? { ...admin, subjectId: 'x', permissions: ['tus:marketplace:write'] } : null }
  const vacio = { perfilDeTenantAdmin: async () => null }
  const app = express(); app.use(express.json())
  app.use(crearRouterAdmin({
    sessions, directorio: vacio, solicitudes: {},
    cuentas: new CuentasAdminEnMemoria(identityStore),
    actividad: new ActividadAdminEnMemoria(() => auth.audit.events),
    adminEmails: () => ['admin@example.com'],
    crearUsuario: (input) => auth.service.createAccountAsAdmin(input),
    actualizarUsuario: (input) => auth.service.updateAccountAsAdmin(input),
    leerUsuario: (id) => auth.service.getAccountAsAdmin(id),
    accionUsuario: (input) => auth.service.adminAccountAction(input),
    contrasenaTemporal: (input) => auth.service.setTemporaryPasswordAsAdmin(input),
  }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const call = async (method, path, body, token = 'admin') => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { method, headers: { authorization: 'Bearer ' + token, 'x-correlation-id': 'c', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, text, cache: response.headers.get('cache-control') }
  }
  // The resolvers the server composes: every router of TUS, and the authentication router.
  const estricto = new DurableIdentitySessionResolver(identityStore)
  const soloPendientes = new DurableIdentitySessionResolver(identityStore, undefined, 'solo-pendientes')
  const enTus = async (token) => Boolean(await estricto.resolve(token, 'c'))
  const enAuth = async (token) => (await estricto.resolve(token, 'c')) ?? (await soloPendientes.resolve(token, 'c'))
  const activas = (accountId) => [...identityStore.sessions.values()].filter((s) => s.accountId === accountId && s.revokedAt === null).length
  const entrar = async (email, password) => { const x = await auth.service.signIn({ email, password }); return x.ok ? { token: x.session.accessToken, debeCambiar: x.mustChangePassword === true } : { code: x.code } }
  const credencialDe = (accountId) => [...identityStore.credentials.values()].find((c) => c.accountId === accountId)
  const ruta = (id) => '/tus/v1/admin/usuarios/' + id + '/contrasena-temporal'
  const MOTIVO = 'Cliente cargado para turnos: pide entrar a su cuenta'
`

test('CONTRASEÑA TEMPORAL por Admin: an account the administration created gets a temporary password (hashed with the canonical hasher, never stored or audited in clear); its sessions are closed; its first sign-in can do nothing but choose its own password; afterwards it signs in normally; the same account all along; an account a person registered is not reachable; permission, note and policy are enforced', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    try {
      // ---- A client created from Admin -> Usuarios, and one registered by itself.
      const INICIAL = 'clave inicial cargada por admin 1'
      const alta = await call('POST', '/tus/v1/admin/usuarios', { email: 'rosa@example.com', password: INICIAL, displayName: 'Rosa Cliente' })
      const rosa = [...identityStore.accounts.values()].find((a) => a.email === 'rosa@example.com')
      const propia = await cuenta('carla@example.com', 'Carla Propia')
      const detalleRosa = (await call('GET', '/tus/v1/admin/usuarios/' + rosa.id)).body
      out.origen = [alta.status, detalleRosa.origen, detalleRosa.debeCambiarContrasena, (await call('GET', '/tus/v1/admin/usuarios/' + propia.id)).body.origen, (await call('GET', '/tus/v1/admin/usuarios/' + adminAccount.id)).body.origen]
      // The administration vouches for its email (an existing action), and the person signs in.
      await call('PATCH', '/tus/v1/admin/usuarios/' + rosa.id, { emailVerified: true, reason: 'Email confirmado en persona' })
      const s1 = await entrar('rosa@example.com', INICIAL)
      out.antes = [s1.debeCambiar, await enTus(s1.token), activas(rosa.id)]
      const cuentasAntes = identityStore.accounts.size
      const hashAntes = credencialDe(rosa.id).passwordHash

      // ---- What is refused.
      const TEMPORAL = 'temporal entregada en mano 77'
      const pedir = (cuerpo, token = 'admin', id = rosa.id) => call('POST', ruta(id), cuerpo, token).then((x) => [x.status, x.body?.error?.code ?? null])
      out.rechazos = {
        sinMotivo: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL }),
        motivoCorto: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: 'ok' }),
        distintas: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL + 'x', motivo: MOTIVO }),
        debil: await pedir({ contrasena: 'corta', repetir: 'corta', motivo: MOTIVO }),
        sinContrasena: await pedir({ motivo: MOTIVO }),
        camposDeMas: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO, passwordHash: 'x' }),
        generarYContrasena: await pedir({ generar: true, contrasena: TEMPORAL, motivo: MOTIVO }),
        adminSinPermiso: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO }, 'admin-sin-mfa'),
        cliente: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO }, 'client'),
        sinSesion: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO }, 'nadie'),
        cuentaPropia: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO }, 'admin', propia.id),
        elMismoAdmin: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO }, 'admin', adminAccount.id),
        inexistente: await pedir({ contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO }, 'admin', 'no-existe'),
      }
      out.nadaCambio = [credencialDe(rosa.id).passwordHash === hashAntes, await enTus(s1.token), (await entrar('carla@example.com', PASSWORD)).debeCambiar, identityStore.accounts.get(propia.id).mustChangePassword === true]

      // ---- The temporary password is set.
      const hecho = await call('POST', ruta(rosa.id), { contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO })
      const credencial = credencialDe(rosa.id)
      out.establecida = [hecho.status, hecho.body, hecho.cache, credencial.passwordHash !== hashAntes, credencial.passwordHash.includes(TEMPORAL), credencial.status, (await call('GET', '/tus/v1/admin/usuarios/' + rosa.id)).body.debeCambiarContrasena]
      out.sesionesCerradas = [await enTus(s1.token), await enAuth(s1.token), activas(rosa.id)]
      out.claveAnterior = (await entrar('rosa@example.com', INICIAL)).code
      // ---- First sign-in: the session exists, but only to choose a password.
      const s2 = await entrar('rosa@example.com', TEMPORAL)
      const pendiente = await enAuth(s2.token)
      out.primerIngreso = [s2.debeCambiar, await enTus(s2.token), pendiente?.passwordChangeRequired === true, pendiente?.subjectId === rosa.id, pendiente?.roles, pendiente?.permissions]
      const PROPIA = 'mi frase propia y bien larga 2026'
      out.cambioMalo = [(await auth.service.changePassword({ actorId: rosa.id, currentPassword: 'no es la temporal', newPassword: PROPIA })).ok, (await auth.service.changePassword({ actorId: rosa.id, currentPassword: TEMPORAL, newPassword: 'corta' })).ok, identityStore.accounts.get(rosa.id).mustChangePassword]
      const cambio = await auth.service.changePassword({ actorId: rosa.id, currentPassword: TEMPORAL, newPassword: PROPIA })
      out.cambio = [cambio.ok, identityStore.accounts.get(rosa.id).mustChangePassword, await enAuth(s2.token), activas(rosa.id), (await entrar('rosa@example.com', TEMPORAL)).code]
      // ---- Afterwards: a normal account again.
      const s3 = await entrar('rosa@example.com', PROPIA)
      out.despues = [s3.debeCambiar, await enTus(s3.token), (await soloPendientes.resolve(s3.token, 'c')) === null, (await call('GET', '/tus/v1/admin/usuarios/' + rosa.id)).body.debeCambiarContrasena]
      // ---- The same account all along: no other account, same ids.
      const final = identityStore.accounts.get(rosa.id)
      out.mismaCuenta = [identityStore.accounts.size === cuentasAntes, final.id === rosa.id, final.tenantId === rosa.tenantId, final.email, final.origin, [...identityStore.credentials.values()].filter((c) => c.accountId === rosa.id).length]

      // ---- A generated password: handed back once, never readable again.
      const generada = await call('POST', ruta(rosa.id), { generar: true, motivo: 'Olvidó su contraseña y vino al local' })
      const clave = generada.body.contrasenaTemporal
      const sg = await entrar('rosa@example.com', clave)
      out.generada = [generada.status, typeof clave, clave?.length, /^[A-HJ-NP-Za-km-z2-9]+$/u.test(clave ?? ''), sg.debeCambiar, await enTus(s3.token), JSON.stringify((await call('GET', '/tus/v1/admin/usuarios/' + rosa.id)).body).includes(clave), credencialDe(rosa.id).passwordHash.includes(clave)]

      // ---- An account the administration loaded WITHOUT a password (a managed provider): the same
      //      account becomes usable; no second account.
      const gestionada = await auth.service.createManagedProviderAccount({ email: 'taller@example.com', displayName: 'Taller Gestionado' })
      const antesGestionada = identityStore.accounts.size
      const sinClave = [(await call('GET', '/tus/v1/admin/usuarios/' + gestionada.accountId)).body.origen, credencialDe(gestionada.accountId) === undefined]
      const puesta = await call('POST', ruta(gestionada.accountId), { contrasena: TEMPORAL, repetir: TEMPORAL, motivo: MOTIVO })
      const sinVerificar = (await entrar('taller@example.com', TEMPORAL)).code
      await call('PATCH', '/tus/v1/admin/usuarios/' + gestionada.accountId, { emailVerified: true, reason: 'Email confirmado en persona' })
      const sm = await entrar('taller@example.com', TEMPORAL)
      out.gestionada = [sinClave, puesta.status, Boolean(credencialDe(gestionada.accountId)), sinVerificar, sm.debeCambiar, identityStore.accounts.size === antesGestionada, identityStore.accounts.get(gestionada.accountId).tenantId === gestionada.tenantId]

      // ---- The audit: who, on whom, why; never a password nor a hash.
      const eventos = auth.audit.events.filter((e) => e.metadata?.action === 'temporary_password_set')
      const todo = JSON.stringify(auth.audit.events)
      out.auditoria = [eventos.length, eventos.map((e) => [e.kind, e.actorId === adminAccount.id, e.metadata.targetAccountId === rosa.id || e.metadata.targetAccountId === gestionada.accountId, e.metadata.reason, e.metadata.sessionsRevoked, e.metadata.mustChangePassword, e.metadata.generated, typeof e.occurredAt]), [TEMPORAL, PROPIA, INICIAL, clave].some((secreto) => todo.includes(secreto)), [...identityStore.credentials.values()].some((c) => todo.includes(c.passwordHash))]
      // ---- A normal account keeps exactly what it had: the recovery email, sent to its owner.
      const recuperacion = await call('POST', '/tus/v1/admin/usuarios/' + propia.id + '/acciones', { action: 'password_reset' })
      out.cuentaNormal = [recuperacion.status, auth.email.messages.some((m) => m.email === 'carla@example.com' && m.kind === 'recovery'), identityStore.accounts.get(propia.id).mustChangePassword === true, (await entrar('carla@example.com', PASSWORD)).debeCambiar]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.origen, [201, 'admin', false, 'self', 'self'], 'created from Admin: origin "admin"; registered by the person (the administrator too): "self"')
  assert.deepEqual(r.antes, [false, true, 1])
  assert.deepEqual(r.rechazos, {
    sinMotivo: [422, 'REASON_REQUIRED'], motivoCorto: [422, 'REASON_REQUIRED'], distintas: [422, 'PASSWORD_MISMATCH'], debil: [422, 'WEAK_PASSWORD'], sinContrasena: [422, 'PASSWORD_MISMATCH'],
    camposDeMas: [422, 'INVALID_CHANGE'], generarYContrasena: [422, 'INVALID_CHANGE'], adminSinPermiso: [403, 'FORBIDDEN'], cliente: [403, 'FORBIDDEN'], sinSesion: [401, 'UNAUTHORIZED'],
    cuentaPropia: [403, 'NOT_ADMIN_CREATED'], elMismoAdmin: [403, 'FORBIDDEN'], inexistente: [404, 'NOT_FOUND'],
  }, 'no note, a short note, two different passwords, a weak one, extra fields, no permission (no MFA elevation), an account a person registered, its own account: nothing changes')
  assert.deepEqual(r.nadaCambio, [true, true, false, false], 'a refused request changes no password and closes no session; a normal account gets no obligation')
  assert.deepEqual(r.establecida, [200, { done: true, debeCambiarContrasena: true }, 'no-store', true, false, 'active', true], 'set: a new hash (never the clear text), nothing of it in the answer, never cached')
  assert.deepEqual(r.sesionesCerradas, [false, null, 0], 'every session the account had is closed')
  assert.equal(r.claveAnterior, 'INVALID_CREDENTIALS', 'the previous password no longer works')
  assert.deepEqual(r.primerIngreso, [true, false, true, true, [], []], 'first sign-in: no router of TUS answers it; the authentication router sees it with no role and no permission, only to choose a password')
  assert.deepEqual(r.cambioMalo, [false, false, true], 'the temporary password is asked again, and the policy applies to the new one')
  assert.deepEqual(r.cambio, [true, false, null, 0, 'INVALID_CREDENTIALS'], 'chosen: the obligation is over, the sessions are closed and the temporary password is dead')
  assert.deepEqual(r.despues, [false, true, true, false], 'afterwards it signs in normally')
  assert.deepEqual(r.mismaCuenta, [true, true, true, 'rosa@example.com', 'admin', 1], 'the same account and tenant: no duplicate account, one credential')
  assert.deepEqual(r.generada, [200, 'string', 16, true, true, false, false, false], 'generated: 16 characters handed back once, never readable again, hashed; the open session is closed again')
  assert.deepEqual(r.gestionada, [['admin', true], 200, true, 'INVALID_CREDENTIALS', true, true, true], 'an account loaded with no password becomes usable (once its email or phone is verified): the same account')
  assert.equal(r.auditoria[0], 3)
  assert.deepEqual(r.auditoria[1][0], ['account.admin_updated', true, true, 'Cliente cargado para turnos: pide entrar a su cuenta', true, true, false, 'string'])
  assert.deepEqual([r.auditoria[1][1][3], r.auditoria[1][1][6]], ['Olvidó su contraseña y vino al local', true])
  assert.deepEqual(r.auditoria.slice(2), [false, false], 'no password and no hash anywhere in the audit')
  assert.deepEqual(r.cuentaNormal, [200, true, false, false], 'an account a person registered keeps its own way: the recovery email, to its owner')
})

test('CONTRASEÑA TEMPORAL, cableado, migración y pantallas: the route sits behind the identity-admin permission and takes a closed body; the server gives the pending account to the authentication router only; the migration is additive and takes the origin from the audit, never from a name; the Web forces the choice and shows a generated password once', () => {
  const http = read('apps/api/src/tus/admin/http.ts')
  const ruta = /router\.post\('\/tus\/v1\/admin\/usuarios\/:id\/contrasena-temporal'[\s\S]*?\n  \}\)\)/u.exec(http)[0]
  assert.match(ruta, /const context = await guard\(request, response, IDENTITY_ADMIN\)/u)
  assert.match(ruta, /const permitidos = new Set\(\['contrasena', 'repetir', 'generar', 'motivo'\]\)/u)
  assert.match(ruta, /actorId: context\.subjectId, accountId: String\(request\.params\['id'\] \?\? ''\)/u)
  assert.match(ruta, /response\.setHeader\('cache-control', 'no-store'\)/u)
  const servicio = read('apps/api/src/auth-security/application/auth-service.ts')
  const operacion = /async setTemporaryPasswordAsAdmin\([\s\S]*?\n  \}\n/u.exec(servicio)[0]
  assert.match(operacion, /if \(account\.origin !== 'admin'\) return failure\(AUTH_RESULT_CODE\.FORBIDDEN, 'NOT_ADMIN_CREATED'\)/u, 'never a way to take over an account a person registered')
  assert.match(operacion, /await this\.dependencies\.passwordHasher\.hash\(password\)/u, 'the canonical hasher of the sign-in')
  assert.match(operacion, /await store\.revokeSessions\(actual\.id, now\)/u)
  assert.doesNotMatch(/await this\.recordAdminAction\(input\.actorId, account, AUTH_EVENT_KIND\.ACCOUNT_ADMIN_UPDATED, \{[^}]*\}\)/u.exec(operacion)[0], /password(?!')\b[^,}]*:|passwordHash|\bpassword\b(?!')/u, 'neither the password nor its hash is audited')
  // One resolver decides for every router; only the authentication router sees a pending account.
  const resolver = read('apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  assert.match(resolver, /private readonly cambioPendiente: 'bloquear' \| 'solo-pendientes' = 'bloquear'/u)
  assert.match(resolver, /if \(pendiente\) return null/u)
  const servidor = read('apps/api/src/server.ts')
  assert.equal(servidor.split('sesionesConCambioPendiente').length - 1, 2, 'built once, used once: by the authentication router')
  assert.match(servidor, /createAuthRouter\(\{\s*service: auth\.service,[\s\S]{0,400}sessions: \{ resolve: async \(accessToken, correlationId\) => \(await sessions\.resolve\(accessToken, correlationId\)\) \?\? \(await sesionesConCambioPendiente\.resolve\(accessToken, correlationId\)\) \},/u)
  // Migration.
  const sql = read('apps/api/prisma/migrations/20261120100000_tus_cuenta_origen_contrasena_temporal/migration.sql').replace(/^--.*$/gmu, '')
  assert.match(sql, /ADD COLUMN "origin" text NOT NULL DEFAULT 'self'/u)
  assert.match(sql, /ADD COLUMN "mustChangePassword" boolean NOT NULL DEFAULT false/u)
  assert.match(sql, /"eventType" = 'account\.admin_created' AND e\."metadata"->>'targetAccountId' = a\."id"/u, 'the origin of existing accounts comes from the audit record of their creation')
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE|displayName|email/iu)
  assert.equal((sql.match(/\bUPDATE\b/gu) ?? []).length, 1, 'one statement fills the NEW column, nothing else is rewritten')
  // Web.
  const login = read('apps/web/src/features/auth/login-form.tsx')
  assert.match(login, /if \(await client\.passwordChangeRequired\(\)\) \{\s*window\.location\.assign\('\/elegir-contrasena'\)/u)
  const formulario = read('apps/web/src/features/auth/email-flows.tsx')
  assert.match(formulario, /chooseOwnPassword\(\{ currentPassword: temporal, newPassword: password \}\)/u)
  assert.match(read('apps/web/src/app/(auth)/elegir-contrasena/page.tsx'), /<ChooseOwnPasswordForm \/>/u)
  const admin = read('apps/web/src/components/admin/admin-usuario-detalle.tsx')
  assert.match(admin, /if \(cuenta\.origen !== 'admin'\)\s*return <p[^>]*data-contrasena-temporal="no-disponible"/u, 'not offered for an account a person registered')
  assert.match(admin, /Se muestra una sola vez\./u)
  assert.match(admin, /Motivo administrativo \(obligatorio\)/u)
  assert.doesNotMatch(admin, /localStorage|sessionStorage/u, 'a generated password is never kept by the Web')
  assert.match(admin, /overflowWrap: 'anywhere'/u)
})
