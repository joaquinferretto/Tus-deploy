import { sinAcentos } from '../texto.ts'

// ASISTENTE-AYUDA-01. Help that interrupts any step. A person in the middle of a flow ("necesito
// tu nombre y DNI") may ask something instead of answering ("¿cómo verifico mi número?"): that is
// a question, not an answer, and it is recognised BEFORE the step reads the message. Here: which
// topics exist, the deterministic floor that recognises them (a model may recognise more), the
// REAL routes of the Web each one points to, and the wording for each real state of the account.
// Nothing here knows a state by itself: the states are read by the backend and passed in.

export const TEMAS_AYUDA = [
  'registration',
  'login',
  'password_reset',
  'phone_verification',
  'whatsapp_linking',
  'linking_code',
  'phone_change',
  'account_status',
  'identity_data',
  'profile',
  'provider_profile',
  'provider_services',
  'provider_schedule',
  'provider_location',
  'mercado_pago',
  'earnings',
  'appointments',
  'my_appointments',
  'deposit',
  'payments',
  'receipts',
  'cancellations',
  'rescheduling',
  'service_request',
  'works',
  'lodging',
  'how_it_works',
  'navigation',
  'support',
  'stuck',
  'next_step',
] as const
export type TemaAyuda = (typeof TEMAS_AYUDA)[number]

// Topics answered from the REAL state of the account behind this WhatsApp (never from a manual).
export const TEMAS_DE_CUENTA: readonly TemaAyuda[] = ['registration', 'login', 'password_reset', 'phone_verification', 'whatsapp_linking', 'linking_code', 'phone_change', 'account_status', 'identity_data', 'stuck', 'next_step']

// The real pages of the Web (apps/web/src/app). A test checks that every one of them exists.
export const RUTAS_TUS = {
  registro: '/registro',
  ingresar: '/sign-in',
  recuperarContrasena: '/olvide-contrasena',
  recuperarPorWhatsapp: '/recuperar-por-whatsapp',
  miPerfil: '/mi-perfil',
  vincularWhatsapp: '/mi-perfil?accion=vincular-whatsapp',
  misTurnos: '/mis-turnos',
  misSolicitudes: '/mis-solicitudes',
  trabajos: '/trabajos',
  buscar: '/buscar-trabajador',
  comoFunciona: '/como-funciona',
  alojamientos: '/alojamientos',
  perfilPrestador: '/prestador/perfil-publico',
  agendaPrestador: '/prestador/turnos',
  pagosPrestador: '/prestador/pagos',
  ubicacionPrestador: '/prestador/ubicacion',
  solicitudesPrestador: '/prestador/solicitudes',
} as const
export type RutaTus = keyof typeof RUTAS_TUS

export const enlaceTus = (webBaseUrl: string | null | undefined, ruta: RutaTus): string | null => (webBaseUrl ? `${webBaseUrl.replace(/\/+$/u, '')}${RUTAS_TUS[ruta]}` : null)

// The guide of the Help Center about each topic (the slug of an article of docs/conocimiento: the
// same documents the knowledge index reads). The assistant answers first and offers the guide
// after; when it knows the topic it links THAT guide, never the generic /ayuda. A test checks
// that every slug is a published article.
export const GUIA_DE_TEMA: Partial<Record<TemaAyuda, string>> = {
  registration: 'registro',
  login: 'registro',
  password_reset: 'registro',
  phone_verification: 'verificar-celular',
  phone_change: 'verificar-celular',
  whatsapp_linking: 'vincular-whatsapp',
  linking_code: 'vincular-whatsapp',
  account_status: 'vincular-whatsapp',
  identity_data: 'vincular-whatsapp',
  profile: 'verificar-celular',
  appointments: 'turnos',
  my_appointments: 'turnos',
  cancellations: 'turnos',
  rescheduling: 'turnos',
  deposit: 'pagos',
  payments: 'pagos',
  receipts: 'pagos',
  service_request: 'solicitudes',
  works: 'presupuestos',
  how_it_works: 'empezar',
  support: 'problemas-frecuentes',
  provider_profile: 'prestadores/perfil-publico',
  provider_services: 'prestadores/servicios',
  provider_schedule: 'prestadores/disponibilidad',
  provider_location: 'prestadores/perfil-publico',
  mercado_pago: 'prestadores/mercado-pago',
  earnings: 'prestadores/ganancias',
}

export const enlaceGuia = (webBaseUrl: string | null | undefined, slug: string): string | null => (webBaseUrl ? `${webBaseUrl.replace(/\/+$/u, '')}/ayuda/${slug}` : null)

// The guide for a question about the account: the one of the step that is really missing.
export function guiaDeCuenta(tema: TemaAyuda, estado: EstadoVinculoCuenta): string | null {
  if (estado === 'vinculado') return null
  if (tema === 'stuck' || tema === 'next_step') return estado === 'sin_cuenta' ? 'verificar-celular' : 'vincular-whatsapp'
  // The number is already verified: what is left is the link, whatever was asked about verifying.
  if (tema === 'phone_verification' && estado !== 'sin_cuenta') return 'vincular-whatsapp'
  return GUIA_DE_TEMA[tema] ?? null
}

const plano = (texto: string): string =>
  sinAcentos(texto.toLowerCase().slice(0, 400))
    .replace(/[^a-z0-9ñ\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

// A message that asks, complains or says something does not work: not an answer to a step.
const PIDE_AYUDA = new RegExp(
  [
    String.raw`\bcomo\b`,
    String.raw`\b(?:a )?donde\b`,
    String.raw`\bpor que\b`,
    String.raw`\bpara que\b`,
    String.raw`\bque (?:significa|es|son|pasa|paso|tengo que|hago|hay que|debo|necesito|quiere decir|sigue)\b`,
    String.raw`\bcual es\b`,
    String.raw`\bno (?:puedo|pude|se|entiendo|entendi|encuentro|funciona|anda|sirve|aparece|llega|llego|carga|abre)\b`,
    String.raw`\bno me (?:deja|dejo|reconoce|reconocio|llega|llego|funciona|aparece|sale|toma|anda|permite|carga)\b`,
    String.raw`\bme (?:dice|pide|sale|aparece|sigue|vuelve|tira|rechazo|rechaza)\b`,
    String.raw`\b(?:ayuda|ayudame|problema|error|falla|fallo)\b`,
    String.raw`\bquiero (?:verificar|vincular|registrarme|cambiar|recuperar)\b`,
    String.raw`\b(?:vencio|vencido|invalido|expiro|caduco)\b`,
    String.raw`\by (?:despues|ahora|luego)\b`,
    String.raw`\bcambie de (?:numero|celular|telefono)\b`,
    String.raw`\bme olvide\b`,
  ].join('|'),
  'u'
)
// Explanations asked about a thing ("¿qué significa la seña?", "¿por qué tengo que pagar?"): help
// even when the words also look like an operation ("pagar la seña").
const PIDE_EXPLICACION = /\b(?:por que|para que|que (?:significa|es|son|pasa|paso|quiere decir)|como funciona[n]?)\b/u
// "No funciona", "otra vez me pide lo mismo", "ya hice eso": the last instruction did not work.
const FRUSTRACION = /\b(?:no funciona|no anda|no sirve|otra vez|de nuevo me|me sigue|sigue (?:saliendo|pidiendo|igual)|me vuelve a|lo mismo|ya hice eso|ya lo hice y|no entiendo|que mierda|que carajo|la puta|estoy hart[oa]|no me deja)\b/u
// "Listo", "ya está", "ya lo hice": the person says a step is done. Never believed: re-checked.
const HECHO = /^(?:listo|ya esta|ya lo hice|ya|hecho|ya verifique|ya vincule|ya me registre|ya esta hecho|ya lo verifique|ya lo vincule|listo ya esta|ya termine|termine|lo hice)(?: (?:y ahora|ahora que|que hago|como sigo|seguimos|sigamos))?$/u

const TELEFONO = String.raw`(?:numero|telefono|celu|celular|cel)`
const TEMAS: [TemaAyuda, RegExp][] = [
  ['linking_code', new RegExp(String.raw`\bcodigo\b|\bverificar tus\b|\bno me llego\b`, 'u')],
  ['phone_change', new RegExp(String.raw`\bcambi\w* (?:de |el |mi )?${TELEFONO}\b|\b(?:otro|nuevo) ${TELEFONO}\b`, 'u')],
  ['phone_verification', new RegExp(String.raw`\b(?:verific\w*|valid\w*|confirm\w*)\b.*\b${TELEFONO}\b|\b${TELEFONO}\b.*\b(?:verific\w*|valid\w*)\b|\bno me reconoce (?:el |mi )?${TELEFONO}\b|\bya puse mi ${TELEFONO}\b`, 'u')],
  // A payment that was rejected or did not show up is a payment problem, whoever processed it.
  ['payments', /\brechaz\w*|\bacredit\w*|\bno (?:me )?aparece (?:el|mi) pago\b/u],
  // Connecting Mercado Pago is the provider's; before "vincular", which is about WhatsApp.
  ['mercado_pago', /\b(?:vincul\w*|conect\w*|configur\w*|asoci\w*)\b.*\bmercado ?pago\b|\bmercado ?pago\b.*\b(?:vincul\w*|conect\w*|configur\w*|cuenta)\b/u],
  ['whatsapp_linking', /\bvincul\w*|\bwhatsapp\b|\bwasap\b|\bwpp\b/u],
  ['password_reset', /\bcontrasena\b|\bclave\b|\bpassword\b/u],
  ['registration', /\bregistr\w*|\b(?:crear|hacer|abrir|tener)(?:me)? (?:una |la |mi )?cuenta\b|\bdarme de alta\b|\bno estoy registrad[oa]\b|\bno tengo cuenta\b/u],
  ['login', /\b(?:inici\w*|cerr\w*) sesion\b|\binicio de sesion\b|\blogue\w*|\bloge\w*|\b(?:entrar|ingresar|acceder)\b|\bcredenciales\b|\bno me deja entrar\b/u],
  ['identity_data', /\b(?:dni|documento)\b|\bnombre (?:completo|y)\b|\bmis datos\b/u],
  ['receipts', /\bcomprobante\w*|\bcaptura\b|\brecibo\b/u],
  ['earnings', /\bganancias?\b|\bretir\w* (?:la |mi )?(?:plata|dinero)\b|\bliquidaci\w*|\bcobr(?:o|ar|e) (?:mis|los) trabajos\b/u],
  ['deposit', /\bsenas?\b/u],
  ['payments', /\bpag\w*|\babon\w*|\bacredit\w*|\breembols\w*|\breintegr\w*|\bdevoluci\w*/u],
  ['rescheduling', /\breprogram\w*|\bcambi\w* (?:el |de |mi )?(?:horario|turno|dia|fecha|hora)\b|\bpasar (?:el |mi )?turno\b/u],
  ['cancellations', /\bcancel\w*|\bdar de baja (?:el|mi) turno\b|\banular\b/u],
  ['my_appointments', /\bmis turnos\b|\bmi turno\b|\b(?:ver|veo) (?:los |mis )?turnos\b/u],
  ['provider_schedule', /\b(?:mis|los) horarios\b|\bmi agenda\b|\bmi disponibilidad\b|\bdias que atiendo\b/u],
  ['provider_services', /\bmis servicios\b|\bmis precios\b|\bconfigur\w* (?:mis |los )?(?:servicios|precios)\b|\bmi tarifa\b/u],
  ['provider_location', /\bmi (?:ubicacion|zona|direccion)\b|\bmis zonas\b/u],
  ['provider_profile', /\b(?:mi |la )foto\b|\bperfil publico\b|\bmi perfil (?:de prestador|publico)\b/u],
  ['profile', /\bmi perfil\b|\bmis datos\b|\bmi cuenta\b/u],
  ['service_request', /\b(?:mis )?solicitud(?:es)?\b|\bpostul\w*/u],
  ['works', /\b(?:mis )?trabajos?\b|\bpresupuesto\w*/u],
  ['lodging', /\balojamiento\w*|\bhospedaje\b|\bcabana\w*/u],
  ['appointments', /\bturnos?\b|\breserv\w*/u],
  ['support', /\bsoporte\b|\breclamo\b|\bhablar con\b/u],
  ['how_it_works', /\bcomo funciona\b|\bque es tus\b|\bpara que sirve\b/u],
  ['navigation', /\bdonde\b/u],
]

export interface AyudaDetectada {
  tema: TemaAyuda
  // The person says the last instruction did not work: diagnose, never repeat it.
  frustracion: boolean
  // The person says a step is done ("listo"): the backend re-reads the real state.
  hecho: boolean
  // "¿y después?", "¿qué hago ahora?": what comes next, not the explanation again.
  siguiente: boolean
}

// The deterministic floor: recognises help in the ways people usually ask it. null: the message
// does not look like a question or a problem (it may be an answer to the step in progress, or a
// model may still recognise it). `enPaso`: a step is waiting, so "listo" and "¿y después?" mean
// something.
export function detectarAyuda(mensaje: string, opciones: { enPaso?: boolean } = {}): AyudaDetectada | null {
  const texto = plano(mensaje)
  if (!texto) return null
  const hecho = HECHO.test(texto)
  const frustracion = FRUSTRACION.test(texto)
  const siguiente = /^(?:y )?(?:despues|ahora|luego)(?: que)?(?: hago| sigue| viene)?$|\bque (?:hago|sigue|viene) (?:ahora|despues|luego)\b|\bcomo sigo\b|\by despues\b/u.test(texto)
  if (hecho && opciones.enPaso) return { tema: 'next_step', frustracion: false, hecho: true, siguiente: false }
  if (!PIDE_AYUDA.test(texto) && !frustracion && !siguiente) return null
  const tema = TEMAS.find(([, patron]) => patron.test(texto))?.[0]
  if (tema) return { tema, frustracion, hecho: false, siguiente }
  // No topic named: only inside a step is it about that step ("no funciona", "¿y después?").
  if (!opciones.enPaso) return null
  if (siguiente) return { tema: 'next_step', frustracion, hecho: false, siguiente: true }
  return frustracion ? { tema: 'stuck', frustracion: true, hecho: false, siguiente: false } : null
}

// Asked as an explanation ("¿por qué tengo que pagar seña?"): help, even if it names an operation.
export const pideExplicacion = (mensaje: string): boolean => PIDE_EXPLICACION.test(plano(mensaje))

// ---- account: one wording per REAL state ------------------------------------------------------

export type EstadoVinculoCuenta = 'vinculado' | 'verificado_sin_vinculo' | 'desafio_pendiente' | 'sin_cuenta' | 'conflicto'
// What happened to the last verification / link code created for this number.
export type EstadoDesafio = 'ninguno' | 'pendiente' | 'vencido' | 'usado' | 'invalidado'

export interface RespuestaAyuda {
  texto: string
  // A real page of the Web to continue on, with the label of its button.
  ruta: RutaTus | null
  boton: string | null
}

const VERIFICAR_VS_VINCULAR = 'Son dos pasos distintos: verificar confirma que el teléfono es de tu cuenta; vincular conecta este WhatsApp con esa cuenta.'

// The situational answer to an account question, from the state the backend read for THIS number.
export function ayudaDeCuenta(tema: TemaAyuda, estado: EstadoVinculoCuenta, desafio: EstadoDesafio, opciones: { frustracion?: boolean; hecho?: boolean; siguiente?: boolean; sesionWeb?: boolean } = {}): RespuestaAyuda {
  const sesion = opciones.sesionWeb ? 'Tu sesión de la Web y este WhatsApp son accesos distintos: desde acá no puedo ver si iniciaste sesión. ' : ''
  // "¿Para qué querés mi DNI?": why the data is asked, and the way to not have to write it.
  if (tema === 'identity_data' && estado !== 'vinculado') {
    const porque = 'Te pido nombre completo y DNI para encontrar tu cuenta TUS: un turno se solicita a nombre de una cuenta y este WhatsApp todavía no está vinculado a ninguna. El documento no queda guardado en la conversación.'
    if (estado === 'verificado_sin_vinculo') return { texto: `${sesion}${porque} Si preferís no escribirlo, vinculá este WhatsApp desde Mi perfil y te reconozco sin pedirte datos.`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
    if (estado === 'sin_cuenta') return { texto: `${sesion}${porque} Si todavía no tenés cuenta, registrate primero; después verificá tu teléfono en Mi perfil.`, ruta: 'registro', boton: 'Registrarme' }
    return { texto: `${sesion}${porque}`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
  }
  if (estado === 'vinculado') {
    const base = 'Tu número ya está verificado y este WhatsApp ya está vinculado a tu cuenta TUS.'
    if (tema === 'registration') return { texto: `${sesion}No hace falta que te registres de nuevo: ${base.charAt(0).toLowerCase()}${base.slice(1)}`, ruta: null, boton: null }
    if (tema === 'phone_change') return { texto: `${sesion}${base} Para cambiar el número entrá a Mi perfil y tocá "Cambiar número de celular"; el vínculo pasa al número nuevo cuando lo verifiques desde ese WhatsApp.`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
    if (tema === 'password_reset') return { texto: `${sesion}La contraseña se recupera en la Web: con tu email, o con este WhatsApp si es tu número verificado.`, ruta: 'recuperarContrasena', boton: 'Recuperar contraseña' }
    if (tema === 'login') return { texto: `${sesion}${base} Para entrar a la Web usá tu email y contraseña (o Google).`, ruta: 'ingresar', boton: 'Iniciar sesión' }
    return { texto: `${sesion}${base}`, ruta: null, boton: null }
  }
  if (estado === 'conflicto') return { texto: `${sesion}Este número figura asociado a otra vinculación de WhatsApp, así que no lo puedo vincular desde acá. Entrá a Mi perfil para revisar qué WhatsApp tiene tu cuenta.`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
  if (estado === 'verificado_sin_vinculo') {
    const falta = 'Tu número ya está verificado; lo que falta es vincular este WhatsApp con tu cuenta TUS.'
    const como = 'Entrá a Mi perfil, tocá "Vincular este WhatsApp" y enviá desde acá el mensaje que te muestra.'
    if (tema === 'linking_code' || desafio === 'vencido' || desafio === 'usado' || desafio === 'invalidado') {
      const causa = desafio === 'vencido' ? 'El último código que generaste venció (dura 10 minutos).' : desafio === 'usado' ? 'El último código ya fue usado y sirve una sola vez.' : desafio === 'invalidado' ? 'El último código quedó anulado (se generó otro después, o se envió desde otro número).' : 'No hay ningún código esperando para este número.'
      return { texto: `${sesion}${causa} ${falta} Generá uno nuevo: ${como.charAt(0).toLowerCase()}${como.slice(1)}`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
    }
    if (tema === 'phone_verification') return { texto: `${sesion}No necesitás verificarlo otra vez. ${falta} ${como}`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
    if (tema === 'registration') return { texto: `${sesion}No hace falta que te registres de nuevo: este número ya es el teléfono verificado de una cuenta TUS. ${falta} ${como}`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
    if (opciones.frustracion || tema === 'stuck') return { texto: `${sesion}${falta} ${VERIFICAR_VS_VINCULAR} ${como}`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
    if (opciones.hecho) return { texto: `${sesion}Todavía no figura el vínculo. ${falta} ${como}`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
    if (opciones.siguiente || tema === 'next_step') return { texto: `${sesion}Lo que sigue es vincular este WhatsApp: ${como.charAt(0).toLowerCase()}${como.slice(1)}`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
    return { texto: `${sesion}${falta} ${como}`, ruta: 'vincularWhatsapp', boton: 'Vincular WhatsApp' }
  }
  if (estado === 'desafio_pendiente') {
    const pendiente = 'Hay una verificación en curso para este número: falta enviar desde este WhatsApp el mensaje "VERIFICAR TUS" con el código que te muestra Mi perfil.'
    if (opciones.hecho || opciones.frustracion || tema === 'linking_code' || tema === 'stuck') return { texto: `${sesion}Todavía no me llegó el código de este número. ${pendiente} Si el código no aparece o pasaron más de 10 minutos, generá uno nuevo desde Mi perfil.`, ruta: 'vincularWhatsapp', boton: 'Ir a Mi perfil' }
    return { texto: `${sesion}${pendiente}`, ruta: 'vincularWhatsapp', boton: 'Ir a Mi perfil' }
  }
  // sin_cuenta: this number is not the verified phone of any account.
  const sinVerificar = 'Este número todavía no figura verificado en una cuenta TUS.'
  const pasos = 'Iniciá sesión en la Web, entrá a Mi perfil, cargá este número y tocá "Verificar mi número": se abre WhatsApp con un mensaje listo para enviar desde acá. Eso verifica el teléfono y vincula este WhatsApp.'
  if (tema === 'registration') return { texto: `${sesion}${sinVerificar} Si todavía no tenés cuenta, registrate con tu email. Después verificá tu teléfono en Mi perfil.`, ruta: 'registro', boton: 'Registrarme' }
  if (tema === 'login') return { texto: `${sesion}Se entra desde la Web con tu email y contraseña (o con Google). ${sinVerificar} Cuando entres, verificá tu teléfono en Mi perfil para que te reconozca por acá.`, ruta: 'ingresar', boton: 'Iniciar sesión' }
  if (tema === 'password_reset') return { texto: `${sesion}La contraseña se recupera en la Web con tu email. Por WhatsApp solo se puede recuperar con un número ya verificado, y este todavía no lo está.`, ruta: 'recuperarContrasena', boton: 'Recuperar contraseña' }
  if (tema === 'phone_change') return { texto: `${sesion}${sinVerificar} Si cambiaste de número, entrá a Mi perfil, tocá "Cambiar número de celular" y verificá el nuevo desde este WhatsApp.`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
  if (tema === 'linking_code' || desafio === 'vencido' || desafio === 'usado' || desafio === 'invalidado') {
    const causa = desafio === 'vencido' ? 'El último código que generaste para este número venció (dura 10 minutos).' : desafio === 'usado' ? 'El último código ya fue usado y sirve una sola vez.' : desafio === 'invalidado' ? 'El último código quedó anulado: se generó otro después, o se envió desde un número distinto al que cargaste.' : 'No hay ningún código esperando para este número: tiene que enviarse desde el mismo número que cargaste en Mi perfil.'
    return { texto: `${sesion}${causa} Generá uno nuevo en Mi perfil con "Verificar mi número" y enviá el mensaje desde acá sin modificarlo.`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
  }
  if (opciones.hecho) return { texto: `${sesion}Todavía no figura: ${sinVerificar.charAt(0).toLowerCase()}${sinVerificar.slice(1)} ${pasos}`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
  if (opciones.frustracion || tema === 'stuck') return { texto: `${sesion}${sinVerificar} Por eso no te reconozco desde este WhatsApp. ${VERIFICAR_VS_VINCULAR} ${pasos}`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
  if (opciones.siguiente || tema === 'next_step') return { texto: `${sesion}Lo que sigue es verificar este número: ${pasos.charAt(0).toLowerCase()}${pasos.slice(1)}`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
  return { texto: `${sesion}${sinVerificar} ${pasos}`, ruta: 'miPerfil', boton: 'Ir a Mi perfil' }
}

// ---- where things are: real pages, by role ------------------------------------------------------

// Where a thing is done in the Web. null: the topic has no page of its own (answered from the
// knowledge base). `soloPrestador`: the page belongs to the provider panel.
export function rutaDeTema(tema: TemaAyuda): { ruta: RutaTus; boton: string; donde: string; soloPrestador?: boolean } | null {
  switch (tema) {
    case 'profile':
      return { ruta: 'miPerfil', boton: 'Ir a Mi perfil', donde: 'Tus datos, tu número de celular y el vínculo con WhatsApp están en Mi perfil.' }
    case 'phone_change':
      return { ruta: 'miPerfil', boton: 'Ir a Mi perfil', donde: 'El número se cambia en Mi perfil, con "Cambiar número de celular".' }
    case 'my_appointments':
      return { ruta: 'misTurnos', boton: 'Ver mis turnos', donde: 'Tus turnos, su estado y la seña de cada uno están en Mis turnos.' }
    case 'cancellations':
      return { ruta: 'misTurnos', boton: 'Ver mis turnos', donde: 'Un turno se cancela desde Mis turnos: "Retirar solicitud" si todavía está pendiente, "Cancelar turno" si ya fue aceptado.' }
    case 'rescheduling':
      return { ruta: 'misTurnos', boton: 'Ver mis turnos', donde: 'Hoy un turno no se reprograma: se cancela desde Mis turnos y se pide uno nuevo en el horario que quieras.' }
    case 'service_request':
      return { ruta: 'misSolicitudes', boton: 'Ver mis solicitudes', donde: 'Tus solicitudes y quién se postuló están en Mis solicitudes.' }
    case 'works':
      return { ruta: 'trabajos', boton: 'Ver mis trabajos', donde: 'Tus trabajos y sus presupuestos están en Trabajos.' }
    case 'lodging':
      return { ruta: 'alojamientos', boton: 'Ver alojamientos', donde: 'Los alojamientos se buscan y se reservan desde la Web, en Alojamientos.' }
    case 'provider_profile':
      return { ruta: 'perfilPrestador', boton: 'Ir a mi perfil público', donde: 'La foto, la descripción y los servicios que ofrecés se cargan en tu perfil público de prestador.', soloPrestador: true }
    case 'provider_services':
      return { ruta: 'agendaPrestador', boton: 'Ir a mis turnos', donde: 'El precio, la duración y las variantes de cada servicio se configuran en el panel de turnos del prestador.', soloPrestador: true }
    case 'provider_schedule':
      return { ruta: 'agendaPrestador', boton: 'Ir a mi agenda', donde: 'Tus horarios de atención y los bloqueos de agenda se configuran en el panel de turnos del prestador.', soloPrestador: true }
    case 'provider_location':
      return { ruta: 'ubicacionPrestador', boton: 'Ir a mi ubicación', donde: 'Tu zona y tu ubicación se configuran en Ubicación, dentro del panel de prestador.', soloPrestador: true }
    case 'mercado_pago':
      return { ruta: 'pagosPrestador', boton: 'Ir a Pagos', donde: 'Mercado Pago se conecta desde Pagos, en el panel de prestador.', soloPrestador: true }
    case 'earnings':
      return { ruta: 'pagosPrestador', boton: 'Ir a Pagos', donde: 'Tus ganancias y los retiros están en Pagos, en el panel de prestador.', soloPrestador: true }
    default:
      return null
  }
}

// What the turn was doing when the question arrived, said once after the answer.
export function lineaDeReanudacion(pendiente: { servicio: string; profesional: string | null; cuando: string | null; espera: 'identidad' | 'servicio' | 'eleccion' | 'confirmacion' | 'busqueda' } | null, resuelto = false): string {
  if (!pendiente) return ''
  const que = `tu turno de ${pendiente.servicio}${pendiente.profesional ? ` con ${pendiente.profesional}` : ''}${pendiente.cuando ? `, ${pendiente.cuando}` : ''}`
  if (pendiente.espera === 'identidad') return resuelto ? `Seguimos con ${que}.` : `Cuando lo resuelvas, escribime y seguimos con ${que}: queda guardado.`
  if (pendiente.espera === 'busqueda') return `Seguimos con tu búsqueda de ${pendiente.servicio} cuando quieras.`
  return `Seguimos con ${que} cuando quieras.`
}
