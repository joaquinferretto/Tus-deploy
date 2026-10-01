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
import { DEFAULT_MAP_CENTER } from '@/features/home/types'
import styles from './admin.module.css'

export function AdminAlojamientosView(): React.ReactNode {
  const [alojamientos, setAlojamientos] = useState<AlojamientoPublicoDTO[]>([])
  const [tipos, setTipos] = useState<TipoAlojamientoDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [creando, setCreando] = useState(false)

  // Formulario nuevo alojamiento (soporta datos ficticios de test)
  const [nombre, setNombre] = useState('')
  const [tipoId, setTipoId] = useState('')
  const [direccion, setDireccion] = useState('')
  // Starting point of a new lodging: the same default as every TUS map (Corrientes Capital).
  const [latitud, setLatitud] = useState(DEFAULT_MAP_CENTER.lat)
  const [longitud, setLongitud] = useState(DEFAULT_MAP_CENTER.lng)
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
        <form className={`${styles.card} ${styles.form}`} onSubmit={handleCrear}>
          <h2>Alta de Alojamiento (Ficticio para pruebas o Real)</h2>
          <div className={styles.formGrid}>
            <label>
              Nombre del establecimiento *
              <input onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Cabañas Sol y Luna" required type="text" value={nombre} />
            </label>
            <label>
              Tipo de alojamiento *
              <select onChange={(e) => setTipoId(e.target.value)} value={tipoId}>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Dirección física *
              <input onChange={(e) => setDireccion(e.target.value)} placeholder="Ej. Av. Los Quebrachos 120" required type="text" value={direccion} />
            </label>
            <label>
              Latitud (Pin mapa)
              <input onChange={(e) => setLatitud(Number(e.target.value))} step="any" type="number" value={latitud} />
            </label>
            <label>
              Longitud (Pin mapa)
              <input onChange={(e) => setLongitud(Number(e.target.value))} step="any" type="number" value={longitud} />
            </label>
          </div>
          <label>
            Comodidades (separadas por coma)
            <input onChange={(e) => setComodidades(e.target.value)} type="text" value={comodidades} />
          </label>
          <label>
            Descripción general
            <textarea onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción del alojamiento..." value={descripcion} />
          </label>
          <div>
            <button className={styles.buttonPrimary} type="submit">
              Guardar Alojamiento Ficticio
            </button>
          </div>
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
            No hay alojamientos registrados aún. Hacé clic en &quot;+ Nuevo Alojamiento&quot; para crear datos de prueba.
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
