import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Administración de plataforma: los permisos de admin NUNCA salen de roles ni de la Web. Solo una
// sesión de una cuenta con email VERIFICADO incluido en TUS_PLATFORM_ADMIN_EMAILS (variable del
// entorno de la API, nunca en el repositorio) los recibe al iniciar sesión.
const root = join(import.meta.dirname, '..', '..')

test('ADMIN: only an allowlisted verified email gets the platform permissions at sign-in', () => {
  const result = runTypeScriptScenario(`
    const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
    const { PLATFORM_ADMIN_PERMISSIONS, leerAdminsPlataforma, alcanceDeCuenta } = await import('./apps/api/src/auth-security/application/auth-service.ts')
    const admins = leerAdminsPlataforma(' Admin@Example.com , no-es-email, otra@example.com,admin@example.com ')
    const auth = createInMemoryAuthService({ now: () => Date.parse('2026-09-28T13:00:00.000Z'), platformAdminEmails: admins })
    const password = 'Contrasena-Segura-2026'
    async function cuenta(email, verify = true) {
      const registered = await auth.register({ email, password, displayName: 'Persona' })
      if (verify) await auth.verifyEmail({ token: registered.verificationToken })
      return registered
    }
    await cuenta('ADMIN@example.com')
    await cuenta('cliente@example.com')
    const unverified = await cuenta('otra@example.com', false)
    const admin = await auth.signIn({ email: 'admin@example.com', password })
    const client = await auth.signIn({ email: 'cliente@example.com', password })
    const pending = await auth.signIn({ email: 'otra@example.com', password })
    const noAllowlist = createInMemoryAuthService({ now: () => Date.parse('2026-09-28T13:00:00.000Z') })
    const r = await noAllowlist.register({ email: 'admin@example.com', password, displayName: 'X' })
    await noAllowlist.verifyEmail({ token: r.verificationToken })
    const withoutEnv = await noAllowlist.signIn({ email: 'admin@example.com', password })
    console.log(JSON.stringify({
      admins,
      admin: admin.session?.scope.permissions,
      client: client.session?.scope.permissions,
      pending: pending.ok,
      withoutEnv: withoutEnv.session?.scope.permissions,
      roleBased: alcanceDeCuenta(['owner', 'admin', 'platform_admin']).permissions,
      adminPerms: PLATFORM_ADMIN_PERMISSIONS,
    }))
  `)
  assert.deepEqual(result.admins, ['admin@example.com', 'otra@example.com'], 'normalized, deduplicated, invalid entries dropped')
  for (const permission of result.adminPerms) {
    assert.ok(result.admin.includes(permission), `admin gets ${permission}`)
    assert.ok(!result.client.includes(permission), `a regular account never gets ${permission}`)
    assert.ok(!result.withoutEnv.includes(permission), 'without the allowlist nobody is admin')
    assert.ok(!result.roleBased.includes(permission), 'roles (even "admin") never grant platform permissions')
  }
  assert.equal(result.pending, false, 'an allowlisted but unverified email cannot even sign in')
})

test('ADMIN wiring: allowlist read from the API environment, admin routes require the permission and never trust roles', () => {
  const server = readFileSync(join(root, 'apps/api/src/server.ts'), 'utf8')
  assert.match(server, /platformAdminEmails: leerAdminsPlataforma\(process\.env\['TUS_PLATFORM_ADMIN_EMAILS'\]\)/u)
  const router = readFileSync(join(root, 'apps/api/src/tus/http/router.ts'), 'utf8')
  assert.equal((router.match(/esAdminPlataforma\(context, 'tus:(?:whatsapp:support|identity:admin|payments:admin)'/gu) ?? []).length, 3)
  // WhatsApp derives authority with alcanceDeCuenta: it can never mint platform permissions.
  const whatsapp = readFileSync(join(root, 'apps/api/src/tus/asistente/prisma-composicion.ts'), 'utf8')
  assert.match(whatsapp, /alcanceDeCuenta/u)
  // No admin email in the repository: it is configuration.
  for (const file of ['apps/api/src/server.ts', 'apps/api/src/auth-security/application/auth-service.ts', '.env.example'])
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /hotmail\.com/u, file)
})
