// Quitar acentos sin depender del runtime. En producción (Node de Hostinger) `normalize('NFD')` no
// descompone los caracteres acentuados, así que "térmica", "cañería" o "Qué" quedaban con tilde y
// no coincidían con las palabras clave, el directorio ni el conocimiento. Se intenta NFD (si el
// runtime lo soporta), se quitan las marcas combinantes y además se mapean explícitamente los
// precompuestos del español. La ñ pasa a n, igual que con NFD (las palabras clave ya lo asumen).
const MAPA: Readonly<Record<string, string>> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ç: 'c',
  Á: 'A', À: 'A', Ä: 'A', Â: 'A', Ã: 'A',
  É: 'E', È: 'E', Ë: 'E', Ê: 'E',
  Í: 'I', Ì: 'I', Ï: 'I', Î: 'I',
  Ó: 'O', Ò: 'O', Ö: 'O', Ô: 'O', Õ: 'O',
  Ú: 'U', Ù: 'U', Ü: 'U', Û: 'U',
  Ñ: 'N', Ç: 'C',
}

const PRECOMPUESTOS = new RegExp(`[${Object.keys(MAPA).join('')}]`, 'gu')

export function sinAcentos(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(PRECOMPUESTOS, (char) => MAPA[char] ?? char)
}
