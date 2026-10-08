// Administration of the WhatsApp templates of TUS against Meta (WhatsApp Business Management API).
// Pure logic: what Meta has, what TUS defines (apps/api/src/tus/asistente/plantillas.ts, the only
// source of the texts), how they differ and what would have to be done. Nothing here prints or
// stores a credential; the two commands (listar-plantillas.mjs, sincronizar-plantillas.mjs) read
// the configuration the API already uses:
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_WABA_ID, WHATSAPP_GRAPH_API_VERSION, WHATSAPP_APPROVED_TEMPLATES.

export const GRAPH_POR_DEFECTO = 'v25.0'

// An example per variable, as Meta asks for when a template is created or edited.
export const EJEMPLOS = {
  nombre: 'Joaquin', cliente: 'Joaquin', contraparte: 'Flor Perez', servicio: 'Masaje', fecha: '9 de octubre', hora: '15:00',
  precio: '$20.000', sena: '$10.000', direccion: 'Junin 1234', zona: 'Centro', motivo: 'Se cortó la luz', resultado: 'aprobada', estado: 'en curso',
}

export class ErrorMeta extends Error {
  constructor(code, message, status = null) {
    super(message)
    this.name = 'ErrorMeta'
    this.code = code
    this.status = status
  }
}

// Never the token, the app secret or a whole credential: what is safe to show of the configuration.
export function configuracionDesdeEnv(env) {
  const token = (env.WHATSAPP_ACCESS_TOKEN ?? '').trim()
  const wabaId = (env.WHATSAPP_WABA_ID ?? '').trim()
  const version = (env.WHATSAPP_GRAPH_API_VERSION ?? '').trim() || GRAPH_POR_DEFECTO
  const faltan = [...(token ? [] : ['WHATSAPP_ACCESS_TOKEN']), ...(wabaId ? [] : ['WHATSAPP_WABA_ID'])]
  if (!/^v\d+\.\d+$/u.test(version)) faltan.push('WHATSAPP_GRAPH_API_VERSION (debe verse como v25.0)')
  const habilitadas = new Set((env.WHATSAPP_APPROVED_TEMPLATES ?? '').split(',').map((nombre) => nombre.trim()).filter(Boolean))
  return { token, wabaId, version, faltan, habilitadas, visible: { wabaId: wabaId ? `…${wabaId.slice(-4)}` : '(falta)', version, token: token ? 'presente' : '(falta)', habilitadas: [...habilitadas].sort() } }
}

// Anything that looks like a credential is removed from a text before it is shown.
export const redactar = (texto) => String(texto ?? '').replace(/(access_token=)[^&\s"']+/giu, '$1[oculto]').replace(/\b(EAA[A-Za-z0-9]{12,})\b/gu, '[oculto]').replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, '$1[oculto]')

// The components Meta stores for a definition of TUS.
export function componentesDe(definicion) {
  const ejemplos = definicion.parameters.map((clave) => EJEMPLOS[clave] ?? 'ejemplo')
  const cuerpo = { type: 'BODY', text: definicion.body, ...(ejemplos.length > 0 ? { example: { body_text: [ejemplos] } } : {}) }
  const botones = (definicion.buttons ?? []).length > 0 ? [{ type: 'BUTTONS', buttons: definicion.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) }] : []
  return [cuerpo, ...botones]
}

const limpio = (texto) => String(texto ?? '').replace(/\r\n/gu, '\n').trim()
const cuerpoDe = (componentes) => limpio((componentes ?? []).find((c) => String(c.type).toUpperCase() === 'BODY')?.text)
const botonesDe = (componentes) => ((componentes ?? []).find((c) => String(c.type).toUpperCase() === 'BUTTONS')?.buttons ?? []).map((boton) => `${String(boton.type).toUpperCase()}:${limpio(boton.text)}`)
const otrosDe = (componentes) => (componentes ?? []).map((c) => String(c.type).toUpperCase()).filter((tipo) => tipo !== 'BODY' && tipo !== 'BUTTONS')

// What differs between a definition of TUS and the template Meta has (empty: the same).
export function diferencias(definicion, remota) {
  const esperados = componentesDe(definicion)
  const lista = []
  if (String(remota.language) !== definicion.language) lista.push(`idioma: Meta ${remota.language}, TUS ${definicion.language}`)
  if (String(remota.category).toUpperCase() !== definicion.category) lista.push(`categoría: Meta ${remota.category}, TUS ${definicion.category}`)
  if (cuerpoDe(remota.components) !== cuerpoDe(esperados)) lista.push('cuerpo distinto')
  if (JSON.stringify(botonesDe(remota.components)) !== JSON.stringify(botonesDe(esperados))) lista.push(`botones: Meta [${botonesDe(remota.components).join(', ')}], TUS [${botonesDe(esperados).join(', ')}]`)
  if (otrosDe(remota.components).length > 0) lista.push(`Meta tiene componentes que TUS no define: ${otrosDe(remota.components).join(', ')}`)
  return lista
}

// Meta only lets a template be edited while it is approved, rejected or paused; one that is in
// review cannot be touched, and an edit always sends the template to review again.
const EDITABLES = new Set(['APPROVED', 'REJECTED', 'PAUSED'])
export const ETIQUETA_ESTADO = { APPROVED: 'aprobada', PENDING: 'en revisión', IN_APPEAL: 'en apelación', REJECTED: 'rechazada', PAUSED: 'pausada', DISABLED: 'deshabilitada', PENDING_DELETION: 'en eliminación', DELETED: 'eliminada', LIMIT_EXCEEDED: 'límite excedido' }
export const etiquetaEstado = (estado) => ETIQUETA_ESTADO[String(estado).toUpperCase()] ?? String(estado).toLowerCase()

// What would have to be done for each definition of TUS, and whether it can be used right now.
export function planificar(definiciones, remotas, habilitadas) {
  return definiciones.map((definicion) => {
    const mismas = remotas.filter((remota) => remota.name === definicion.name)
    const remota = mismas.find((item) => item.language === definicion.language) ?? null
    const base = { nombre: definicion.name, idioma: definicion.language, habilitadaEnTus: habilitadas.has(definicion.name), otrosIdiomas: mismas.filter((item) => item.language !== definicion.language).map((item) => item.language) }
    if (!remota) return { ...base, accion: 'crear', id: null, estado: null, diferencias: ['no existe en Meta'], utilizable: false, nota: 'Crearla la envía a revisión de Meta.' }
    const estado = String(remota.status).toUpperCase()
    const difs = diferencias(definicion, remota)
    // Usable in production only if it exists, is approved, matches and TUS has it enabled.
    const utilizable = estado === 'APPROVED' && difs.length === 0 && base.habilitadaEnTus
    const comun = { ...base, id: remota.id, estado, diferencias: difs, utilizable, motivoRechazo: remota.rejected_reason && remota.rejected_reason !== 'NONE' ? remota.rejected_reason : null }
    if (difs.length === 0) return { ...comun, accion: 'nada', nota: estado === 'APPROVED' ? (base.habilitadaEnTus ? 'Lista para usar.' : `Aprobada: falta agregar ${definicion.name} a WHATSAPP_APPROVED_TEMPLATES.`) : `Coincide con TUS; estado en Meta: ${etiquetaEstado(estado)}.` }
    if (difs.some((d) => d.startsWith('idioma'))) return { ...comun, accion: 'crear', nota: 'El idioma no se puede cambiar: hay que crearla en el idioma de TUS.' }
    if (!EDITABLES.has(estado)) return { ...comun, accion: 'no_editable', nota: `Meta no permite editar una plantilla ${etiquetaEstado(estado)}. Esperar a que termine la revisión, o crear una versión nueva con otro nombre (y cambiarlo en TUS).` }
    return { ...comun, accion: 'actualizar', nota: `Editarla la envía de nuevo a revisión de Meta${estado === 'APPROVED' ? ' (deja de estar aprobada hasta que la revisen; Meta limita las ediciones de una plantilla aprobada a 1 por día y 10 por mes)' : ''}.` }
  })
}

export class ClienteMetaPlantillas {
  constructor({ token, wabaId, version, fetch: fetchImpl = globalThis.fetch, baseUrl = 'https://graph.facebook.com' }) {
    this.token = token
    this.wabaId = wabaId
    this.version = version
    this.fetch = fetchImpl
    this.baseUrl = baseUrl
  }

  async pedir(method, path, body) {
    let response
    try {
      response = await this.fetch(`${this.baseUrl}/${this.version}/${path}`, { method, headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch (error) {
      throw new ErrorMeta('RED', `No se pudo conectar con Meta (${redactar(error?.message ?? error)}).`)
    }
    const json = await response.json().catch(() => null)
    if (!response.ok) {
      const e = json?.error ?? {}
      throw new ErrorMeta(String(e.code ?? response.status), redactar(`${e.message ?? 'Meta rechazó el pedido'}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}`), response.status)
    }
    return json
  }

  async listar() {
    const todas = []
    let path = `${this.wabaId}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100`
    for (let pagina = 0; path && pagina < 20; pagina += 1) {
      const json = await this.pedir('GET', path)
      todas.push(...(json?.data ?? []))
      const siguiente = json?.paging?.cursors?.after && json?.paging?.next ? json.paging.cursors.after : null
      path = siguiente ? `${this.wabaId}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100&after=${encodeURIComponent(siguiente)}` : null
    }
    return todas
  }

  crear(definicion) {
    return this.pedir('POST', `${this.wabaId}/message_templates`, { name: definicion.name, language: definicion.language, category: definicion.category, components: componentesDe(definicion) })
  }

  actualizar(id, definicion) {
    return this.pedir('POST', `${id}`, { components: componentesDe(definicion) })
  }
}

// Applies ONLY the named templates, and only what the plan says can be done. Without `aplicar`
// nothing is written to Meta (dry-run).
export async function sincronizar({ cliente, definiciones, habilitadas, solo = null, aplicar = false }) {
  const elegidas = solo ? definiciones.filter((definicion) => solo.includes(definicion.name)) : definiciones
  const desconocidas = solo ? solo.filter((nombre) => !definiciones.some((definicion) => definicion.name === nombre)) : []
  const plan = planificar(elegidas, await cliente.listar(), habilitadas)
  const resultados = []
  for (const item of plan) {
    if (!aplicar || (item.accion !== 'crear' && item.accion !== 'actualizar')) { resultados.push({ ...item, aplicado: false }); continue }
    const definicion = elegidas.find((d) => d.name === item.nombre)
    try {
      const respuesta = item.accion === 'crear' ? await cliente.crear(definicion) : await cliente.actualizar(item.id, definicion)
      resultados.push({ ...item, aplicado: true, id: respuesta?.id ?? item.id, estadoNuevo: respuesta?.status ?? 'PENDING' })
    } catch (error) {
      resultados.push({ ...item, aplicado: false, error: error instanceof ErrorMeta ? `${error.code}: ${error.message}` : redactar(error?.message ?? error) })
    }
  }
  return { resultados, desconocidas }
}

// The definitions of TUS, read from the API's own source (TypeScript) through its tsx.
export async function definicionesDeTus(raiz) {
  const { createRequire } = await import('node:module')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const { tsImport } = createRequire(join(raiz, 'apps/api/package.json'))('tsx/esm/api')
  const modulo = await tsImport(pathToFileURL(join(raiz, 'apps/api/src/tus/asistente/plantillas.ts')).href, import.meta.url)
  return modulo.PLANTILLAS_WHATSAPP
}

export function argumentos(argv) {
  const solo = argv.find((arg) => arg.startsWith('--solo='))?.slice('--solo='.length).split(',').map((nombre) => nombre.trim()).filter(Boolean) ?? null
  return { aplicar: argv.includes('--aplicar'), json: argv.includes('--json'), solo }
}
