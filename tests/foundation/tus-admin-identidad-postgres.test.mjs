import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ADMIN-IDENTIDAD-01 on a DISPOSABLE PostgreSQL 16 with every migration applied
// (TUS_TELEFONO_PG_URL, or TUS_IDENTITY_PG_URL / TUS_DIRECTORIO_PG_URL). Never a shared database.
const url = process.env.TUS_TELEFONO_PG_URL ?? process.env.TUS_IDENTITY_PG_URL ?? process.env.TUS_DIRECTORIO_PG_URL

test(
  'IDENTIDAD PostgreSQL admin: the identity is saved on the person, the document stays unique also under a race, the change is audited, and the assistant identifies the account by the name + document the administrator loaded',
  { skip: !url && 'TUS_TELEFONO_PG_URL not set (disposable PostgreSQL 16 only)', timeout: 180000 },
  () => {
    const r = runTypeScriptScenario(`
      const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
      const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, errorFormat: 'minimal' })
      const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
      const { AlmacenPerfilPrisma } = await import('./apps/api/src/tus/perfil/almacen.ts')
      const { ServicioPerfil } = await import('./apps/api/src/tus/perfil/servicio.ts')
      const { crearIdentidadUsuarioAdmin } = await import('./apps/api/src/tus/admin/identidad.ts')
      const { CuentasPorDocumentoPrisma } = await import('./apps/api/src/tus/adapters/prisma-asistente.ts')
      const { ServicioIdentificacionCliente } = await import('./apps/api/src/tus/asistente/identificacion.ts')
      const run = 'i' + Date.now().toString(36)
      const auth = createPrismaAuthService(prisma)
      const perfiles = new ServicioPerfil(new AlmacenPerfilPrisma(prisma))
      const identidad = crearIdentidadUsuarioAdmin({ perfiles, auditar: (input) => auth.service.recordAdminIdentityChange(input) })
      const identificacion = new ServicioIdentificacionCliente(new CuentasPorDocumentoPrisma(prisma))
      const cuenta = async (tag) => (await auth.service.registerAccount({ email: run + '-' + tag + '@example.com', password: 'una frase larga y segura 2026', displayName: 'Persona ' + tag })).created.account.id
      // Documents unique per run (8 digits, never a leading zero).
      const base = String(10000 + Math.floor(Math.random() * 80000))
      const dni = (n) => '4' + base + String(n).padStart(2, '0')
      const out = {}
      try {
        const a = await cuenta('a'); const b = await cuenta('b'); const c = await cuenta('c'); const d = await cuenta('d')
        const usuario = async (id) => { const fila = await prisma.account.findUnique({ where: { id }, include: { user: true } }); return fila.user }
        const antes = await usuario(a)
        // The assistant does not know the person yet.
        out.antes = await identificacion.identificar('Luciana Pereira, ' + dni(1)).then((x) => [x.ok, x.motivo])
        const guardada = await identidad({ actorId: 'admin-pg', accountId: a, body: { nombre: 'Luciana', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: dni(1) } })
        const despues = await usuario(a)
        out.guardar = [guardada.ok, guardada.perfil?.documento?.numero === dni(1), despues.firstName, despues.lastName, despues.documentType, despues.documentNumber === dni(1), despues.displayName, despues.profileComplete]
        out.noTocado = [despues.email === antes.email, despues.phoneNumber, despues.phoneVerifiedAt, despues.phonePending, (await prisma.account.findUnique({ where: { id: a } })).status]
        // Right away, with no cache in between: the same name + document identifies THAT account.
        const identificada = await identificacion.identificar('Luciana Pereira, ' + dni(1))
        out.asistente = [identificada.ok, identificada.cuenta?.accountId === a, await identificacion.identificar('Otra Persona, ' + dni(1)).then((x) => [x.ok, x.motivo])]
        // Unique document: sequential and under a race.
        out.duplicado = await identidad({ actorId: 'admin-pg', accountId: b, body: { nombre: 'Beto', apellido: 'Ruiz', tipoDocumento: 'DNI', numeroDocumento: dni(1) } }).then(async (x) => [x.ok, x.code, (await usuario(b)).documentNumber])
        const carrera = await Promise.all([c, d].map((id) => identidad({ actorId: 'admin-pg', accountId: id, body: { nombre: 'Carla', apellido: 'Sosa', tipoDocumento: 'DNI', numeroDocumento: dni(2) } }).then((x) => x.ok ? 'ok' : x.code, (e) => 'error:' + String(e?.code ?? e?.message).slice(0, 40))))
        out.carrera = [[...carrera].sort(), await prisma.user.count({ where: { documentType: 'DNI', documentNumber: dni(2) } })]
        // The database itself holds the rule.
        out.unico = await prisma.user.update({ where: { id: (await usuario(b)).id }, data: { documentType: 'DNI', documentNumber: dni(1) } }).then(() => 'ok', (e) => e.code)
        // A correction with a reason; the same values again are not an event.
        await identidad({ actorId: 'admin-pg', accountId: a, body: { nombre: 'Luciana', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: dni(3), motivo: 'Error de carga' } })
        await identidad({ actorId: 'admin-pg', accountId: a, body: { nombre: 'Luciana', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: dni(3) } })
        out.propia = await identidad({ actorId: a, accountId: a, body: { nombre: 'Luciana', apellido: 'Pereira', tipoDocumento: 'DNI', numeroDocumento: dni(3) } }).then((x) => x.code)
        const eventos = await prisma.auditEvent.findMany({ where: { eventType: 'account.admin_identity_updated', actorId: 'admin-pg' }, orderBy: { occurredAt: 'asc' } }).catch((e) => 'sin tabla: ' + String(e?.message).slice(0, 120))
        out.auditoria = Array.isArray(eventos) ? eventos.filter((e) => e.metadata?.targetAccountId === a).map((e) => [e.metadata.changedFields, e.metadata.documentBefore ?? null, e.metadata.documentAfter, e.metadata.reason ?? null]) : eventos
        out.sinDocumentoCompleto = Array.isArray(eventos) ? !eventos.some((e) => JSON.stringify(e).includes(dni(1)) || JSON.stringify(e).includes(dni(3))) : null
        out.mascaras = ['*****' + dni(1).slice(-3), '*****' + dni(3).slice(-3)]
      } finally { await prisma.$disconnect() }
      console.log(JSON.stringify(out))
    `)
    assert.deepEqual(r.antes, [false, 'no_encontrada'])
    assert.deepEqual(r.guardar, [true, true, 'Luciana', 'Pereira', 'DNI', true, 'Luciana Pereira', false], 'the canonical columns of the person; the profile is not complete without its residence')
    assert.deepEqual(r.noTocado, [true, null, null, null, 'active'], 'email, phone, verification and status untouched')
    assert.deepEqual(r.asistente, [true, true, [false, 'no_encontrada']], 'the assistant reads the identity the administrator loaded; a different name with that document is still nobody')
    assert.deepEqual(r.duplicado.slice(0, 2), [false, 'DOCUMENT_ALREADY_REGISTERED'])
    assert.equal(r.duplicado[2], null, 'nothing was saved on the second account')
    assert.deepEqual(r.carrera, [['DOCUMENT_ALREADY_REGISTERED', 'ok'], 1], 'two administrators, one document: one account gets it')
    assert.equal(r.unico, 'P2002', 'uq_user_documento')
    assert.equal(r.propia, 'FORBIDDEN')
    assert.deepEqual(r.auditoria, [['firstName,lastName,documentType,documentNumber', null, r.mascaras[0], null], ['documentNumber', r.mascaras[0], r.mascaras[1], 'Error de carga']], 'two changes, two events; the repeated save is none')
    assert.equal(r.sinDocumentoCompleto, true)
  }
)
