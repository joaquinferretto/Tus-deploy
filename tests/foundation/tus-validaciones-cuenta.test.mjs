import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// VALIDACIONES-01, account and profile (docs/VALIDACIONES_DATOS_TUS.md): the name of a person,
// the display name of an account and the forms that carry them, as the Web validates them and as
// a direct call to the API finds them. In memory.

test('VALIDACIONES nombre de persona: Unicode letters, inner space, apostrophe and hyphen; never a digit or a symbol; the apostrophe of a phone keyboard is an apostrophe; the profile, the identity and the sign-up form share the rule', () => {
  const r = runTypeScriptScenario(`
    const c = await import('./packages/contracts/src/tus-perfil.ts')
    const w = await import('./apps/web/src/features/auth/auth-validation.ts')
    const n = c.normalizarNombrePersona
    const base = { tipoDocumento: 'DNI', numeroDocumento: '30.111.222' }
    const registro = (firstName, lastName) => Object.keys(w.validateRegister({ firstName, lastName, email: 'ana@example.com', phone: '3794123456', password: 'una-clave-larga-123', confirmation: 'una-clave-larga-123', acceptedTerms: true }))
    console.log(JSON.stringify({
      validos: ['José', 'María José', 'Muñoz', "O'Connor", 'Pérez-Gómez', 'Ñandú', '  Ana   María  ', 'Ma. José', 'Zoë', 'Li'].map(n),
      tipografico: [n('O\\u2019Connor'), n('D\\u00B4Angelo'), n('O\\u02BCNeil')],
      invalidos: ['', ' ', 'A', 'Juan3', '12345', 'Ana_María', 'Ana@', '-Ana', "Ana-", "Ana--María", "O''Connor", '.', 'Ana  .', 'Ana\\u0000', '<b>Ana</b>', 'x'.repeat(61), 42, null, { nombre: 'Ana' }].map(n),
      limites: [n('Li'), n('x'.repeat(60))?.length, n('ñ'.repeat(60))?.length, n('x'.repeat(61))],
      identidad: [c.validarIdentidadPersonal({ nombre: ' Sofía ', apellido: 'O\\u2019Connor', ...base }), c.validarIdentidadPersonal({ nombre: 'Sofía9', apellido: 'Pérez--Gómez', ...base })].map((x) => x.ok ? [x.valor.nombre, x.valor.apellido, x.valor.numeroDocumento] : Object.keys(x.errores)),
      perfil: Object.keys(c.validarPerfilPersonal({ nombre: 'R2D2', apellido: 'Muñoz', ...base, localidadId: 'loc-1', calle: 'San Martín', numero: '123', codigoPostal: '3400' }).errores ?? {}),
      documento: [c.normalizarDocumento('DNI', '30.111.222'), c.normalizarDocumento('DNI', '30111222A'), c.normalizarDocumento('DNI', '123456'), c.normalizarDocumento('PASAPORTE', 'aab 123456'), c.normalizarDocumento('PASAPORTE', 'A!123456'), c.normalizarDocumento('CEDULA', '123')].map((x) => x.ok ? x.numero : x.motivo),
      registro: [registro('María José', "O'Connor"), registro('Mar1a', 'Pérez'), registro('María', 'P@rez'), registro('', '')],
      registroLargos: Object.keys(w.validateRegister({ firstName: 'Ana', lastName: 'Paz', email: 'a'.repeat(320) + '@example.com', password: 'x'.repeat(257), confirmation: 'x'.repeat(257), acceptedTerms: true })),
      camposApi: w.registerFieldErrors(['displayName', 'email', 'password']),
    }))
  `)
  assert.deepEqual(r.validos, ['José', 'María José', 'Muñoz', "O'Connor", 'Pérez-Gómez', 'Ñandú', 'Ana María', 'Ma. José', 'Zoë', 'Li'], 'accents, ñ, inner spaces, apostrophe and hyphen are names; outer and repeated spaces are normalized')
  assert.deepEqual(r.tipografico, ["O'Connor", "D'Angelo", "O'Neil"], 'the apostrophe a phone writes is the same apostrophe')
  assert.deepEqual(r.invalidos, Array(19).fill(null), 'digits, symbols, loose or doubled punctuation, control characters, markup, too long and non-texts are not names')
  assert.deepEqual(r.limites, ['Li', 60, 60, null], '2 to 60 characters, counted as characters')
  assert.deepEqual(r.identidad, [['Sofía', "O'Connor", '30111222'], ['nombre', 'apellido']])
  assert.deepEqual(r.perfil, ['nombre'])
  assert.deepEqual(r.documento, ['30111222', 'formato', 'formato', 'AAB123456', 'formato', 'tipo'], 'a DNI is digits only; a passport is alphanumeric; the type is a closed list')
  assert.deepEqual(r.registro, [[], ['firstName'], ['lastName'], ['firstName', 'lastName']], 'the sign-up form applies the same rule, field by field')
  assert.deepEqual(r.registroLargos.sort(), ['email', 'password'])
  assert.deepEqual(Object.keys(r.camposApi).sort(), ['email', 'firstName', 'password'], 'a field the API refused gets its own message')
})

const CUENTA_APP = `
  const express = (await import('./apps/api/node_modules/express/index.js')).default
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { InMemoryEmailSender } = await import('./apps/api/src/auth-security/adapters/in-memory-auxiliaries.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  const { createAuthRouter } = await import('./apps/api/src/auth-security/http/auth-router.ts')
  const v = await import('./apps/api/src/auth-security/domain/validation.ts')
  const store = new InMemoryIdentityStore()
  const email = new InMemoryEmailSender()
  const auth = createAuthService({ store, email })
  const app = express()
  app.use(express.json())
  app.use(createAuthRouter({ service: auth.service, sessions: new DurableIdentitySessionResolver(store) }))
  app.use((error, _req, res, _next) => res.status(500).json({ code: 'CRASH', error: String(error?.message) }))
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = 'http://127.0.0.1:' + server.address().port
  const pedir = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-validaciones', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
    const json = await r.json().catch(() => ({}))
    return { status: r.status, code: json.error?.code ?? json.code ?? null, fields: json.fields ?? null, json }
  }
`

test('VALIDACIONES cuenta (API directa): sign-up names the field whose format is wrong; the display name is bounded and clean; an account can change its own name and nothing else, and unknown or privileged fields are refused', () => {
  const r = runTypeScriptScenario(`${CUENTA_APP}
    const out = {}
    try {
      out.nombreVisible = [v.normalizeDisplayName('  María   José  Pérez '), v.normalizeDisplayName('Plomería 24'), v.normalizeDisplayName('A'), v.normalizeDisplayName('  '), v.normalizeDisplayName('x'.repeat(121)), v.normalizeDisplayName('x'.repeat(120))?.length, v.normalizeDisplayName('Ana\\u0000'), v.normalizeDisplayName('Ana\\u202Eodatse'), v.normalizeDisplayName('Ana\\nPérez'), v.normalizeDisplayName(123), v.normalizeDisplayName('👩‍🔧 Ana')]
      const registrar = (body) => pedir('POST', '/auth/register', { email: 'ana@example.com', password: 'una-clave-larga-123', displayName: 'Ana Pérez', ...body })
      out.registro = {
        valido: (await registrar({})).status,
        nombreVacio: await registrar({ email: 'b@example.com', displayName: '   ' }),
        nombreLargo: await registrar({ email: 'c@example.com', displayName: 'x'.repeat(500) }),
        nombreControl: await registrar({ email: 'd@example.com', displayName: 'Ana\\u0007' }),
        nombreObjeto: await registrar({ email: 'e@example.com', displayName: { toString: 'x' } }),
        emailMalo: await registrar({ email: 'no-es-email' }),
        claveCorta: await registrar({ email: 'f@example.com', password: 'corta' }),
        todo: await registrar({ email: 'x', password: 'y', displayName: '' }),
      }
      for (const [k, x] of Object.entries(out.registro)) if (typeof x === 'object') out.registro[k] = [x.status, x.code, x.fields]
      out.cuentasCreadas = (await store.findAccountByEmail('b@example.com')) || (await store.findAccountByEmail('c@example.com')) ? 'creada' : 'ninguna'
      // Same answer for a new email and a registered one (no enumeration), with valid data.
      out.sinEnumeracion = (await registrar({})).status

      // An account with a session.
      const cuenta = await store.findAccountByEmail('ana@example.com')
      cuenta.emailVerifiedAt = new Date().toISOString(); await store.saveAccount(cuenta)
      const sesion = await pedir('POST', '/auth/sign-in', { email: 'ana@example.com', password: 'una-clave-larga-123' })
      const token = sesion.json.session?.accessToken
      const cambiar = (changes, id = cuenta.id) => pedir('PATCH', '/auth/accounts/' + id, changes, token)
      const ok = await cambiar({ displayName: '  Ana   María  O\\u2019Connor ' })
      out.cambio = [ok.status, ok.json.account?.displayName, (await store.getAccount(cuenta.id)).displayName]
      out.cambioInvalido = [
        await cambiar({ displayName: '' }), await cambiar({ displayName: 'x'.repeat(121) }), await cambiar({ displayName: ['Ana'] }), await cambiar({ displayName: 'Ana\\u0000' }),
        await cambiar({ displayName: 'Ana Pérez', emailVerifiedAt: '2020-01-01T00:00:00.000Z' }), await cambiar({ email: 'otra@example.com' }), await cambiar({ phoneVerifiedAt: '2020-01-01T00:00:00.000Z' }),
        await cambiar({ roles: ['platform-admin'] }), await cambiar({ displayName: 'Ana', tenantId: 'otro' }), await cambiar({ displayName: 'Otra Persona' }, 'otra-cuenta'),
      ].map((x) => x.status)
      const final = await store.getAccount(cuenta.id)
      out.sinCambios = [final.displayName, final.email, final.roles, final.emailVerifiedAt === cuenta.emailVerifiedAt]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.nombreVisible, ['María José Pérez', 'Plomería 24', 'A', null, null, 120, null, null, 'Ana Pérez', null, '👩‍🔧 Ana'], 'one line, 1 to 120 characters, without control or bidi characters; a trade name with digits and an emoji are fine')
  assert.equal(r.registro.valido, 201)
  assert.deepEqual(r.registro.nombreVacio, [400, 'INVALID_REQUEST', ['displayName']])
  assert.deepEqual(r.registro.nombreLargo, [400, 'INVALID_REQUEST', ['displayName']])
  assert.deepEqual(r.registro.nombreControl, [400, 'INVALID_REQUEST', ['displayName']])
  assert.deepEqual(r.registro.nombreObjeto, [400, 'INVALID_REQUEST', ['displayName']])
  assert.deepEqual(r.registro.emailMalo, [400, 'INVALID_REQUEST', ['email']])
  assert.deepEqual(r.registro.claveCorta, [400, 'INVALID_REQUEST', ['password']])
  assert.deepEqual(r.registro.todo, [400, 'INVALID_REQUEST', ['email', 'password', 'displayName']])
  assert.equal(r.cuentasCreadas, 'ninguna', 'a refused sign-up creates nothing')
  assert.equal(r.sinEnumeracion, 201, 'a registered email with valid data answers the same as a new one')
  assert.deepEqual(r.cambio, [200, "Ana María O'Connor".replace("'", '’'), "Ana María O'Connor".replace("'", '’')], 'the display name is stored trimmed and collapsed')
  assert.deepEqual(r.cambioInvalido, [400, 400, 400, 400, 400, 400, 400, 403, 403, 403], 'an invalid name or a field that is not the account\'s own is refused; privilege fields and another account are forbidden')
  assert.deepEqual(r.sinCambios.slice(1), ['ana@example.com', ['owner'], true], 'nothing else of the account moved')
})
