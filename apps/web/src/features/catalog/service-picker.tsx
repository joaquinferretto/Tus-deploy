'use client'

import { useMemo, useState } from 'react'

import type { CategoriaPublica, OficioPublico } from '@factory/contracts'

// Multiple service selection grouped by category (Categoría -> Servicios), with a search box and
// the principal service (shown first on the public profile). `value` keeps the principal first.
// Used by the provider's own profile and by the platform administration.
export function ServicePicker({
  services,
  categories,
  value,
  onChange,
  idPrefix = 'servicio',
}: {
  services: OficioPublico[]
  categories: CategoriaPublica[]
  value: string[]
  onChange: (next: string[]) => void
  idPrefix?: string
}): React.ReactNode {
  const [query, setQuery] = useState('')
  const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase()
  const groups = useMemo(() => {
    const q = normalize(query.trim())
    const visible = services.filter((item) => !q || normalize(`${item.label} ${item.profession}`).includes(q) || value.includes(item.id))
    const known = new Set(categories.map((item) => item.id))
    return [
      ...categories.map((category) => ({ id: category.id, name: category.name, items: visible.filter((item) => item.categoryId === category.id) })),
      { id: '__sin_categoria', name: 'Otros servicios', items: visible.filter((item) => !item.categoryId || !known.has(item.categoryId)) },
    ].filter((group) => group.items.length > 0)
  }, [categories, query, services, value])

  const toggle = (id: string, checked: boolean) => onChange(checked ? [...new Set([...value, id])] : value.filter((item) => item !== id))
  const makePrincipal = (id: string) => onChange([id, ...value.filter((item) => item !== id)])

  return (
    <div>
      <input
        aria-label="Buscar servicio"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar servicio (ej.: electricidad)"
        style={{ border: '1px solid #d7dbe3', borderRadius: 10, marginBottom: 8, padding: '8px 10px', width: '100%' }}
        type="search"
        value={query}
      />
      <p style={{ fontSize: '0.9rem', margin: '0 0 8px' }}>
        {value.length === 0 ? 'Elegí al menos un servicio.' : `${value.length} ${value.length === 1 ? 'servicio elegido' : 'servicios elegidos'}. El principal se muestra primero.`}
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {groups.map((group) => (
          <fieldset key={group.id} style={{ border: '1px solid #eceff4', borderRadius: 10, margin: 0, padding: '8px 12px' }}>
            <legend style={{ fontWeight: 600, padding: '0 4px' }}>{group.name}</legend>
            <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              {group.items.map((item) => {
                const checked = value.includes(item.id)
                const principal = value[0] === item.id
                return (
                  <div key={item.id} style={{ alignItems: 'center', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <label style={{ alignItems: 'center', display: 'inline-flex', gap: 6 }}>
                      <input checked={checked} id={`${idPrefix}-${item.id}`} onChange={(event) => toggle(item.id, event.target.checked)} type="checkbox" />
                      <span>{item.label}</span>
                    </label>
                    {checked && principal ? <small style={{ color: '#b54708' }}>principal</small> : null}
                    {checked && !principal ? (
                      <button onClick={() => makePrincipal(item.id)} style={{ background: 'none', border: 0, color: '#155eef', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }} type="button">
                        hacer principal
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  )
}
