// The same limits the API enforces. Here they only save a round trip: the API decides, from the
// bytes of the file (never from its name or the type the browser declares).
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const MESSAGES: Record<string, string> = {
  PHOTO_TOO_LARGE: 'La foto pesa más de 2 MB. Elegí una más liviana.',
  PHOTO_TYPE_NOT_ALLOWED: 'Usá una foto JPG, PNG o WEBP.',
  PHOTO_DIMENSIONS: 'La foto tiene que medir entre 96 y 4096 píxeles por lado.',
  PHOTO_CORRUPT: 'No pudimos leer esa foto. Probá con otra.',
  PHOTO_ANIMATED: 'Usá una foto fija, no una animación.',
  PHOTO_EMPTY: 'El archivo está vacío.',
  RATE_LIMITED: 'Cambiaste la foto muchas veces. Probá de nuevo en un rato.',
  NOT_FOUND: 'Primero guardá tu perfil público.',
}
export const GENERIC = 'No pudimos guardar la foto. Probá de nuevo en unos minutos.'

export function photoProblem(file: { size: number; type: string }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return MESSAGES['PHOTO_TYPE_NOT_ALLOWED']!
  if (file.size > PHOTO_MAX_BYTES) return MESSAGES['PHOTO_TOO_LARGE']!
  if (file.size === 0) return MESSAGES['PHOTO_EMPTY']!
  return null
}
