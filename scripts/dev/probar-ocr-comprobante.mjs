// Real, local check of the receipt OCR with a SYNTHETIC image (never a real receipt).
//
//   node apps/api/node_modules/tsx/dist/cli.mjs scripts/dev/probar-ocr-comprobante.mjs <image> [langPath]
//
// langPath defaults to TESSERACT_LANG_PATH. Nothing is downloaded and nothing is written: the
// language data must already be in that directory (spa.traineddata or spa.traineddata.gz). It
// prints what was read as untrusted evidence and how long it took; it confirms no payment.
import { readFileSync } from 'node:fs'

const [imagen, langPath = process.env.TESSERACT_LANG_PATH] = process.argv.slice(2)
if (!imagen) {
  console.error('usage: probar-ocr-comprobante.mjs <synthetic image> [langPath]')
  process.exit(2)
}
const { MotorOcrTesseract } = await import('../../apps/api/src/tus/identidad/lectores.ts')
const c = await import('../../apps/api/src/tus/asistente/comprobantes.ts')

const idiomas = (process.env.WHATSAPP_RECEIPT_OCR_LANGS?.trim() || 'spa').split(/[+,\s]+/u)
const motor = new MotorOcrTesseract({ langPath, idiomas, soloLocal: true })
const analizador = new c.AnalizadorComprobanteOcr(motor, new c.ExtractorTextoPdfPoppler(process.env.WHATSAPP_RECEIPT_PDFTOTEXT?.trim() || 'pdftotext'), c.LIMITES_COMPROBANTE_POR_DEFECTO)
console.log('capabilities', JSON.stringify(await analizador.capacidades()))
try {
  const archivo = c.validarComprobante(readFileSync(imagen), imagen.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png', c.LIMITES_COMPROBANTE_POR_DEFECTO)
  const inicio = Date.now()
  const evidencia = await analizador.analizar(archivo)
  console.log('evidence', JSON.stringify(evidencia))
  console.log('ms', Date.now() - inicio)
} catch (error) {
  console.log('failed', error?.code ?? String(error))
  process.exitCode = 1
} finally {
  await motor.reiniciar()
}
