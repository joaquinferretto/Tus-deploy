'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AlojamientoAdminDTO, PaginaAdminAlojamientos, ReservaAlojamientoAdminDTO, TipoAlojamientoDTO } from '@factory/contracts'
import {
  adminListarAlojamientos,
  adminListarReservasAlojamiento,
  adminSuspenderAlojamiento,
  listarTiposAlojamiento,
  adminCrearAlojamiento,
  adminCrearUnidad,
  adminCrearTarifa,
} from '@/features/alojamientos/alojamientos-client'
import { DEFAULT_MAP_CENTER } from '@/features/home/types'
import styles from './admin.module.css'

export function AdminAlojamientosView(): React.ReactNode {
  const [tipos, setTipos] = useState<TipoAlojamientoDTO[]>([])
  const [creando, setCreando] = useState(false)
  const [version, setVersion] = useState(0)

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
    try {
      const listaTipos = await listarTiposAlojamiento()
      setTipos(listaTipos)
      if (listaTipos[0]) setTipoId(listaTipos[0].id)
    } catch {
      // handled
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
      setVersion((actual) => actual + 1)
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

      <GestionAdminAlojamientos version={version} />
    </div>
  )
}

// ALOJAMIENTOS-ADMIN-01. What the administration consults and decides: every lodging whatever its
// state with its owner, the reservations of every lodging, and suspending a lodging (or lifting
// its suspension) with a mandatory note. Every row, state and count is the API's.
const ESTADO_ALOJAMIENTO: Record<string, [string, string]> = { borrador: ['Borrador', styles.badgeOff ?? ''], publicado: ['Publicado', styles.badgeOk ?? ''], pausado: ['Pausado', styles.badgeWarn ?? ''], suspendido: ['Suspendido', styles.badgeOff ?? ''] }
const ESTADO_RESERVA: Record<string, string> = { confirmed: 'Confirmada', checked_in: 'En curso', completed: 'Finalizada', cancelled: 'Cancelada', pending_payment: 'Pendiente de pago', expired: 'Vencida' }
const dia = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })

function GestionAdminAlojamientos({ version }: { version: number }): React.ReactNode {
  const [vista, setVista] = useState<'alojamientos' | 'reservas'>('alojamientos')
  const [estado, setEstado] = useState('')
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(1)
  const [lista, setLista] = useState<PaginaAdminAlojamientos<AlojamientoAdminDTO> | null>(null)
  const [reservas, setReservas] = useState<PaginaAdminAlojamientos<ReservaAlojamientoAdminDTO> | null>(null)
  const [error, setError] = useState('')
  const [accion, setAccion] = useState<{ id: string; nombre: string; suspender: boolean } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setError('')
    try {
      if (vista === 'alojamientos') setLista(await adminListarAlojamientos({ estado, q: q.trim(), pagina }))
      else setReservas(await adminListarReservasAlojamiento({ estado, pagina }))
    } catch {
      setError('No pudimos cargar los datos. Reintentá.')
    }
  }, [vista, estado, q, pagina])
  useEffect(() => {
    void cargar()
  }, [cargar, version])

  const confirmar = async () => {
    if (!accion || motivo.trim().length < 5) return
    setGuardando(true)
    setError('')
    try {
      await adminSuspenderAlojamiento(accion.id, accion.suspender, motivo.trim())
      setAccion(null)
      setMotivo('')
      await cargar()
    } catch (cause: unknown) {
      setError(cause instanceof Error && cause.message ? cause.message : 'No se pudo aplicar el cambio.')
    } finally {
      setGuardando(false)
    }
  }
  const actual = vista === 'alojamientos' ? lista : reservas
  const cambiarVista = (siguiente: 'alojamientos' | 'reservas') => { setVista(siguiente); setEstado(''); setPagina(1); setAccion(null) }

  return (
    <section className={styles.card} data-admin-alojamientos={vista}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button aria-pressed={vista === 'alojamientos'} className={vista === 'alojamientos' ? styles.buttonPrimary : styles.buttonSecondary} onClick={() => cambiarVista('alojamientos')} type="button">Alojamientos</button>
        <button aria-pressed={vista === 'reservas'} className={vista === 'reservas' ? styles.buttonPrimary : styles.buttonSecondary} onClick={() => cambiarVista('reservas')} type="button">Reservas</button>
        <select aria-label="Estado" onChange={(event) => { setEstado(event.target.value); setPagina(1) }} value={estado}>
          <option value="">Todos los estados</option>
          {Object.entries(vista === 'alojamientos' ? Object.fromEntries(Object.entries(ESTADO_ALOJAMIENTO).map(([clave, [texto]]) => [clave, texto])) : ESTADO_RESERVA).map(([clave, texto]) => <option key={clave} value={clave}>{texto}</option>)}
        </select>
        {vista === 'alojamientos' ? <input aria-label="Buscar por nombre" maxLength={80} onChange={(event) => { setQ(event.target.value); setPagina(1) }} placeholder="Buscar por nombre" style={{ flex: '1 1 160px', minWidth: 0 }} type="search" value={q} /> : null}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {accion ? (
        <div data-suspension={accion.suspender ? 'suspender' : 'levantar'} role="group" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, display: 'grid', gap: 8, marginBottom: 12, padding: 12 }}>
          <span>
            {accion.suspender
              ? `Vas a suspender "${accion.nombre}": sale de la búsqueda, no admite reservas nuevas y su propietario no puede volver a publicarlo. Las reservas ya hechas no cambian.`
              : `Vas a levantar la suspensión de "${accion.nombre}": queda pausado y se puede volver a publicar.`}
          </span>
          <label style={{ display: 'grid', gap: 4 }}>Motivo administrativo (obligatorio)<textarea data-motivo-suspension maxLength={300} onChange={(event) => setMotivo(event.target.value)} rows={2} value={motivo} /></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className={styles.buttonPrimary} data-confirmar-suspension disabled={guardando || motivo.trim().length < 5} onClick={() => void confirmar()} type="button">{guardando ? 'Guardando…' : accion.suspender ? 'Sí, suspender' : 'Sí, levantar suspensión'}</button>
            <button className={styles.buttonSecondary} disabled={guardando} onClick={() => { setAccion(null); setMotivo('') }} type="button">Volver</button>
          </div>
        </div>
      ) : null}
      {!actual ? <p className={styles.muted} role="status">Cargando…</p> : actual.items.length === 0 ? <p className={styles.muted}>No hay {vista} con ese filtro.</p> : (
        // A wide table scrolls inside its own box; the page itself never scrolls sideways.
        <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
          {vista === 'alojamientos' && lista ? (
            <table className={styles.table}>
              <thead><tr><th>Alojamiento</th><th>Estado</th><th>Propietario</th><th>Unidades</th><th>Reservas vigentes</th><th /></tr></thead>
              <tbody>
                {lista.items.map((item) => (
                  <tr data-alojamiento={item.id} data-estado={item.estado} key={item.id}>
                    <td data-label="Alojamiento"><strong>{item.nombre}</strong><br /><span className={styles.muted}>{item.tipoNombre}{item.barrio ? ` · ${item.barrio}` : ''}</span></td>
                    <td data-label="Estado"><span className={`${styles.badge} ${ESTADO_ALOJAMIENTO[item.estado]?.[1] ?? ''}`}>{ESTADO_ALOJAMIENTO[item.estado]?.[0] ?? item.estado}</span></td>
                    <td data-label="Propietario" style={{ overflowWrap: 'anywhere' }}>{item.propietario ? <><a href={`/tus/admin/usuarios/${encodeURIComponent(item.propietario.cuentaId)}`}>{item.propietario.nombre}</a><br /><span className={styles.muted}>{item.propietario.email}</span></> : <span className={styles.muted}>Gestionado por TUS</span>}</td>
                    <td data-label="Unidades">{item.unidades}</td>
                    <td data-label="Reservas vigentes">{item.reservasVigentes}</td>
                    <td>
                      {item.estado === 'suspendido'
                        ? <button className={styles.buttonSecondary} data-levantar onClick={() => { setAccion({ id: item.id, nombre: item.nombre, suspender: false }); setMotivo('') }} type="button">Levantar suspensión</button>
                        : <button className={styles.buttonSecondary} data-suspender onClick={() => { setAccion({ id: item.id, nombre: item.nombre, suspender: true }); setMotivo('') }} type="button">Suspender</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : reservas ? (
            <table className={styles.table}>
              <thead><tr><th>Alojamiento</th><th>Huésped</th><th>Entrada</th><th>Salida</th><th>Personas</th><th>Estado</th><th>Total</th></tr></thead>
              <tbody>
                {reservas.items.map((item) => (
                  <tr data-reserva={item.id} key={item.id}>
                    <td data-label="Alojamiento"><strong>{item.alojamientoNombre}</strong><br /><span className={styles.muted}>{item.unidadNombre}</span></td>
                    <td data-label="Huésped" style={{ overflowWrap: 'anywhere' }}>{item.clienteId ? <a href={`/tus/admin/usuarios/${encodeURIComponent(item.clienteId)}`}>{item.clienteNombre}</a> : item.clienteNombre}</td>
                    <td data-label="Entrada">{dia(item.fechaInicio)}</td>
                    <td data-label="Salida">{dia(item.fechaFin)}</td>
                    <td data-label="Personas">{item.cantidadPersonas}</td>
                    <td data-label="Estado">{ESTADO_RESERVA[item.estado] ?? item.estado}</td>
                    <td data-label="Total">${item.total.toLocaleString('es-AR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}
      {actual && actual.totalPages > 1 ? (
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button className={styles.buttonSecondary} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} type="button">Anterior</button>
          <span className={styles.muted}>Página {actual.page} de {actual.totalPages} · {actual.total} en total</span>
          <button className={styles.buttonSecondary} disabled={pagina >= actual.totalPages} onClick={() => setPagina(pagina + 1)} type="button">Siguiente</button>
        </div>
      ) : null}
    </section>
  )
}
