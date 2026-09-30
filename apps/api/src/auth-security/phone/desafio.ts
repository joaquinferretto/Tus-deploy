import { createHash, randomBytes, randomInt } from 'node:crypto'

import { PREFIJO_VERIFICACION_WHATSAPP } from '@factory/contracts'

// Phone verification challenge: 8 characters from a 31-symbol alphabet without look-alikes
// (no 0/O, 1/I/L): 31^8 ≈ 8.5·10^11 combinations (≈ 39.6 bits), drawn with crypto.randomInt
// (unbiased, cryptographically secure). It lives 10 minutes, is single-use and is only accepted
// from the WhatsApp number it was created for, so guessing it gives nothing: a code only verifies
// the phone that sends it, and only if that phone is the one the challenge expects.
export const ALFABETO_DESAFIO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const LARGO_DESAFIO = 8
export const TTL_DESAFIO_MS = 10 * 60 * 1000
// Messages from a WRONG number carrying a live code: after this many, the code is invalidated.
export const MAX_INTENTOS_FALLIDOS = 5

export function generarCodigoDesafio(): string {
  let codigo = ''
  for (let index = 0; index < LARGO_DESAFIO; index += 1) codigo += ALFABETO_DESAFIO[randomInt(ALFABETO_DESAFIO.length)]
  return codigo
}

// Only the hash is stored (unique index): the code never reaches the database or the logs.
export function hashDesafio(codigo: string): string {
  return createHash('sha256').update(`tus-phone-challenge:${codigo}`).digest('hex')
}

// Browser-side secret of the flows without a session (sign-up, password recovery): the page that
// created the challenge polls its state with it.
export function generarSecretoConsulta(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSecretoConsulta(secreto: string): string {
  return createHash('sha256').update(`tus-phone-poll:${secreto}`).digest('hex')
}

const PREFIJO = new RegExp(`^\\s*${PREFIJO_VERIFICACION_WHATSAPP.replace(/\s+/gu, '\\s+')}\\b`, 'iu')

// Any message that starts with "VERIFICAR TUS" is an authentication message: it is handled
// deterministically and NEVER reaches the assistant (Groq/LLM, tools, search).
export function esMensajeVerificacion(texto: unknown): boolean {
  return typeof texto === 'string' && PREFIJO.test(texto)
}

// "verificar tus 7k4m-9qxr" -> "7K4M9QXR"; null when the rest is not a well-formed code.
export function extraerCodigo(texto: unknown): string | null {
  if (!esMensajeVerificacion(texto)) return null
  const resto = (texto as string).replace(PREFIJO, '').replace(/^[\s:.-]+/u, '').toUpperCase().replace(/[\s-]/gu, '')
  if (resto.length !== LARGO_DESAFIO) return null
  for (const caracter of resto) if (!ALFABETO_DESAFIO.includes(caracter)) return null
  return resto
}
