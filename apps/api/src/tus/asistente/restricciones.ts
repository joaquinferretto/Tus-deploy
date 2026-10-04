import { sinAcentos } from '../texto.ts'

// ASISTENTE-RESTRICCIONES-01. What a message CHANGES in a request that is under way: "otra
// persona", "que no sea Juan", "cualquiera menos la segunda", "dejalo", "cambiame el horario".
// Pure reading of the text: it says WHAT was meant ("the current one", "position 2", these
// words). WHO that is — which professional, which option — is resolved by the backend against the
// state of the conversation (the professional chosen, the options really shown). Nothing here
// knows a provider id and no model is asked.

const plano = (text: string): string => sinAcentos(text.toLowerCase()).replace(/[¿¡]/gu, ' ').replace(/\s+/gu, ' ').trim()

// Rude words carry no instruction. They are taken out before reading the message, so what the
// person asked for is still understood; the answer never mentions them.
const INSULTOS = [
  /\b(?:la |re)?concha(?: puta)?(?: de)?(?: (?:tu|su|la))?(?: (?:madre|hermana|vieja|lora))?\b/gu,
  /\b(?:la )?puta (?:madre|que te pario)(?: que te (?:re )?pario)?\b/gu,
  /\bhij[oa]s? de (?:re )?(?:mil )?put[ao]s?\b/gu,
  /\b(?:and(?:a|ate)|vayan(?:se)?) a (?:la )?(?:mierda|cagar|concha de tu madre)\b/gu,
  /\b(?:de|por) (?:la )?mierda\b/gu,
  /\b(?:re)?(?:put[ao]s?|mierda|pelotud[ao]s?|bolud[ao]s?|forr[ao]s?|idiotas?|imbecil(?:es)?|estupid[ao]s?|tarad[ao]s?|inutil(?:es)?|carajo|hdp|pajer[ao]s?|mogolic[ao]s?|sorete|chupame(?:la)?|garca|basura|pedazo de)\b/gu,
]

export function sinInsultos(text: string): string {
  let limpio = plano(text)
  for (const patron of INSULTOS) limpio = limpio.replace(patron, ' ')
  return limpio.replace(/\s+([,.;!?])/gu, '$1').replace(/\s+/gu, ' ').trim()
}

export const tieneInsultos = (text: string): boolean => sinInsultos(text) !== plano(text)

// "te dije que no", "otra vez lo mismo", "no entendés": the person is repeating themselves. The
// previous answer must not be sent again.
const FRUSTRACION = /\b(?:(?:ya )?te (?:lo )?dije|te estoy diciendo|otra vez (?:lo mismo|con (?:lo mismo|es[eao]|ell[ao]))|de nuevo lo mismo|siempre lo mismo|no (?:me )?entend(?:es|iste|e)|no escuchas|no lees|me (?:estas|seguis) (?:ofreciendo|dando|mandando|mostrando) (?:a )?(?:la misma|el mismo|lo mismo)|la misma persona|el mismo profesional|sos sord[oa]|no sirve[sn]?(?: para nada)?)\b/u

export const expresaFrustracion = (text: string): boolean => FRUSTRACION.test(plano(text)) || tieneInsultos(text)

export interface RestriccionProfesional {
  // "otra persona", "otro", "alguien distinto": anybody but the professional being talked about.
  otro: boolean
  // "que no sea ella", "no quiero a ese": the professional being talked about, by a pronoun.
  actual: boolean
  // "menos la segunda": positions (0-based) in the list that was shown.
  posiciones: number[]
  // "que no sea Melina": the words after the negation. The backend matches them against the
  // professionals it really listed; words that name nobody are ignored.
  nombres: string[]
}

const QUIEN = String.raw`(?:persona|profesional(?:es)?|prestador(?:a|es)?|chic[oa]|muchach[oa]|senor(?:a)?|tipo|mina|gente|alguien|un[oa])`
const NO_ES_QUIEN = String.raw`(?! ?(?:dia|hora|horario|fecha|zona|barrio|lugar|servicio|turno|momento|semana|vez|cosa|precio|opcion horaria)\b)`
const OTRO = new RegExp(
  [
    String.raw`\botr[oa] ${QUIEN}\b`,
    String.raw`\b${QUIEN} (?:mas |que sea )?(?:distint[oa]|diferente)\b`,
    String.raw`\balgun[oa]? (?:otr[oa]|distint[oa]|diferente)\b${NO_ES_QUIEN}`,
    String.raw`\balguien mas\b`,
    String.raw`\bcambi(?:ame|a|ar|emos|o|ale) (?:de |el |la |al |a la |a )?(?:otr[oa] )?(?:profesional|persona|prestador[a]?)\b`,
    String.raw`\b(?:busca(?:me)?|consegui(?:me)?|dame|deci(?:me)?|quiero|prefiero|mejor|pone(?:me)?|proba(?:me)?|fijate|a ver) (?:a |con |si hay )?(?:otr[oa]|alguien mas)\b${NO_ES_QUIEN}`,
    String.raw`^(?:y )?(?:con |a )?otr[oa]$`,
    String.raw`\b(?:la misma persona|el mismo profesional)\b`,
  ].join('|'),
  'u'
)

// Words that open an exclusion. Each one is followed by WHO is excluded.
const NEGACION = new RegExp(
  String.raw`\b(?:que no sean?|que no me atienda|no quiero (?:que sea |que me atienda |ir con |nada con |con |a )?|cualquier[a]? (?:menos|excepto|salvo|pero no|que no sea)|(?:tod[oa]s|alguien|algun[oa]?|un[oa]|otr[oa]|el primero que haya|la primera que haya)(?: [a-zñ]+){0,3} (?:menos|excepto|salvo|pero no|que no sea)|menos|excepto|salvo|pero no|tampoco|ni|distint[oa] (?:a|de)|diferente (?:a|de)|no me gusta|no (?:con |a )?)(?: (?:a|con|que sea|de))? ?`,
  'gu'
)
const PRONOMBRE = /^(?:ell[ao]s?|es[ea]s?|est[ea]s?|el mismo|la misma|ese profesional|esa persona|esa chica|ese chico|ese tipo|el que (?:me )?(?:dijiste|ofreciste|pusiste|mostraste)|la que (?:me )?(?:dijiste|ofreciste|pusiste|mostraste)|la de antes|el de antes)\b/u
const ORDINALES: Record<string, number> = { primer: 0, primero: 0, primera: 0, '1': 0, uno: 0, segundo: 1, segunda: 1, '2': 1, dos: 1, tercer: 2, tercero: 2, tercera: 2, '3': 2, tres: 2, cuarto: 3, cuarta: 3, '4': 3, cuatro: 3, quinto: 4, quinta: 4, '5': 4, cinco: 4 }
const ORDINAL = /^(?:(?:el|la|al|a la|con el|con la|del|de la|opcion|numero|el numero|la numero|la opcion) )?(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|[1-5]|uno|dos|tres|cuatro|cinco)\b(?! (?:de la|hs|horas|y media|de |am|pm))/u
// A name ends where the rest of the sentence starts.
const FIN_DE_NOMBRE = /[,.;:!?]| (?:y|e|o|pero|que|para|por|lo|el|la|los|las|un|una|si|cuando|antes|despues|hoy|manana|pasado|esta|este|a las|de la|en|quiero|busca\w*|dame|deci\w*|porfa\w*|por favor|gracias)\b/u
// "no <word>" only names somebody when it is not an ordinary sentence ("no sé", "no importa").
const NO_ES_NOMBRE = /^(?:se|importa|hay|tengo|tiene|puedo|puede|quiero|queria|necesito|me|te|lo|la|le|es|esta|estoy|entiendo|entendes|funciona|anda|gracias|hace|era|fue|va|voy|pasa|creo|recuerdo|llego|llega|sirve|si|no|ya|mas|todavia|aun|tan|mucho|por|para|hoy|manana)\b/u

export function detectarRestriccionProfesional(text: string): RestriccionProfesional | null {
  const limpio = sinInsultos(text)
  if (!limpio) return null
  const restriccion: RestriccionProfesional = { otro: OTRO.test(limpio), actual: false, posiciones: [], nombres: [] }
  for (const match of limpio.matchAll(NEGACION)) {
    const marca = match[0].trim()
    const resto = limpio.slice(match.index + match[0].length).trim()
    if (!resto) continue
    if (PRONOMBRE.test(resto)) {
      restriccion.actual = true
      continue
    }
    const ordinal = ORDINAL.exec(resto)
    if (ordinal) {
      const posicion = ORDINALES[ordinal[1]!]
      if (posicion !== undefined && !restriccion.posiciones.includes(posicion)) restriccion.posiciones.push(posicion)
      continue
    }
    // A bare "no" is a negation of a name only right before one ("no Melina").
    if ((marca === 'no' || marca === 'ni' || marca === 'tampoco') && NO_ES_NOMBRE.test(resto)) continue
    const fin = FIN_DE_NOMBRE.exec(resto)
    const nombre = (fin ? resto.slice(0, fin.index) : resto).split(' ').slice(0, 4).join(' ').trim()
    if (nombre.length >= 3 && !restriccion.nombres.includes(nombre)) restriccion.nombres.push(nombre)
  }
  // "La otra", "no esa, la otra": ONE of the options shown is being pointed at. That is a choice
  // among the list (resolved elsewhere), not "anybody but her".
  if (/\b(?:la|el) otr[oa]\b(?! (?:persona|profesional))/u.test(limpio) && restriccion.posiciones.length === 0 && restriccion.nombres.length === 0) return null
  return restriccion.otro || restriccion.actual || restriccion.posiciones.length > 0 || restriccion.nombres.length > 0 ? restriccion : null
}

// "dejalo", "basta", "olvidate", "no quiero seguir": the request under way is dropped. A message
// that talks about a turno already taken ("quiero cancelar mi turno del lunes") is NOT this: that
// is answered by the help about cancellations.
const DETENER = /^(?:no,? ?)?(?:(?:bueno|ok|listo|igual|ya|mejor|entonces|nada|eh|ah|uh|bue),? ?)*(?:basta(?: ya)?|deja(?:lo|la|me)?(?: asi| ahi| nomas)?|dejemos(?:lo)?(?: asi| ahi)?|cancela(?:r|lo|la|me)?(?: todo| eso| la solicitud| el pedido)?|anula(?:r|lo|la)?(?: todo| eso)?|olvida(?:te|lo|la)(?: de eso)?|no quiero (?:seguir|continuar|nada|mas(?: nada)?)|no (?:sigo|sigas|continuemos|me interesa(?: mas)?)|ya no (?:quiero|lo quiero|lo necesito|hace falta)|no hace falta|chau|adios|hasta luego|nos vemos|me arrepenti|ya fue|cortala|stop|salir)(?:,? ?(?:gracias|por favor|porfa|ya|nomas|igual|che))*$/u

export function pideDetener(text: string): boolean {
  const limpio = sinInsultos(text).replace(/[.!?]+$/u, '').trim()
  return limpio.length > 0 && limpio.split(' ').length <= 8 && DETENER.test(limpio)
}

// "empezar de nuevo", "arranquemos de cero".
export const pideEmpezarDeNuevo = (text: string): boolean => /\b(?:empe(?:zar|cemos|za|zamos)|arran(?:car|quemos|ca)|volv(?:er|amos) a empezar|comen(?:zar|cemos)) (?:todo )?(?:de (?:nuevo|cero|vuelta)|otra vez)\b|\bde cero\b|\breinicia(?:r|lo)?\b|\bborra(?:r)? todo\b/u.test(sinInsultos(text))

// A change of time for the SAME professional: another time, later, earlier, another day.
export type CambioDeHorario = 'otro_horario' | 'mas_tarde' | 'mas_temprano' | 'otro_dia'

export function detectarCambioDeHorario(text: string): CambioDeHorario | null {
  const limpio = sinInsultos(text)
  if (/\b(?:mas tarde|despues de es[ea]|un rato despues|mas a la tarde|el siguiente|el que sigue|la siguiente)\b/u.test(limpio)) return 'mas_tarde'
  if (/\b(?:mas temprano|antes de es[ea]|un rato antes|el anterior|la anterior)\b/u.test(limpio)) return 'mas_temprano'
  if (/\botr[oa] (?:dia|fecha)\b|\bcambi(?:ame|a|ar|emos|o) (?:de |el |la )?(?:dia|fecha)\b/u.test(limpio)) return 'otro_dia'
  if (/\botr[oa] (?:hora|horario|turno|momento)\b|\bcambi(?:ame|a|ar|emos|o) (?:de |el |la )?(?:hora|horario|turno)\b|\b(?:que|cuales) otros? horarios?\b|\ba otra hora\b/u.test(limpio)) return 'otro_horario'
  return null
}

// "¿qué otros hay?", "¿quiénes más?": the other professionals, nobody excluded.
export const pideOtrasOpciones = (text: string): boolean => /\b(?:que|cuales|quienes?) (?:otr[oa]s?|mas)(?: (?:profesionales|opciones|personas|prestadores))?(?: hay| tenes| tienen| quedan)?\b|\b(?:hay|tenes|queda[n]?) (?:otr[oa]s?|alguien mas|mas opciones|mas profesionales)\b|\bmostrame (?:los |las )?(?:otr[oa]s|demas)\b|\bver (?:los |las )?(?:otr[oa]s|demas)\b/u.test(sinInsultos(text))

// A trivial sum asked in the middle of something ("cuánto es 2 + 2"). The BACKEND computes it:
// whole numbers, one operation, a bounded size. Anything else is not answered as arithmetic.
export function cuentaTrivial(text: string): string | null {
  const limpio = plano(text).replace(/[?!.]+$/u, '')
  const match = /^(?:che,? ?|decime,? ?|y ?|sabes ?)?(?:cuanto (?:es|da|son|seria)|cuanto (?:es|da) (?:la cuenta )?de|que da|resultado de|calcula(?:me)?) (-?\d{1,6}) ?(\+|-|x|\*|×|por|mas|menos|\/|÷|dividido(?: por)?|entre) ?(-?\d{1,6})$/u.exec(limpio) ?? /^(-?\d{1,6}) ?(\+|-|x|\*|×|\/|÷) ?(-?\d{1,6}) ?(?:=|cuanto es|cuanto da)?$/u.exec(limpio)
  if (!match) return null
  const a = Number(match[1])
  const b = Number(match[3])
  const operador = match[2]!
  if (operador === '+' || operador === 'mas') return String(a + b)
  if (operador === '-' || operador === 'menos') return String(a - b)
  if (operador === 'x' || operador === '*' || operador === '×' || operador === 'por') return String(a * b)
  if (b === 0) return null
  const cociente = a / b
  return Number.isInteger(cociente) ? String(cociente) : cociente.toFixed(2).replace('.', ',')
}

// A question that is clearly not an answer to "name and document" and not about TUS either
// ("¿quién ganó el partido?"). Only used while the conversation waits for the identity: there a
// question must never be read as a failed identification.
const INTERROGATIVA = /^(?:che,? ?|y ?|pero ?|una pregunta,? ?|decime,? ?)?(?:que|quien(?:es)?|cual(?:es)?|como|cuando|cuanto[s]?|cuanta[s]?|donde|por que|para que|sabes|sabias|podes|podrias|me (?:decis|contas|explicas)|conoces|es verdad|hay|existe|tenes)\b/u

export function esPreguntaSuelta(text: string): boolean {
  const limpio = sinInsultos(text)
  if (!limpio || /\d{7,}/u.test(limpio.replace(/[.\s]/gu, ''))) return false
  return /\?\s*$/u.test(text.trim()) || INTERROGATIVA.test(limpio)
}
