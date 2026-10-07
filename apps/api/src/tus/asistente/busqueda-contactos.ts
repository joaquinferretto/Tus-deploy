// ADMIN-WHATSAPP-BUSQUEDA-01. What an administrator types in "Buscar por nombre o celular…",
// turned into what the store compares: a piece of a name, and the digit strings a phone may be
// stored as. Nothing stored is changed: this only normalises the QUERY.
//
// A WhatsApp number is stored as Meta delivers it: digits, international (an Argentine mobile is
// 54 9 <area> <number>, e.g. 5493794123456). People write the same number in other shapes:
//   +54 9 379 412-3456   ->  5493794123456
//   3794123456            ->  3794123456        (contained in the stored one)
//   0379 15 4123456       ->  3794123456        (national prefix 0 and the old local 15 dropped)
//   +54 379 4123456       ->  5493794123456     (the mobile 9 added)
// Only Argentine shapes are rewritten, and only when the text says so (it starts with 0 or with
// 54): any other number is searched exactly as typed, so a foreign number is never altered.

const soloDigitos = (value: string): string => value.replace(/\D/gu, '')

// Area codes in Argentina have 2, 3 or 4 digits and area + subscriber number always add up to 10.
const LARGO_NACIONAL = 10

// National text (after dropping the leading 0): the same number without the local "15" that used
// to follow the area code. More than one area length may fit; every one that does is returned.
function sinQuince(nacional: string): string[] {
  // Exactly 10 digits is already a complete number without the 15: nothing to drop.
  if (nacional.length === LARGO_NACIONAL) return []
  const candidatos: string[] = []
  for (const area of [2, 3, 4]) {
    if (nacional.slice(area, area + 2) !== '15') continue
    const sin = nacional.slice(0, area) + nacional.slice(area + 2)
    // A complete number has exactly 10 digits; a partial one is kept while it is still shorter.
    if (sin.length <= LARGO_NACIONAL && (sin.length === LARGO_NACIONAL || nacional.length < LARGO_NACIONAL + 2)) candidatos.push(sin)
  }
  return candidatos
}

// What a stored number must CONTAIN to match what was typed. `exactas`: the digits as typed (any
// country). `argentinas`: the same number rewritten from an Argentine shape (0, 15, 54 without 9);
// these only match numbers stored as Argentine (54…), so "0600 111 222" never finds a Spanish
// number that happens to contain 600111222. Both empty: the text is not a phone.
export function variantesTelefono(texto: string): { exactas: string[]; argentinas: string[] } {
  // Only digits and phone punctuation: "leo 379" is a name search, not a phone.
  if (!/^[\d\s()+.\-/]+$/u.test(texto)) return { exactas: [], argentinas: [] }
  const digitos = soloDigitos(texto)
  if (digitos.length < 3) return { exactas: [], argentinas: [] }
  const argentinas = new Set<string>()
  if (digitos.startsWith('0')) {
    // National format: 0 + area + (15) + number.
    const nacional = digitos.replace(/^0+/u, '')
    if (nacional.length >= 3) argentinas.add(nacional)
    for (const sin of sinQuince(nacional)) if (sin.length >= 3) argentinas.add(sin)
  } else if (digitos.startsWith('54')) {
    const resto = digitos.slice(2)
    // +54 without the mobile 9: the stored mobile carries it.
    if (resto.length >= 3 && !resto.startsWith('9')) argentinas.add(`549${resto}`)
    // +54 9 0379 15 …: tolerated, the same rewriting on what follows.
    const nacional = resto.replace(/^9/u, '').replace(/^0+/u, '')
    if (nacional !== resto.replace(/^9/u, '') && nacional.length >= 3) argentinas.add(nacional)
    for (const sin of sinQuince(nacional)) if (sin.length >= 3) argentinas.add(sin)
  }
  argentinas.delete(digitos)
  // A number typed with its national 0 is never stored with it: only its rewriting can match.
  return { exactas: digitos.startsWith('0') ? [] : [digitos], argentinas: [...argentinas] }
}

export interface BusquedaContactos {
  // A piece of the name, as typed (compared without case); null when nothing usable was typed.
  nombre: string | null
  // Digit strings the stored number must contain (any of them), whatever its country.
  telefonos: string[]
  // Digit strings that only match a number stored as Argentine (it starts with 54).
  telefonosArgentinos: string[]
}

export function interpretarBusqueda(valor: unknown): BusquedaContactos | null {
  const texto = typeof valor === 'string' ? valor.replace(/\s+/gu, ' ').trim().slice(0, 80) : ''
  if (!texto) return null
  const { exactas, argentinas } = variantesTelefono(texto)
  const esTelefono = exactas.length + argentinas.length > 0
  // A text made only of digits and punctuation is a phone; anything else is a name.
  return { nombre: esTelefono ? null : texto, telefonos: exactas, telefonosArgentinos: argentinas }
}

// The same comparison, in memory (tests and local compositions).
export function contactoCoincide(contacto: { waId: string; displayName: string | null }, busqueda: BusquedaContactos): boolean {
  const nombre = busqueda.nombre ? busqueda.nombre.toLowerCase() : null
  if (nombre && (contacto.displayName ?? '').toLowerCase().includes(nombre)) return true
  const almacenado = soloDigitos(contacto.waId)
  if (busqueda.telefonos.some((variante) => almacenado.includes(variante))) return true
  return almacenado.startsWith('54') && busqueda.telefonosArgentinos.some((variante) => almacenado.includes(variante))
}
