// DOCUMENTO-NOSIS-PUBLICO-01. OPTIONAL, MANUAL, external smoke: one real search in the public
// search of Nosis through the same adapter the worker uses, to confirm the site still answers the
// shape the adapter reads. NEVER run by CI nor by the test suite.
//
// It only runs when a person asks for it explicitly, for a document number that person is
// authorized to look up (its own, or one whose owner agreed):
//
//   NOSIS_SMOKE_DNI=<dni autorizado> node --experimental-strip-types --experimental-transform-types \
//     --experimental-loader ./scripts/node-strip-types-loader.mjs \
//     scripts/identidad/nosis-publico-smoke.mjs --autorizado
//
// It makes ONE search, opens no report, and prints nothing of the person: only masked values and
// which data came back. Exit code 0: the shape is the expected one. 2: not run. 1: it changed.
const dni = String(process.env.NOSIS_SMOKE_DNI ?? '').replace(/\D+/gu, '')
if (!process.argv.includes('--autorizado') || !/^\d{7,8}$/u.test(dni)) {
  console.log('NO EJECUTADO: hace falta NOSIS_SMOKE_DNI (7 u 8 dígitos, de una persona que lo autorizó) y el argumento --autorizado.')
  process.exit(2)
}
if (process.env.CI) {
  console.log('NO EJECUTADO: este smoke no corre en CI.')
  process.exit(2)
}
const { NosisPublicLookupAdapter } = await import('../../apps/api/src/tus/identidad/nosis-public.ts')
const { validarCuil, normalizarProvincia } = await import('../../apps/api/src/tus/identidad/modelo.ts')
const enmascarar = (valor) => (valor ? '*'.repeat(Math.max(valor.length - 3, 0)) + valor.slice(-3) : null)
try {
  const { results } = await new NosisPublicLookupAdapter().consultar({ documentNumber: dni }, async () => true)
  const persona = results[0] ?? null
  console.log(JSON.stringify({
    resultados: results.length,
    documento: enmascarar(persona?.documentNumber ?? null),
    documentoCoincide: persona ? persona.documentNumber === dni.replace(/^0+/u, '') : null,
    cuil: enmascarar(persona?.cuil ?? null),
    cuilValido: persona ? validarCuil(persona.cuil, dni).valid : null,
    nombre: persona?.fullName ? `${persona.fullName.trim().split(/\s+/u).length} palabras` : null,
    provinciaReconocida: persona ? normalizarProvincia(persona.verifiedArea?.provincia ?? null) !== null : null,
  }))
  process.exit(0)
} catch (error) {
  // A code only: never the answer of the site.
  console.log(JSON.stringify({ error: error?.code ?? 'UNEXPECTED' }))
  process.exit(1)
}
