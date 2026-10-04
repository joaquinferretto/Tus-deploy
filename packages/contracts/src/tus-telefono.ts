// Phone numbers of TUS identities: ONE normalizer shared by the API and the Web (never a regex per
// controller). Output: E.164 ("+5493794123456").
//
// Rules (no guessing: an input with two possible readings is rejected, never "fixed"):
// - International input starts with "+" or "00": the country code is taken as written.
// - Argentina (+54). WhatsApp identities are mobile numbers, and a WhatsApp wa_id for Argentina is
//   54 9 + the 10-digit national number, so the canonical form is ALWAYS +549 + 10 digits:
//   "+54 9 379 412-3456", "+54 379 4123456", "0379 15 412-3456", "379 4123456" and the wa_id
//   "5493794123456" all give +5493794123456.
//   The local "15" mobile prefix is removed only at a position that makes it valid (area code 11,
//   or a 3-4 digit area code starting with 2 or 3). With 12 digits two such positions cannot
//   coexist, so the reading is unique; 'ambiguo' remains as a guard, never a guess.
// - Without "+", a number is read as Argentine (the default country); a foreign number must be
//   written with its "+" country code.

export type MotivoTelefonoInvalido = 'vacio' | 'formato' | 'longitud' | 'ambiguo'

export type ResultadoTelefono =
  | { ok: true; e164: string; pais: 'AR' | 'otro' }
  | { ok: false; motivo: MotivoTelefonoInvalido }

const PERMITIDOS = /^\+?[\d\s().-]+$/u

function argentino(nacional: string, admiteNueve: boolean): ResultadoTelefono {
  let numero = nacional
  if (admiteNueve && numero.length === 11 && numero.startsWith('9')) numero = numero.slice(1)
  if (numero.length === 12) {
    const candidatos = [2, 3, 4].filter((posicion) => {
      if (numero.slice(posicion, posicion + 2) !== '15') return false
      const area = numero.slice(0, posicion)
      return posicion === 2 ? area === '11' : area[0] === '2' || area[0] === '3'
    })
    if (candidatos.length !== 1) return { ok: false, motivo: candidatos.length === 0 ? 'longitud' : 'ambiguo' }
    const posicion = candidatos[0]!
    numero = numero.slice(0, posicion) + numero.slice(posicion + 2)
  }
  if (numero.length !== 10) return { ok: false, motivo: 'longitud' }
  if (!/^(11|[23]\d)\d{8}$/u.test(numero)) return { ok: false, motivo: 'formato' }
  return { ok: true, e164: `+549${numero}`, pais: 'AR' }
}

export function normalizarTelefono(entrada: unknown): ResultadoTelefono {
  if (typeof entrada !== 'string' || !entrada.trim()) return { ok: false, motivo: 'vacio' }
  const texto = entrada.trim()
  if (texto.length > 32 || !PERMITIDOS.test(texto)) return { ok: false, motivo: 'formato' }
  let digitos = texto.replace(/\D/gu, '')
  let internacional = texto.startsWith('+')
  if (!internacional && digitos.startsWith('00')) {
    internacional = true
    digitos = digitos.slice(2)
  }
  // "5493794123456" typed without "+": an Argentine national number never starts with 54.
  if (!internacional && digitos.startsWith('54') && digitos.length >= 12) internacional = true
  if (internacional) {
    if (digitos.startsWith('54')) return argentino(digitos.slice(2), true)
    if (!/^[1-9]\d{7,14}$/u.test(digitos)) return { ok: false, motivo: 'longitud' }
    return { ok: true, e164: `+${digitos}`, pais: 'otro' }
  }
  if (digitos.startsWith('0')) digitos = digitos.slice(1)
  return argentino(digitos, false)
}

// The sender of a WhatsApp message (wa_id: digits only, as Meta sends it) in the same canonical form.
export function telefonoDesdeWaId(waId: unknown): string | null {
  if (typeof waId !== 'string' || !/^\d{8,15}$/u.test(waId)) return null
  const resultado = normalizarTelefono(`+${waId}`)
  return resultado.ok ? resultado.e164 : null
}

// "+549379•••••3456": enough for the person to recognise it, never the whole number.
// The same Argentine mobile can reach us as "549379..." (with the mobile 9) or "54379..." (without
// it): the wa_id forms that may identify one contact. Anything else is only itself.
export function waIdEquivalentes(waId: string): string[] {
  const conNueve = /^549(\d{10})$/u.exec(waId)
  if (conNueve) return [waId, `54${conNueve[1]}`]
  const sinNueve = /^54(\d{10})$/u.exec(waId)
  if (sinNueve) return [waId, `549${sinNueve[1]}`]
  return [waId]
}

export function enmascararTelefono(e164: string): string {
  if (e164.length <= 8) return '••••'
  return `${e164.slice(0, 7)}${'•'.repeat(Math.max(3, e164.length - 11))}${e164.slice(-4)}`
}

// Prefix of the user-initiated verification message ("VERIFICAR TUS 7K4M9QXR").
export const PREFIJO_VERIFICACION_WHATSAPP = 'VERIFICAR TUS'

// wa.me link to the official TUS number with the message already written: the person only taps
// "Enviar". `numeroOficial` comes from the API configuration (never hardcoded in the Web).
export function enlaceVerificacionWhatsapp(numeroOficial: string, codigo: string): string {
  const numero = numeroOficial.replace(/\D/gu, '')
  return `https://wa.me/${numero}?text=${encodeURIComponent(`${PREFIJO_VERIFICACION_WHATSAPP} ${codigo}`)}`
}
