import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

test('Map categories have distinct safe SVG icons and unknown ids use the tools fallback', () => {
  const result = runTypeScriptScenario(`
    const module = await import('./apps/web/src/features/home/category-icons.ts')
    const { categoryMarkerSvg } = module.default ?? module
    const ids = ['plomeria', 'electricidad', 'mecanica', 'pintura', 'aire', 'otros']
    const icons = ids.map(categoryMarkerSvg)
    console.log(JSON.stringify({
      distinct: new Set(icons).size,
      svg: icons.every(icon => icon.startsWith('<svg ') && icon.endsWith('</svg>')),
      unsafe: icons.some(icon => /script|onload|javascript:|foreignObject/.test(icon)),
      fallback: ['unknown', 'toString', '<img src=x onerror=alert(1)>'].every(id => categoryMarkerSvg(id) === categoryMarkerSvg('otros')),
    }))
  `)
  assert.deepEqual(result, { distinct: 6, svg: true, unsafe: false, fallback: true })
})

test('Map search combines profession, text and accent-insensitive zone and clearing restores every marker', () => {
  const result = runTypeScriptScenario(`
    const module = await import('./apps/web/src/features/home/requests-source.ts')
    const { matchesFilters } = module.default ?? module
    const marker = (id, category, title, zone) => ({ id, category, title, approximateLocation: { lat: -27.469, lng: -58.831, label: zone } })
    const rows = [marker('a', 'plomeria', 'Canilla rota', 'Cambá Cuá'), marker('b', 'plomeria', 'Canilla rota', 'Centro'), marker('c', 'electricidad', 'Tablero eléctrico', 'Cambá Cuá')]
    const visible = filters => rows.filter(row => matchesFilters(row, filters)).map(row => row.id)
    console.log(JSON.stringify({
      filtered: visible({ category: 'plomeria', query: 'cañería', zone: 'camba cua' }),
      empty: visible({ category: 'pintura', query: '', zone: '' }),
      reset: visible({ category: '', query: '', zone: '' }),
    }))
  `)
  assert.deepEqual(result, { filtered: ['a'], empty: [], reset: ['a', 'b', 'c'] })
})
