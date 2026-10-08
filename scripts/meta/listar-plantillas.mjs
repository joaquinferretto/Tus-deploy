// `node scripts/meta/listar-plantillas.mjs [--json]`
// Read-only: the WhatsApp templates Meta has for the account of TUS, with their real state, next
// to what TUS defines and has enabled. It writes nothing to Meta and prints no credential.
// Configuration (the API's own): WHATSAPP_ACCESS_TOKEN, WHATSAPP_WABA_ID,
// WHATSAPP_GRAPH_API_VERSION, WHATSAPP_APPROVED_TEMPLATES. To read them from a file:
//   node --env-file=<archivo> scripts/meta/listar-plantillas.mjs
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ClienteMetaPlantillas, ErrorMeta, argumentos, configuracionDesdeEnv, definicionesDeTus, etiquetaEstado, planificar, redactar } from './plantillas-lib.mjs'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const opciones = argumentos(process.argv.slice(2))
const config = configuracionDesdeEnv(process.env)
if (config.faltan.length > 0) {
  console.error(`Falta configuración: ${config.faltan.join(', ')}. No se consultó Meta.`)
  process.exit(2)
}
try {
  const definiciones = await definicionesDeTus(raiz)
  const remotas = await new ClienteMetaPlantillas(config).listar()
  const plan = planificar(definiciones, remotas, config.habilitadas)
  const ajenas = remotas.filter((remota) => !definiciones.some((definicion) => definicion.name === remota.name))
  if (opciones.json) {
    console.log(JSON.stringify({ configuracion: config.visible, deTus: plan, soloEnMeta: ajenas.map((r) => ({ nombre: r.name, idioma: r.language, estado: r.status, categoria: r.category, id: r.id })) }, null, 1))
  } else {
    console.log(`Cuenta de WhatsApp ${config.visible.wabaId} · Graph ${config.visible.version} · habilitadas en TUS: ${config.visible.habilitadas.join(', ') || '(ninguna)'}`)
    console.log('\nPlantillas que TUS define:')
    for (const item of plan) console.log(`  ${item.nombre} [${item.idioma}] — ${item.estado ? etiquetaEstado(item.estado) : 'NO EXISTE en Meta'}${item.id ? ` · id ${item.id}` : ''} · ${item.habilitadaEnTus ? 'habilitada en TUS' : 'no habilitada en TUS'} · ${item.utilizable ? 'UTILIZABLE' : 'no utilizable'}${item.diferencias.length > 0 && item.estado ? ` · difiere: ${item.diferencias.join('; ')}` : ''}${item.motivoRechazo ? ` · motivo de rechazo: ${item.motivoRechazo}` : ''}`)
    console.log('\nPlantillas que solo existen en Meta:')
    for (const remota of ajenas) console.log(`  ${remota.name} [${remota.language}] — ${etiquetaEstado(remota.status)} · ${remota.category} · id ${remota.id}`)
    if (ajenas.length === 0) console.log('  (ninguna)')
  }
} catch (error) {
  console.error(error instanceof ErrorMeta ? `Meta respondió con un error (${error.code}): ${error.message}` : `No se pudo listar: ${redactar(error?.message ?? error)}`)
  process.exit(1)
}
