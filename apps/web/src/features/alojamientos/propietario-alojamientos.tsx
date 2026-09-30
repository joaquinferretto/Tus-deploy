'use client'

import { useEffect, useState } from 'react'
import type { AlojamientoPublicoDTO } from '@factory/contracts'
import { buscarAlojamientos } from './alojamientos-client'

export function PropietarioAlojamientosView(): React.ReactNode {
  const [alojamientos, setAlojamientos] = useState<AlojamientoPublicoDTO[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    buscarAlojamientos()
      .then(setAlojamientos)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827' }}>
          Mis Alojamientos
        </h1>
        <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>
          Panel de gestión de propiedades, unidades, tarifas, disponibilidad y reservas.
        </p>
      </header>

      {loading ? (
        <p>Cargando tus propiedades...</p>
      ) : alojamientos.length === 0 ? (
        <div style={{ background: '#ffffff', borderRadius: 12, padding: '3rem 1.5rem', textAlign: 'center', border: '1px solid #e5e7eb' }}>
          <p style={{ fontSize: '1.1rem', color: '#4b5563', marginBottom: '1.5rem' }}>
            No tenés alojamientos registrados todavía.
          </p>
          <button
            type="button"
            style={{
              minHeight: 44,
              padding: '0.5rem 1.5rem',
              backgroundColor: '#ff5a00',
              color: '#fff',
              fontWeight: 600,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Publicar mi primer alojamiento
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {alojamientos.map((a) => (
            <div
              key={a.id}
              style={{
                background: '#ffffff',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
                overflow: 'hidden',
                boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ height: 160, background: '#f3f4f6', overflow: 'hidden' }}>
                {a.imagenes[0] ? (
                  <img
                    src={a.imagenes[0].url}
                    alt={a.nombre}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                    Sin foto
                  </div>
                )}
              </div>

              <div style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>{a.nombre}</h3>
                  <span style={{ fontSize: 11, background: '#ecfdf5', color: '#065f46', padding: '2px 8px', borderRadius: 9999, fontWeight: 600 }}>
                    Publicado
                  </span>
                </div>

                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 12 }}>
                  {a.direccion}
                </p>

                <div style={{ fontSize: '0.875rem', color: '#374151', marginBottom: 16 }}>
                  <strong>{a.unidadesContador}</strong> unidades activas ·{' '}
                  <strong>{a.rating ? `★ ${a.rating.average}` : 'Sin calificaciones'}</strong>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      minHeight: 44,
                      background: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Gestionar
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      minHeight: 44,
                      background: '#111827',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Reservas
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
