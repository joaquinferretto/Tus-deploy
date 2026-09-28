import type { ServiceSearchOutcome } from './service-search'
import { describeOutcome } from './service-search'

// Logic of the TUS assistant (the widget only renders). It decides between: help about how TUS
// works, navigation to real screens, actions that need a session, and the shared service search
// (searchServices, the same one as the search bar). Answers only describe features that exist and
// only mention providers returned by the directory. There is no human support to hand off to.

export type AssistantRole = 'guest' | 'client' | 'provider' | 'admin'

export interface AssistantAction {
  label: string
  // Internal route (no raw URLs in the text) or an in-chat intent.
  href?: string
  intent?: 'how' | 'search-prompt'
}

export interface AssistantReply {
  text: string
  actions?: AssistantAction[]
  options?: { id: string; label: string }[]
  zone?: string | null
}

export interface ProviderStatus {
  // null: the account has no professional profile yet.
  profile: { id: string; visible: boolean; published: boolean } | null
}

export interface AssistantContext {
  role: AssistantRole
  name: string | null
  // Present on the home (the map is on the same screen); elsewhere the search opens the home.
  search?: (text: string) => Promise<ServiceSearchOutcome>
  help?: (text: string) => Promise<string | null>
  providerStatus?: () => Promise<ProviderStatus>
  returnTo: string
}

const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9ñ ]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

const has = (text: string, ...patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text))

function loginActions(returnTo: string): AssistantAction[] {
  const back = encodeURIComponent(returnTo)
  return [
    { label: 'Iniciar sesión', href: `/sign-in?returnTo=${back}` },
    { label: 'Registrarme', href: `/registro?returnTo=${back}` },
  ]
}

export function greeting(ctx: Pick<AssistantContext, 'role' | 'name' | 'returnTo'>): AssistantReply {
  if (ctx.role === 'guest')
    return {
      text: '¡Hola! Soy el asistente de TUS 👋 Puedo ayudarte a encontrar un profesional, explicarte cómo funciona la plataforma o ayudarte a publicar una solicitud. Para algunas acciones vas a necesitar iniciar sesión.',
      actions: [{ label: 'Buscar profesional', intent: 'search-prompt' }, { label: 'Cómo funciona TUS', intent: 'how' }, ...loginActions(ctx.returnTo)],
    }
  const hello = ctx.name ? `Hola ${ctx.name.split(' ')[0]} 👋 ¿Qué necesitás hacer?` : 'Hola 👋 ¿Qué necesitás hacer?'
  if (ctx.role === 'admin')
    return { text: hello, actions: [{ label: 'Buscar profesional', intent: 'search-prompt' }, { label: 'Ir al panel admin', href: '/tus/admin' }, { label: 'Cómo funciona TUS', intent: 'how' }] }
  if (ctx.role === 'provider')
    return {
      text: hello,
      actions: [{ label: 'Ver solicitudes', href: '/prestador/solicitudes' }, { label: 'Editar mi perfil profesional', href: '/prestador/perfil-publico' }, { label: 'Buscar profesional', intent: 'search-prompt' }],
    }
  return {
    text: hello,
    actions: [{ label: 'Buscar profesional', intent: 'search-prompt' }, { label: 'Publicar solicitud', href: '/publicar' }, { label: 'Mis solicitudes', href: '/mis-solicitudes' }, { label: 'Cómo funciona TUS', intent: 'how' }],
  }
}

export const HOW_IT_WORKS: AssistantReply = {
  text: 'En TUS podés buscar un profesional directamente en el mapa o publicar lo que necesitás. 1. Buscás el servicio. 2. Revisás profesionales o publicás una solicitud. 3. Los prestadores pueden postularse. 4. Elegís con quién hacer el trabajo.',
  actions: [{ label: 'Buscar profesional', intent: 'search-prompt' }],
}

export const SEARCH_PROMPT: AssistantReply = { text: '¿Qué servicio necesitás? Podés contarme el problema, por ejemplo: "se rompió una canilla".' }

// Intents that are about TUS itself (answered from what the app really offers). Order matters:
// specific questions first, the service search last.
export async function respond(input: string, ctx: AssistantContext): Promise<AssistantReply> {
  const text = norm(input)
  if (!text) return SEARCH_PROMPT
  const guest = ctx.role === 'guest'

  if (has(text, /\b(como funciona|que es tus|para que sirve|como se usa)\b/u)) return HOW_IT_WORKS

  if (has(text, /\b(tengo que publicar|publicar si o si|hace falta publicar|es obligatorio publicar)\b/u))
    return { text: 'No. Podés buscar profesionales directamente en el mapa. Si no encontrás lo que necesitás, también podés publicar una solicitud para que los prestadores interesados se postulen.' }

  if (has(text, /\b(iniciar sesion|ingresar|loguear|login|entrar a mi cuenta)\b/u))
    return guest ? { text: 'Podés iniciar sesión o crear una cuenta gratis.', actions: loginActions(ctx.returnTo) } : { text: 'Ya iniciaste sesión.' }
  if (has(text, /\b(registrar|registro|crear (una )?cuenta)\b/u) && !has(text, /prestador|profesional/u))
    return guest ? { text: 'Para crear tu cuenta necesitás un email y una contraseña.', actions: [{ label: 'Registrarme', href: `/registro?returnTo=${encodeURIComponent(ctx.returnTo)}` }] } : { text: 'Ya tenés una cuenta y la sesión está iniciada.' }

  // Provider questions.
  if (has(text, /\b(hacerme|ser|convertirme en|registrarme como) (prestador|profesional)\b|\bofrecer (mis )?servicios\b/u)) {
    if (guest) return { text: 'Primero creá tu cuenta; después completás tu perfil profesional con oficio y zona.', actions: [{ label: 'Registrarme', href: '/registro?intencion=prestador' }, { label: 'Iniciar sesión', href: '/sign-in?returnTo=%2Fprestador%2Fperfil-publico' }] }
    return { text: 'Completá tu perfil profesional: oficio, zonas donde trabajás y una descripción. Con eso tu perfil puede aparecer en el mapa.', actions: [{ label: 'Completar perfil profesional', href: '/prestador/perfil-publico' }] }
  }
  if (has(text, /\b(aparezco|aparecer en el mapa|estoy publicado|mi perfil (esta )?publicado|figuro)\b/u)) {
    if (guest) return { text: 'Para aparecer en el mapa necesitás una cuenta y un perfil profesional con oficio y zona.', actions: loginActions(ctx.returnTo) }
    const status = ctx.providerStatus ? await ctx.providerStatus().catch(() => null) : null
    if (!status) return { text: 'No pude consultar el estado de tu perfil ahora. Podés revisarlo desde tu perfil profesional.', actions: [{ label: 'Mi perfil profesional', href: '/prestador/perfil-publico' }] }
    if (!status.profile) return { text: 'Todavía no creaste tu perfil profesional. Completalo con tu oficio y zona para poder aparecer en el mapa.', actions: [{ label: 'Completar perfil profesional', href: '/prestador/perfil-publico' }] }
    if (!status.profile.visible) return { text: 'Tu perfil existe pero está oculto: activá "Mostrar en el directorio" para que aparezca.', actions: [{ label: 'Mi perfil profesional', href: '/prestador/perfil-publico' }] }
    if (!status.profile.published) return { text: 'Tu perfil está visible, pero todavía no está habilitado para aparecer en el mapa.', actions: [{ label: 'Mi perfil profesional', href: '/prestador/perfil-publico' }] }
    return { text: 'Tu perfil está publicado y aparece en el mapa.', actions: [{ label: 'Ver mi perfil público', href: `/trabajadores/${encodeURIComponent(status.profile.id)}` }] }
  }
  if (has(text, /\b(trabajos disponibles|ver solicitudes|solicitudes disponibles|como me postulo|postularme|mis postulaciones)\b/u)) {
    if (guest) return { text: 'Para ver solicitudes y postularte necesitás iniciar sesión con tu cuenta de prestador.', actions: loginActions('/prestador/solicitudes') }
    return { text: 'Las solicitudes que te llegan y tus postulaciones están en tu panel de prestador.', actions: [{ label: 'Ver solicitudes', href: '/prestador/solicitudes' }] }
  }
  if (has(text, /\bdisponibilidad\b|\bhorarios?\b/u) && !guest)
    return { text: 'Tu disponibilidad sale de los días y horarios de tus servicios publicados. Podés revisarla desde tu panel.', actions: [{ label: 'Ir a mi panel', href: ctx.role === 'provider' ? '/prestador/solicitudes' : '/mis-solicitudes' }] }

  // Client questions.
  if (has(text, /\b(publicar|publico|publica|pedir un presupuesto)\b/u)) {
    if (guest) return { text: 'Para publicar una solicitud necesitás iniciar sesión o crear una cuenta.', actions: loginActions('/publicar') }
    return { text: 'Contá qué necesitás, la zona y, si querés, agregá fotos. Los prestadores interesados se postulan.', actions: [{ label: 'Publicar solicitud', href: '/publicar' }] }
  }
  if (has(text, /\b(postulo|postularon|postulantes|postulados|quien se postulo)\b/u) || has(text, /\bmis solicitudes\b|\bmis pedidos\b/u)) {
    if (guest) return { text: 'Tus solicitudes y sus postulantes se ven con la sesión iniciada.', actions: loginActions('/mis-solicitudes') }
    return { text: 'Podés verlo dentro de tus solicitudes: entrá a la solicitud y vas a encontrar la lista de postulantes.', actions: [{ label: 'Mis solicitudes', href: '/mis-solicitudes' }] }
  }
  if (has(text, /\b(elijo|elegir|contratar|aceptar) (a )?(un |una |este |ese |al )?(profesional|prestador|postulante|plomero|electricista|pintor)?\b/u) && has(text, /\b(elijo|elegir|contratar|contrato|aceptar)\b/u)) {
    if (guest) return { text: 'Para contratar necesitás iniciar sesión o crear una cuenta.', actions: loginActions(ctx.returnTo) }
    return { text: 'Abrí el perfil del profesional y tocá "Solicitar servicio", o elegí a uno de los postulantes desde tus solicitudes.', actions: [{ label: 'Mis solicitudes', href: '/mis-solicitudes' }] }
  }
  if (has(text, /\b(editar|modificar|cambiar) (la |una |mi )?solicitud\b/u))
    return { text: 'Por ahora una solicitud no se puede editar. Si cambió lo que necesitás, cerrala desde tus solicitudes y publicá una nueva.', actions: guest ? loginActions('/mis-solicitudes') : [{ label: 'Mis solicitudes', href: '/mis-solicitudes' }] }
  if (has(text, /\b(cancelar|cancelo|cerrar|dar de baja) (la |una |mi )?solicitud\b|\bcomo cancelo\b/u))
    return { text: 'Podés cerrar una solicitud desde tus solicitudes: deja de recibir postulaciones.', actions: guest ? loginActions('/mis-solicitudes') : [{ label: 'Mis solicitudes', href: '/mis-solicitudes' }] }
  if (has(text, /\b(mi perfil|mis datos|modificar mi perfil|cambiar mi nombre)\b/u))
    return guest ? { text: 'Tu perfil se ve con la sesión iniciada.', actions: loginActions('/mi-perfil') } : { text: 'Claro.', actions: [{ label: 'Ir a mi perfil', href: '/mi-perfil' }] }
  if (has(text, /\b(panel admin|administracion|administrar)\b/u) && ctx.role === 'admin')
    return { text: 'Las tareas de administración se hacen desde el panel.', actions: [{ label: 'Ir al panel admin', href: '/tus/admin' }] }

  // Service search (shared with the search bar). Off the home, it opens the home map.
  if (!ctx.search) {
    return { text: 'Te muestro los profesionales en el mapa.', actions: [{ label: 'Ver en el mapa', href: `/?buscar=${encodeURIComponent(input.trim().slice(0, 200))}` }] }
  }
  const outcome = await ctx.search(input)
  if (outcome.kind === 'text' && outcome.providers.length === 0) {
    const help = ctx.help ? await ctx.help(input).catch(() => null) : null
    if (help) return { text: help }
    return { text: 'No estoy seguro de qué necesitás. Contame el problema con otras palabras (por ejemplo "no prende el aire") o preguntame cómo funciona TUS.', actions: [{ label: 'Cómo funciona TUS', intent: 'how' }] }
  }
  const reply: AssistantReply = { text: describeOutcome(outcome) }
  if (outcome.kind === 'choose') return { ...reply, options: outcome.options, zone: outcome.zone }
  if ((outcome.kind === 'category' || outcome.kind === 'text') && outcome.providers.length === 0)
    return { ...reply, actions: guest ? [{ label: 'Publicar solicitud', href: '/sign-in?returnTo=%2Fpublicar' }] : [{ label: 'Publicar solicitud', href: '/publicar' }] }
  return reply
}
