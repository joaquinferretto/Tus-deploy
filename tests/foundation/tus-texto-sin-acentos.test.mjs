import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// En producción (Node de Hostinger) `String.prototype.normalize('NFD')` no descompone los acentos:
// "salta la térmica" dejaba de clasificarse, el RAG no encontraba "¿Qué es TUS?" y los nombres con
// tilde no coincidían en la verificación de identidad. Se simula ese runtime (normalize = identidad).
test('TEXTO sin acentos: works even when the runtime normalize() is a no-op (Hostinger)', () => {
  const result = runTypeScriptScenario(`
    String.prototype.normalize = function () { return String(this) }
    const { sinAcentos } = await import('./apps/api/src/tus/texto.ts')
    const { interpretarNecesidad } = await import('./apps/api/src/tus/directorio/modelo.ts')
    const k = await import('./apps/api/src/tus/asistente/conocimiento.ts')
    const { normalizarNombre } = await import('./apps/api/src/tus/identidad/modelo.ts')
    console.log(JSON.stringify({
      basic: sinAcentos('Qué térmica cañería ÁRBOL Ñandú pingüino'),
      termica: interpretarNecesidad('salta la térmica').category,
      caneria: interpretarNecesidad('se rompió la cañería').category,
      enfria: interpretarNecesidad('no enfría el split').category,
      frase: k.fraseNormalizada('¿Qué es TUS?'),
      tokens: k.tokensBusqueda('¿Cómo cancelo una reparación?'),
      nombre: normalizarNombre('JOSÉ MARÍA NÚÑEZ'),
    }))
  `)
  assert.equal(result.basic, 'Que termica caneria ARBOL Nandu pinguino')
  assert.equal(result.termica, 'electricidad')
  assert.equal(result.caneria, 'plomeria')
  assert.equal(result.enfria, 'aire')
  assert.equal(result.frase, 'que es tus')
  assert.deepEqual(result.tokens, ['cancelo', 'reparacion'])
  assert.match(result.nombre, /^jose maria nunez$/iu)
})
