import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Profile photo of a provider. The uploaded file is untrusted: its real type comes from its magic
// bytes, its dimensions from its header, its metadata is removed, and it is stored in PostgreSQL
// with no file name or path. Only the provider (from its session) changes its own photo; the
// platform administration may remove one; anyone may see the photo of a VISIBLE profile.

// Synthetic images built byte by byte (no real photo): valid structure, chosen dimensions.
const IMAGENES = `
  const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); return b }
  const pngChunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
  function png(ancho, alto, { extra = [], relleno = 600 } = {}) {
    const ihdr = Buffer.concat([u32(ancho), u32(alto), Buffer.from([8, 2, 0, 0, 0])])
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), ...extra.map(([type, data]) => pngChunk(type, Buffer.from(data, 'utf8'))), pngChunk('IDAT', Buffer.alloc(relleno, 7)), pngChunk('IEND', Buffer.alloc(0))])
  }
  const segmento = (marker, data) => { const head = Buffer.alloc(4); head[0] = 0xff; head[1] = marker; head.writeUInt16BE(data.length + 2, 2); return Buffer.concat([head, data]) }
  function jpeg(ancho, alto, { exif = false } = {}) {
    const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(alto, 1); sof.writeUInt16BE(ancho, 3); sof[5] = 3
    return Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segmento(0xe0, Buffer.from('JFIF\\0\\x01\\x01\\0\\0\\x01\\0\\x01\\0\\0', 'latin1')),
      ...(exif ? [segmento(0xe1, Buffer.from('Exif\\0\\0GPS -27.4692,-58.8306 Calle Falsa 123', 'latin1'))] : []),
      segmento(0xc0, sof),
      segmento(0xda, Buffer.alloc(10, 1)),
      Buffer.alloc(300, 0x55),
      Buffer.from([0xff, 0xd9]),
    ])
  }
  const riffChunk = (type, data) => { const head = Buffer.alloc(8); head.write(type, 0, 'latin1'); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]) }
  function webp(ancho, alto, { animada = false, exif = false } = {}) {
    const vp8x = Buffer.alloc(10); vp8x[0] = (animada ? 0x02 : 0) | (exif ? 0x08 : 0)
    vp8x.writeUIntLE(ancho - 1, 4, 3); vp8x.writeUIntLE(alto - 1, 7, 3)
    const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), riffChunk('VP8X', vp8x), riffChunk('VP8 ', Buffer.alloc(200, 3)), ...(exif ? [riffChunk('EXIF', Buffer.from('GPS -27.4692,-58.8306'))] : [])])
    const head = Buffer.alloc(8); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4)
    return Buffer.concat([head, body])
  }
`

test('PHOTO FILE: only JPEG, PNG and WebP by magic bytes; metadata removed; dimensions bounded from the header; disguised, corrupt, animated, oversized and bomb-like files refused with a fixed code', () => {
  const r = runTypeScriptScenario(`${IMAGENES}
    const f = await import('./apps/api/src/tus/directorio/foto.ts')
    const probar = (bytes) => { try { const foto = f.prepararFotoPerfil(bytes); return { tipo: foto.tipoMime, ancho: foto.ancho, alto: foto.alto, bytes: foto.tamanoBytes, sha: foto.sha256.length, igual: foto.contenido.length === foto.tamanoBytes, texto: foto.contenido.toString('latin1') } } catch (e) { return e instanceof f.ErrorFotoPerfil ? e.code : 'otro:' + e.message } }
    const sinTexto = (resultado) => typeof resultado === 'string' ? resultado : { ...resultado, texto: undefined }
    const out = {}
    out.png = sinTexto(probar(png(400, 300)))
    out.jpeg = sinTexto(probar(jpeg(640, 480)))
    out.webp = sinTexto(probar(webp(512, 512)))
    // Metadata (EXIF with GPS, a text chunk with an address) never reaches the stored bytes.
    const conExif = probar(jpeg(640, 480, { exif: true }))
    const conTexto = probar(png(400, 300, { extra: [['tEXt', 'Comment\\0Calle Falsa 123'], ['eXIf', 'GPS -27.4692']] }))
    const webpExif = probar(webp(512, 512, { exif: true }))
    out.metadatos = [conExif.texto.includes('GPS'), conExif.texto.includes('Calle Falsa'), conTexto.texto.includes('Calle Falsa'), conTexto.texto.includes('GPS'), webpExif.texto.includes('GPS')]
    out.mismaImagenSinMetadatos = conExif.bytes === probar(jpeg(640, 480)).bytes
    // Not an image, whatever the name or the declared type says.
    out.noImagen = {
      vacio: probar(Buffer.alloc(0)),
      noBuffer: probar('data:image/png;base64,AAAA'),
      svg: probar(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>')),
      gif: probar(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(400)])),
      html: probar(Buffer.from('<!doctype html><script>fetch("//evil")</script>'.padEnd(400))),
      pdf: probar(Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(400)])),
      exe: probar(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400)])),
      zip: probar(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(400)])),
      // A polyglot: PNG signature followed by a script, no real chunks.
      poliglota: probar(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<script>alert(1)</script>'.padEnd(300))])),
    }
    out.corruptos = {
      pngTruncado: probar(png(400, 300).subarray(0, 60)),
      pngSinFin: probar(png(400, 300).subarray(0, png(400, 300).length - 12)),
      jpegSinFin: probar(jpeg(640, 480).subarray(0, jpeg(640, 480).length - 2)),
      jpegSinTamano: probar(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xda, 0, 2]), Buffer.alloc(50, 1), Buffer.from([0xff, 0xd9])])),
      webpTruncado: probar(webp(512, 512).subarray(0, 40)),
    }
    out.dimensiones = {
      chica: probar(png(95, 400)),
      minima: sinTexto(probar(png(96, 96))),
      ancha: probar(png(4097, 400)),
      alta: probar(jpeg(400, 5000)),
      maxima: sinTexto(probar(png(4096, 4096))),
      // A few hundred bytes that declare an image of 10^10 pixels (decompression bomb).
      bomba: probar(png(100000, 100000)),
      bombaWebp: probar(webp(16777216, 16777216)),
      cero: probar(png(0, 0)),
    }
    out.animadas = { webp: probar(webp(512, 512, { animada: true })), apng: probar(png(400, 300, { extra: [['acTL', '12345678']] })) }
    out.grande = probar(png(400, 300, { relleno: f.TAMANO_MAXIMO_FOTO }))
    out.justoBajoElLimite = typeof probar(png(400, 300, { relleno: f.TAMANO_MAXIMO_FOTO - 200 })) === 'object'
    out.rutas = [f.rutaFotoPerfil('perfil-1', 'a'.repeat(64)), f.rutaFotoPerfil('../etc', 'a'.repeat(64)), f.rutaFotoPerfil('perfil-1', 'no-es-un-hash'), f.rutaFotoPerfil('perfil-1', null)]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual([r.png.tipo, r.png.ancho, r.png.alto, r.png.sha, r.png.igual], ['image/png', 400, 300, 64, true])
  assert.deepEqual([r.jpeg.tipo, r.jpeg.ancho, r.jpeg.alto], ['image/jpeg', 640, 480])
  assert.deepEqual([r.webp.tipo, r.webp.ancho, r.webp.alto], ['image/webp', 512, 512])
  assert.deepEqual(r.metadatos, [false, false, false, false, false], 'no EXIF, GPS or text chunk is stored')
  assert.equal(r.mismaImagenSinMetadatos, true)
  assert.deepEqual(r.noImagen, {
    vacio: 'PHOTO_EMPTY', noBuffer: 'PHOTO_EMPTY', svg: 'PHOTO_TYPE_NOT_ALLOWED', gif: 'PHOTO_TYPE_NOT_ALLOWED', html: 'PHOTO_TYPE_NOT_ALLOWED',
    pdf: 'PHOTO_TYPE_NOT_ALLOWED', exe: 'PHOTO_TYPE_NOT_ALLOWED', zip: 'PHOTO_TYPE_NOT_ALLOWED', poliglota: 'PHOTO_CORRUPT',
  })
  assert.deepEqual(r.corruptos, { pngTruncado: 'PHOTO_CORRUPT', pngSinFin: 'PHOTO_CORRUPT', jpegSinFin: 'PHOTO_CORRUPT', jpegSinTamano: 'PHOTO_CORRUPT', webpTruncado: 'PHOTO_CORRUPT' })
  assert.deepEqual([r.dimensiones.chica, r.dimensiones.ancha, r.dimensiones.alta, r.dimensiones.bomba, r.dimensiones.bombaWebp, r.dimensiones.cero], Array(6).fill('PHOTO_DIMENSIONS'))
  assert.deepEqual([r.dimensiones.minima.ancho, r.dimensiones.maxima.ancho, r.dimensiones.maxima.alto], [96, 4096, 4096])
  assert.deepEqual(r.animadas, { webp: 'PHOTO_ANIMATED', apng: 'PHOTO_ANIMATED' })
  assert.equal(r.grande, 'PHOTO_TOO_LARGE')
  assert.equal(r.justoBajoElLimite, true)
  assert.deepEqual(r.rutas, ['/tus/v1/public/prestadores/perfil-1/foto?v=aaaaaaaaaaaaaaaa', null, null, null])
})

const SERVICIO = `${IMAGENES}
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const contratos = await import('./packages/contracts/src/tus-directorio.ts')
  let now = Date.parse('2026-09-28T13:00:00.000Z')
  let seq = 0
  const merchants = new Map()
  const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null }, listings: { forTenant: async () => [] } } }, identity: { identidadVerificada: async () => false } }
  const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, now: () => now, newId: () => 'perfil-' + String(++seq).padStart(4, '0') })
  const ctx = (tenantId, permissions = ['tus:marketplace:write', 'tus:marketplace:read']) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 's', roles: ['merchant'], permissions, correlationId: 'c' })
  async function prestador(tenantId, displayName, extra = {}) {
    merchants.set(tenantId, { merchantId: 'm-' + tenantId, status: 'approved' })
    return (await directorio.guardarPerfil(ctx(tenantId), { displayName, profession: 'plomeria', zone: 'Centro', description: 'Trabajos prolijos.', ...extra })).perfil
  }
`

test('PHOTO OWNERSHIP: a provider only changes its own photo (the profile comes from the session); the photo shows in public DTOs, is served only for a visible profile, is replaced not accumulated, survives a profile edit and can be removed', () => {
  const r = runTypeScriptScenario(`${SERVICIO}
    const carlos = await prestador('t-carlos', 'Carlos Méndez')
    const sabrina = await prestador('t-sabrina', 'Sabrina Ruiz')
    const out = {}
    out.sinFoto = { url: carlos.photoUrl, publica: await directorio.fotoPublica(carlos.id) }
    const subida = await directorio.guardarMiFoto('t-carlos', png(400, 300))
    out.subida = { ok: subida.ok, ruta: contratos.RUTA_FOTO_PRESTADOR.test(subida.photoUrl), deCarlos: subida.photoUrl.startsWith('/tus/v1/public/prestadores/' + carlos.id + '/foto?v=') }
    const lista = await directorio.listar({})
    out.enLista = lista.items.map((item) => [item.displayName, item.photoUrl === null ? null : item.photoUrl === subida.photoUrl])
    out.dtoValido = lista.items.every((item) => contratos.esPrestadorPublico(item))
    out.dtoSinBytes = !JSON.stringify(lista).includes('contenido') && !JSON.stringify(lista).includes('sha256')
    out.enPerfil = (await directorio.perfil(carlos.id)).photoUrl === subida.photoUrl
    out.enMiPerfil = (await directorio.miPerfil(ctx('t-carlos'))).photoUrl === subida.photoUrl
    const publica = await directorio.fotoPublica(carlos.id)
    out.publica = [publica.tipoMime, publica.ancho, publica.alto, publica.contenido.length === publica.tamanoBytes]
    // Another provider's upload lands on ITS profile; Carlos's photo is untouched.
    const deSabrina = await directorio.guardarMiFoto('t-sabrina', jpeg(640, 480))
    out.aislamiento = [deSabrina.photoUrl.includes(sabrina.id), (await directorio.fotoPublica(carlos.id)).sha256 === publica.sha256, (await directorio.fotoPublica(sabrina.id)).tipoMime]
    // A tenant without a profile, or an unknown one, has nothing to change.
    out.sinPerfil = [(await directorio.guardarMiFoto('t-nadie', png(400, 300))).code, (await directorio.quitarMiFoto('t-nadie')).code]
    // Replacing: one row per profile, the address changes (cache busting), the old bytes are gone.
    const segunda = await directorio.guardarMiFoto('t-carlos', webp(512, 512))
    const actual = await directorio.fotoPublica(carlos.id)
    out.reemplazo = [segunda.photoUrl !== subida.photoUrl, actual.tipoMime, actual.sha256 !== publica.sha256]
    // An invalid file changes nothing.
    const invalida = await directorio.guardarMiFoto('t-carlos', Buffer.from('<svg onload=alert(1)>'.padEnd(300)))
    out.invalida = [invalida.code, (await directorio.fotoPublica(carlos.id)).sha256 === actual.sha256]
    // Editing the profile keeps the photo.
    const editado = await directorio.guardarPerfil(ctx('t-carlos'), { displayName: 'Carlos M.', profession: 'plomeria', zone: 'Centro', description: 'Otra descripción.' })
    out.trasEditar = [editado.perfil.photoUrl === segunda.photoUrl, (await directorio.perfil(carlos.id)).photoUrl === segunda.photoUrl]
    // A hidden profile serves no photo (and is not listed), without deleting it.
    await directorio.guardarPerfil(ctx('t-carlos'), { displayName: 'Carlos M.', profession: 'plomeria', zone: 'Centro', description: 'Otra descripción.', visible: false })
    out.oculto = [await directorio.fotoPublica(carlos.id), (await directorio.listar({})).items.map((item) => item.displayName)]
    await directorio.guardarPerfil(ctx('t-carlos'), { displayName: 'Carlos M.', profession: 'plomeria', zone: 'Centro', description: 'Otra descripción.', visible: true })
    out.visibleDeNuevo = (await directorio.fotoPublica(carlos.id)).sha256 === actual.sha256
    // Ids that are not ids.
    out.idsInvalidos = await Promise.all(['../' + carlos.id, carlos.id + '/../x', '', null, { id: carlos.id }, 'x'.repeat(200), carlos.id + '%00'].map((id) => directorio.fotoPublica(id)))
    // Removing: the owner, and the administration by public id.
    const quitada = await directorio.quitarMiFoto('t-carlos')
    out.quitada = [quitada.ok, quitada.photoUrl, await directorio.fotoPublica(carlos.id), (await directorio.perfil(carlos.id)).photoUrl]
    out.quitarDosVeces = (await directorio.quitarMiFoto('t-carlos')).ok
    out.admin = [(await directorio.quitarFotoDePerfil(sabrina.id)).ok, await directorio.fotoPublica(sabrina.id), (await directorio.quitarFotoDePerfil('perfil-9999')).code, (await directorio.quitarFotoDePerfil('../x')).code]
    // Upload pacing per provider.
    const ritmo = []
    for (let i = 0; i < 12; i += 1) ritmo.push((await directorio.guardarMiFoto('t-sabrina', png(200 + i, 200))).ok)
    out.ritmo = ritmo
    out.otroPrestadorNoLimitado = (await directorio.guardarMiFoto('t-carlos', png(300, 300))).ok
    now += 61 * 60 * 1000
    out.trasUnaHora = (await directorio.guardarMiFoto('t-sabrina', png(300, 300))).ok
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinFoto, { url: null, publica: null })
  assert.deepEqual(r.subida, { ok: true, ruta: true, deCarlos: true })
  assert.deepEqual(r.enLista.sort(), [['Carlos Méndez', true], ['Sabrina Ruiz', null]])
  assert.equal(r.dtoValido, true)
  assert.equal(r.dtoSinBytes, true, 'a listing never carries bytes or hashes')
  assert.deepEqual([r.enPerfil, r.enMiPerfil], [true, true])
  assert.deepEqual(r.publica, ['image/png', 400, 300, true])
  assert.deepEqual(r.aislamiento, [true, true, 'image/jpeg'])
  assert.deepEqual(r.sinPerfil, ['NOT_FOUND', 'NOT_FOUND'])
  assert.deepEqual(r.reemplazo, [true, 'image/webp', true])
  assert.deepEqual(r.invalida, ['PHOTO_TYPE_NOT_ALLOWED', true])
  assert.deepEqual(r.trasEditar, [true, true])
  assert.deepEqual(r.oculto, [null, ['Sabrina Ruiz']])
  assert.equal(r.visibleDeNuevo, true)
  assert.deepEqual(r.idsInvalidos, Array(7).fill(null))
  assert.deepEqual(r.quitada, [true, null, null, null])
  assert.equal(r.quitarDosVeces, true)
  assert.deepEqual(r.admin, [true, null, 'NOT_FOUND', 'NOT_FOUND'])
  assert.deepEqual(r.ritmo, [true, true, true, true, true, true, true, true, true, false, false, false], 'ten uploads an hour (one was made before)')
  assert.equal(r.otroPrestadorNoLimitado, true)
  assert.equal(r.trasUnaHora, true)
})

test('PHOTO HTTP: upload and removal need the provider session, the admin route needs the admin permission, the public route serves safe headers and nothing for unknown or hidden profiles', () => {
  const r = runTypeScriptScenario(`${SERVICIO}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterDirectorio } = await import('./apps/api/src/tus/directorio/http.ts')
    const carlos = await prestador('t-carlos', 'Carlos Méndez')
    const sabrina = await prestador('t-sabrina', 'Sabrina Ruiz')
    const sesiones = new Map([
      ['tok-carlos', ctx('t-carlos')],
      ['tok-sabrina', ctx('t-sabrina')],
      ['tok-cliente', ctx('t-cliente', ['tus:marketplace:read'])],
      ['tok-admin', ctx('t-plataforma', ['tus:providers:admin'])],
    ])
    const sessions = { resolve: async (token) => sesiones.get(token) ?? null }
    const app = express(); app.use(express.json()); app.use(express.raw({ type: ['application/octet-stream'], limit: '10mb' }))
    app.use(crearRouterDirectorio({ servicio: directorio, sessions }))
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const cabeceras = (token, tipo = 'application/octet-stream') => ({ ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr-1', 'content-type': tipo })
    const subir = async (token, body, tipo) => { const res = await fetch(base + '/tus/v1/prestador/perfil-publico/foto', { method: 'PUT', headers: cabeceras(token, tipo), body }); return [res.status, (await res.json().catch(() => ({}))).code ?? null] }
    const publica = (id) => fetch(base + '/tus/v1/public/prestadores/' + id + '/foto')
    const out = {}
    try {
      out.anonimo = await subir(null, png(400, 300))
      out.cliente = await subir('tok-cliente', png(400, 300))
      out.tokenFalso = await subir('tok-inventado', png(400, 300))
      out.comoJson = await subir('tok-carlos', JSON.stringify({ photoUrl: 'https://evil.example/x.png', perfilId: sabrina.id }), 'application/json')
      out.svg = await subir('tok-carlos', Buffer.from('<svg onload=alert(1)></svg>'.padEnd(300)))
      out.grande = await subir('tok-carlos', png(400, 300, { relleno: 2 * 1024 * 1024 }))
      out.bomba = await subir('tok-carlos', png(100000, 100000))
      out.nadaGuardado = (await publica(carlos.id)).status
      const ok = await fetch(base + '/tus/v1/prestador/perfil-publico/foto', { method: 'PUT', headers: cabeceras('tok-carlos'), body: jpeg(640, 480, { exif: true }) })
      const cuerpo = await ok.json()
      out.subida = [ok.status, Object.keys(cuerpo), cuerpo.photoUrl.startsWith('/tus/v1/public/prestadores/' + carlos.id + '/foto?v=')]
      const foto = await fetch(base + cuerpo.photoUrl)
      const bytes = Buffer.from(await foto.arrayBuffer())
      out.servida = { status: foto.status, tipo: foto.headers.get('content-type'), nosniff: foto.headers.get('x-content-type-options'), csp: foto.headers.get('content-security-policy'), cache: foto.headers.get('cache-control'), disposicion: foto.headers.get('content-disposition'), sinExif: !bytes.toString('latin1').includes('GPS'), esJpeg: bytes[0] === 0xff && bytes[1] === 0xd8 }
      out.listaPublica = (await (await fetch(base + '/tus/v1/public/prestadores')).json()).items.map((item) => [item.displayName, typeof item.photoUrl]).sort()
      // Sabrina cannot reach Carlos's photo through any route: hers only acts on her profile.
      const borrarSabrina = await fetch(base + '/tus/v1/prestador/perfil-publico/foto', { method: 'DELETE', headers: cabeceras('tok-sabrina') })
      out.borrarAjena = [borrarSabrina.status, (await publica(carlos.id)).status]
      out.adminSinPermiso = [(await fetch(base + '/tus/v1/admin/prestadores/' + carlos.id + '/foto', { method: 'DELETE', headers: cabeceras('tok-sabrina') })).status, (await fetch(base + '/tus/v1/admin/prestadores/' + carlos.id + '/foto', { method: 'DELETE', headers: cabeceras(null) })).status, (await publica(carlos.id)).status]
      out.desconocidas = [(await publica('perfil-9999')).status, (await publica(sabrina.id)).status, (await fetch(base + '/tus/v1/public/prestadores/..%2F..%2Fadmin/foto')).status]
      out.admin = [(await fetch(base + '/tus/v1/admin/prestadores/' + carlos.id + '/foto', { method: 'DELETE', headers: cabeceras('tok-admin') })).status, (await publica(carlos.id)).status, (await fetch(base + '/tus/v1/admin/prestadores/perfil-9999/foto', { method: 'DELETE', headers: cabeceras('tok-admin') })).status]
      await subir('tok-carlos', png(400, 300))
      const quitar = await fetch(base + '/tus/v1/prestador/perfil-publico/foto', { method: 'DELETE', headers: cabeceras('tok-carlos') })
      out.quitar = [quitar.status, (await quitar.json()).photoUrl, (await publica(carlos.id)).status]
    } finally { server.close() }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.anonimo, [401, 'UNAUTHORIZED'])
  assert.deepEqual(r.cliente, [403, 'FORBIDDEN'], 'an account that is not a provider cannot upload')
  assert.deepEqual(r.tokenFalso, [401, 'UNAUTHORIZED'])
  assert.deepEqual(r.comoJson, [415, 'PHOTO_TYPE_NOT_ALLOWED'], 'a JSON body (a URL, another profile id) is not a photo')
  assert.deepEqual(r.svg, [415, 'PHOTO_TYPE_NOT_ALLOWED'])
  assert.deepEqual(r.grande, [413, 'PHOTO_TOO_LARGE'])
  assert.deepEqual(r.bomba, [422, 'PHOTO_DIMENSIONS'])
  assert.equal(r.nadaGuardado, 404)
  assert.deepEqual(r.subida, [200, ['photoUrl'], true])
  assert.deepEqual(r.servida, { status: 200, tipo: 'image/jpeg', nosniff: 'nosniff', csp: "default-src 'none'; sandbox", cache: 'private, max-age=3600', disposicion: 'inline', sinExif: true, esJpeg: true })
  assert.deepEqual(r.listaPublica, [['Carlos Méndez', 'string'], ['Sabrina Ruiz', 'object']])
  assert.deepEqual(r.borrarAjena, [200, 200], "removing her own (absent) photo leaves Carlos's in place")
  assert.deepEqual(r.adminSinPermiso, [403, 401, 200])
  assert.deepEqual(r.desconocidas, [404, 404, 404])
  assert.deepEqual(r.admin, [200, 404, 404])
  assert.deepEqual(r.quitar, [200, null, 404])
})

test('PHOTO STORAGE: bytes live in PostgreSQL with CHECKs that repeat the limits, one row per profile, and the migration is additive', () => {
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20261031100000_tus_foto_perfil_prestador/migration.sql'), 'utf8')
  assert.match(sql, /ADD COLUMN "foto_sha256" text,/)
  assert.match(sql, /CREATE TABLE public\."fotos_perfil_prestador"/)
  assert.match(sql, /PRIMARY KEY \("perfil_id"\)/, 'one photo per profile: a new one overwrites the previous')
  assert.match(sql, /REFERENCES public\."perfiles_publicos_prestador"\("id"\) ON DELETE RESTRICT/)
  assert.match(sql, /"tipo_mime" IN \('image\/jpeg', 'image\/png', 'image\/webp'\)/)
  assert.match(sql, /"tamano_bytes" BETWEEN 1 AND 2097152 AND octet_length\("contenido"\) = "tamano_bytes"/)
  assert.match(sql, /"ancho" BETWEEN 96 AND 4096 AND "alto" BETWEEN 96 AND 4096/)
  assert.doesNotMatch(sql, /\bDROP\b|\bCASCADE\b|\bRENAME\b|ALTER COLUMN/iu)
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  assert.match(schema, /model FotoPerfilPrestador \{[\s\S]*?@@map\("fotos_perfil_prestador"\)/)
  assert.match(schema, /fotoSha256\s+String\?\s+@map\("foto_sha256"\)/)
  // No file system, no object storage, no client-supplied name anywhere in the photo path.
  const foto = readFileSync(join(root, 'apps/api/src/tus/directorio/foto.ts'), 'utf8')
  assert.doesNotMatch(foto, /node:fs|node:path|writeFile|createWriteStream|filename|originalname/u)
})

test('PHOTO WEB: the editor sends the raw file to the provider route (no id, name or URL), pre-checks type and size, and every avatar falls back to the initials', () => {
  const web = (path) => readFileSync(join(root, 'apps/web/src', path), 'utf8')
  const client = web('features/directory/directory-client.ts')
  assert.match(client, /uploadPhoto: \(session: TusWebSession, file: Blob\) =>\s*call<\{ photoUrl: string \| null \}>\(fetchImpl, '\/tus\/v1\/prestador\/perfil-publico\/foto', \{ method: 'PUT', body: file, headers: \{ 'Content-Type': 'application\/octet-stream' \} \}, session\)/)
  assert.match(client, /removePhoto: \(session: TusWebSession\) => call<\{ photoUrl: string \| null \}>\(fetchImpl, '\/tus\/v1\/prestador\/perfil-publico\/foto', \{ method: 'DELETE' \}, session\)/)
  const editor = web('features/provider/profile-photo.tsx')
  assert.match(editor, /accept=\{PHOTO_TYPES\.join\(','\)\}/)
  assert.match(editor, /type="file"/)
  assert.match(editor, /aria-live="polite"/)
  assert.doesNotMatch(editor, /svg|gif/iu, 'only JPEG, PNG and WebP are offered')
  assert.doesNotMatch(editor, /FormData|file\.name/, 'the file name never travels')
  assert.match(web('features/provider/provider-public-profile.tsx'), /\{publicId \? \(\s*<ProfilePhoto /)
  assert.match(web('features/directory/worker-profile.tsx'), /<Avatar initials=\{worker\.initials\} photoUrl=\{worker\.photoUrl\} size="lg" \/>/)

  const r = runTypeScriptScenario(`
    const { photoProblem, PHOTO_MAX_BYTES } = await import('./apps/web/src/features/provider/profile-photo-rules.ts')
    console.log(JSON.stringify({
      ok: [photoProblem({ size: 5000, type: 'image/jpeg' }), photoProblem({ size: PHOTO_MAX_BYTES, type: 'image/png' }), photoProblem({ size: 9, type: 'image/webp' })],
      malas: [photoProblem({ size: 5000, type: 'image/svg+xml' }), photoProblem({ size: 5000, type: 'image/gif' }), photoProblem({ size: 5000, type: '' }), photoProblem({ size: PHOTO_MAX_BYTES + 1, type: 'image/png' }), photoProblem({ size: 0, type: 'image/png' })].map((m) => typeof m),
    }))
  `)
  assert.deepEqual(r.ok, [null, null, null])
  assert.deepEqual(r.malas, Array(5).fill('string'))
})
