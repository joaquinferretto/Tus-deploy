// `node scripts/meta/sincronizar-plantillas.mjs [--solo=nombre1,nombre2] [--aplicar] [--json]`
// Compares the templates TUS defines with the ones Meta has and says what would have to be done.
//
// DRY-RUN BY DEFAULT: without --aplicar it only reads Meta and reports. With --aplicar it creates
// or edits templates in Meta, and only the ones named in --solo (there is no "apply everything").
// Creating a template, or editing one, sends it to Meta's review; a template that is in review
// cannot be edited (the report says so and what to do instead). It never deletes anything, never
// touches WHATSAPP_APPROVED_TEMPLATES and prints no credential.
// Configuration (the API's own): WHATSAPP_ACCESS_TOKEN, WHATSAPP_WABA_ID,
// WHATSAPP_GRAPH_API_VERSION, WHATSAPP_APPROVED_TEMPLATES.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ClienteMetaPlantillas, ErrorMeta, argumentos, configuracionDesdeEnv, definicionesDeTus, etiquetaEstado, redactar, sincronizar } from './plantillas-lib.mjs'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const opciones = argumentos(process.argv.slice(2))
const config = configuracionDesdeEnv(process.env)
if (config.faltan.length > 0) {
  console.error(`Falta configuración: ${config.faltan.join(', ')}. No se consultó Meta.`)
  process.exit(2)
}
if (opciones.aplicar && (!opciones.solo || opciones.solo.length === 0)) {
  console.error('--aplicar exige nombrar las plantillas con --solo=nombre1,nombre2. No se cambió nada.')
  process.exit(2)
}
const ACCION = { crear: 'CREAR', actualizar: 'ACTUALIZAR', nada: 'sin cambios', no_editable: 'NO EDITABLE AHORA' }
try {
  const definiciones = await definicionesDeTus(raiz)
  const { resultados, desconocidas } = await sincronizar({ cliente: new ClienteMetaPlantillas(config), definiciones, habilitadas: config.habilitadas, solo: opciones.solo, aplicar: opciones.aplicar })
  if (opciones.json) console.log(JSON.stringify({ modo: opciones.aplicar ? 'aplicar' : 'dry-run', configuracion: config.visible, resultados, desconocidas }, null, 1))
  else {
    console.log(`${opciones.aplicar ? 'APLICANDO' : 'DRY-RUN (no se escribe nada en Meta)'} · cuenta ${config.visible.wabaId} · Graph ${config.visible.version}`)
    for (const item of resultados) {
      console.log(`\n${item.nombre} [${item.idioma}]`)
      console.log(`  en Meta: ${item.estado ? `${etiquetaEstado(item.estado)} (id ${item.id})` : 'no existe'}${item.otrosIdiomas.length > 0 ? ` · existe en otros idiomas: ${item.otrosIdiomas.join(', ')}` : ''}`)
      console.log(`  acción: ${ACCION[item.accion]}${item.diferencias.length > 0 ? ` — ${item.diferencias.join('; ')}` : ''}`)
      console.log(`  ${item.nota}`)
      console.log(`  en TUS: ${item.habilitadaEnTus ? 'habilitada' : 'NO habilitada'} (WHATSAPP_APPROVED_TEMPLATES) · ${item.utilizable ? 'utilizable ahora' : 'no utilizable ahora'}`)
      if (item.aplicado) console.log(`  HECHO: quedó ${etiquetaEstado(item.estadoNuevo)} (id ${item.id}).`)
      if (item.error) console.log(`  ERROR de Meta: ${item.error}`)
    }
    if (desconocidas.length > 0) console.log(`\nNo son plantillas de TUS: ${desconocidas.join(', ')}`)
    if (!opciones.aplicar && resultados.some((item) => item.accion === 'crear' || item.accion === 'actualizar')) console.log('\nPara aplicar: agregar --aplicar --solo=<nombres>. Cada creación o edición entra en revisión de Meta.')
  }
  if (resultados.some((item) => item.error)) process.exit(1)
} catch (error) {
  console.error(error instanceof ErrorMeta ? `Meta respondió con un error (${error.code}): ${error.message}` : `No se pudo sincronizar: ${redactar(error?.message ?? error)}`)
  process.exit(1)
}
