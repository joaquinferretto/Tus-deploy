'use client'

import { useEffect, useState } from 'react'
import type { AlojamientoPublicoDTO, TipoAlojamientoDTO } from '@factory/contracts'
import {
  buscarAlojamientos,
  listarTiposAlojamiento,
  adminCrearAlojamiento,
  adminCrearUnidad,
  adminCrearTarifa,
} from '@/features/alojamientos/alojamientos-client'

export function AdminAlojamientosView(): React.ReactNode {
  const [alojamientos, setAlojamientos] = useState<AlojamientoPublicoDTO[]>([])
  const [tipos, setTipos] = useState<TipoAlojamientoDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [creando, setCreando] = useState(false)

  // Formulario nuevo alojamiento (soporta datos ficticios de test)
  const [nombre, setNombre] = useState('')
  const [tipoId, setTipoId] = useState('')
  const [direccion, setDireccion] = useState('')
  const [latitud, setLatitud] = useState(-34.6037)
  const [longitud, setLongitud] = useState(-58.3816)
  const [descripcion, setDescripcion] = useState('')
  const [comodidades, setComodidades] = useState('WiFi, Estacionamiento, Desayuno')
  const [mensaje, setMensaje] = useState<string | null>(null)

  const cargarDatos = async () => {
    setLoading(true)
    try {
      const [listaTipos, listaAlojamientos] = await Promise.all([
        listarTiposAlojamiento(),
        buscarAlojamientos(),
      ])
      setTipos(listaTipos)
      if (listaTipos[0]) setTipoId(listaTipos[0].id)
      setAlojamientos(listaAlojamientos)
    } catch {
      // handled
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargarDatos()
  }, [])

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault()
    setMensaje(null)
    const slug = nombre
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    try {
      const nuevo = await adminCrearAlojamiento({
        tipoId,
        nombre,
        slug: `${slug}-${Date.now().toString().slice(-4)}`,
        descripcion,
        direccion,
        latitud,
        longitud,
        comodidades: comodidades.split(',').map((c) => c.trim()).filter(Boolean),
      })

      // Agregar unidad y tarifa básica por defecto
      const u = await adminCrearUnidad(nuevo.id, {
        nombre: 'Unidad Estándar Principal',
        capacidadPersonas: 2,
        camasDetalle: '1 Cama Doble',
      })

      await adminCrearTarifa(u.id, {
        modalidad: 'noche',
        precio: 45000,
        minimoEstadia: 1,
      })

      setMensaje('¡Alojamiento ficticio creado exitosamente con unidad y tarifa base!')
      setNombre('')
      setDescripcion('')
      setDireccion('')
      setCreando(false)
      await cargarDatos()
    } catch (err: unknown) {
      setMensaje(err instanceof Error ? err.message : 'Error al crear')
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Administración de Alojamientos
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
            Gestioná catálogo, alojamientos comerciales, unidades y datos ficticios de test.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreando(!creando)}
          style={{
            minHeight: 44,
            padding: '0.5rem 1.25rem',
            backgroundColor: '#ff5a00',
            color: '#fff',
            fontWeight: 600,
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {creando ? 'Cancelar' : '+ Nuevo Alojamiento (Test/Real)'}
        </button>
      </header>

      {mensaje && (
        <div style={{ background: '#ecfdf5', color: '#065f46', padding: '1rem', borderRadius: 8, marginBottom: '1.5rem' }}>
          {mensaje}
        </div>
      )}

      {/* Formulario de creación */}
      {creando && (
        <form
          onSubmit={handleCrear}
          style={{
            background: '#ffffff',
            borderRadius: 12,
            border: '1px solid #e5e7eb',
            padding: '1.5rem',
            marginBottom: '2rem',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
            Alta de Alojamiento (Ficticio para pruebas o Real)
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                Nombre del establecimiento *
              </label>
              <input
                type="text"
                required
                style={{ width: '100%', minHeight: 44, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6 }}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. Cabañas Sol y Luna"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                Tipo de alojamiento *
              </label>
              <select
                style={{ width: '100%', minHeight: 44, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}
                value={tipoId}
                onChange={(e) => setTipoId(e.target.value)}
              >
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                Dirección física *
              </label>
              <input
                type="text"
                required
                style={{ width: '100%', minHeight: 44, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6 }}
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Ej. Av. Los Quebrachos 120"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                Latitud (Pin mapa)
              </label>
              <input
                type="number"
                step="any"
                style={{ width: '100%', minHeight: 44, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6 }}
                value={latitud}
                onChange={(e) => setLatitud(Number(e.target.value))}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                Longitud (Pin mapa)
              </label>
              <input
                type="number"
                step="any"
                style={{ width: '100%', minHeight: 44, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6 }}
                value={longitud}
                onChange={(e) => setLongitud(Number(e.target.value))}
              />
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
              Comodidades (separadas por coma)
            </label>
            <input
              type="text"
              style={{ width: '100%', minHeight: 44, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6 }}
              value={comodidades}
              onChange={(e) => setComodidades(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
              Descripción general
            </label>
            <textarea
              style={{ width: '100%', minHeight: 70, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6 }}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripción del alojamiento..."
            />
          </div>

          <button
            type="submit"
            style={{
              minHeight: 44,
              padding: '0.5rem 1.5rem',
              backgroundColor: '#111827',
              color: '#fff',
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Guardar Alojamiento Ficticio
          </button>
        </form>
      )}

      {/* Listado de Alojamientos Registrados */}
      <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb', fontWeight: 700 }}>
          Alojamientos en Base de Datos ({alojamientos.length})
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>Cargando datos...</div>
        ) : alojamientos.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
            No hay alojamientos registrados aún. Hacé clic en "+ Nuevo Alojamiento" para crear datos de prueba.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Nombre</th>
                <th style={{ padding: '0.75rem 1rem' }}>Tipo</th>
                <th style={{ padding: '0.75rem 1rem' }}>Ubicación</th>
                <th style={{ padding: '0.75rem 1rem' }}>Unidades</th>
                <th style={{ padding: '0.75rem 1rem' }}>Tarifa Desde</th>
                <th style={{ padding: '0.75rem 1rem' }}>Rating</th>
              </tr>
            </thead>
            <tbody>
              {alojamientos.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#111827' }}>
                    {a.nombre}
                    {a.propietarioId === null && (
                      <span style={{ marginLeft: 6, fontSize: 11, background: '#e0e7ff', color: '#3730a3', padding: '2px 6px', borderRadius: 4 }}>
                        Test Admin
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: '#4b5563' }}>{a.tipo.nombre}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#4b5563' }}>{a.direccion}</td>
                  <td style={{ padding: '0.75rem 1rem', color: '#4b5563' }}>{a.unidadesContador} activas</td>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                    {a.precioDesde ? `$${a.precioDesde.amount.toLocaleString('es-AR')}` : 'Sin tarifa'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {a.rating ? `★ ${a.rating.average} (${a.rating.count})` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
