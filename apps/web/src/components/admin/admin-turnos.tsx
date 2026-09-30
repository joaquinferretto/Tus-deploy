'use client'

import { useState, useEffect, useCallback } from 'react'
import type { DetalleTurno } from '@factory/contracts'
import styles from './admin.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function AdminTurnos(): React.ReactNode {
  const [turnos, setTurnos] = useState<DetalleTurno[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  const [filtroDesde, setFiltroDesde] = useState<string>('')
  const [filtroHasta, setFiltroHasta] = useState<string>('')
  const [pagina, setPagina] = useState(1)

  // Modal modificar precio
  const [turnoAEditar, setTurnoAEditar] = useState<DetalleTurno | null>(null)
  const [nuevoPrecio, setNuevoPrecio] = useState<string>('')
  const [motivoPrecio, setMotivoPrecio] = useState<string>('')
  const [guardandoPrecio, setGuardandoPrecio] = useState(false)
  const [errorPrecio, setErrorPrecio] = useState<string | null>(null)

  // Modal forzar turno
  const [modalForzar, setModalForzar] = useState(false)
  const [forzarPrestadorId, setForzarPrestadorId] = useState('')
  const [forzarOficioId, setForzarOficioId] = useState('')
  const [forzarInicio, setForzarInicio] = useState('')
  const [forzarCliente, setForzarCliente] = useState('')
  const [forzarTelefono, setForzarTelefono] = useState('')
  const [forzarMotivo, setForzarMotivo] = useState('')
  const [guardandoForzado, setGuardandoForzado] = useState(false)
  const [errorForzado, setErrorForzado] = useState<string | null>(null)

  const cargarTurnos = useCallback(() => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      pagina: String(pagina),
      tamano: '25',
    })
    if (filtroEstado) params.set('estado', filtroEstado)
    if (filtroDesde) params.set('desde', filtroDesde)
    if (filtroHasta) params.set('hasta', filtroHasta)

    fetch(`/tus/v1/admin/turnos?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'x-correlation-id': `adm-turnos-${Date.now()}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'No se pudieron cargar los turnos')
        }
        return res.json()
      })
      .then((data) => {
        setTurnos(data.items || [])
        setTotal(data.total || 0)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [pagina, filtroEstado, filtroDesde, filtroHasta])

  useEffect(() => {
    cargarTurnos()
  }, [cargarTurnos])

  async function handleGuardarPrecio(e: React.FormEvent) {
    e.preventDefault()
    if (!turnoAEditar) return
    if (!motivoPrecio.trim() || motivoPrecio.trim().length < 5) {
      setErrorPrecio('El motivo de modificación es obligatorio (mínimo 5 caracteres).')
      return
    }

    setGuardandoPrecio(true)
    setErrorPrecio(null)

    try {
      const res = await fetch(`/tus/v1/admin/turnos/${encodeURIComponent(turnoAEditar.id)}/precio`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': `adm-precio-${Date.now()}`,
        },
        body: JSON.stringify({
          precioFinal: Number(nuevoPrecio),
          motivo: motivoPrecio.trim(),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo modificar el precio')
      }

      setTurnoAEditar(null)
      cargarTurnos()
    } catch (err: unknown) {
      setErrorPrecio(err instanceof Error ? err.message : 'Error al modificar precio')
    } finally {
      setGuardandoPrecio(false)
    }
  }

  async function handleGuardarForzado(e: React.FormEvent) {
    e.preventDefault()
    if (!forzarMotivo.trim() || forzarMotivo.trim().length < 5) {
      setErrorForzado('El motivo de forzado es obligatorio (mínimo 5 caracteres).')
      return
    }

    setGuardandoForzado(true)
    setErrorForzado(null)

    try {
      const res = await fetch('/tus/v1/admin/turnos/forzar', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': `adm-forzar-${Date.now()}`,
        },
        body: JSON.stringify({
          prestadorId: forzarPrestadorId.trim(),
          oficioId: forzarOficioId.trim(),
          inicio: forzarInicio,
          clienteNombre: forzarCliente.trim(),
          clienteTelefono: forzarTelefono.trim() || undefined,
          motivoForzado: forzarMotivo.trim(),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo forzar el turno')
      }

      setModalForzar(false)
      cargarTurnos()
    } catch (err: unknown) {
      setErrorForzado(err instanceof Error ? err.message : 'Error al forzar turno')
    } finally {
      setGuardandoForzado(false)
    }
  }

  return (
    <div style={{ padding: '24px 20px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 4px 0' }}>Supervisión de Turnos</h1>
          <p style={{ margin: 0, color: 'var(--tus-muted)', fontSize: '0.92rem' }}>
            Control de agenda, snapshots históricos, auditoría de precios y turnos forzados.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalForzar(true)
            setErrorForzado(null)
          }}
          className={styles.buttonPrimary}
        >
          + Forzar turno fuera de horario
        </button>
      </div>

      {/* Barra de filtros */}
      <div className={`${styles.card} ${styles.filters}`} style={{ marginBottom: 20 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Estado</label>
          <select
            value={filtroEstado}
            onChange={(e) => {
              setFiltroEstado(e.target.value)
              setPagina(1)
            }}
          >
            <option value="">Todos los estados</option>
            <option value="confirmed">Confirmados</option>
            <option value="completed">Completados</option>
            <option value="cancelled">Cancelados</option>
            <option value="no-show">No asistió</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Desde</label>
          <input
            type="date"
            value={filtroDesde}
            onChange={(e) => {
              setFiltroDesde(e.target.value)
              setPagina(1)
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Hasta</label>
          <input
            type="date"
            value={filtroHasta}
            onChange={(e) => {
              setFiltroHasta(e.target.value)
              setPagina(1)
            }}
          />
        </div>

        {(filtroEstado || filtroDesde || filtroHasta) && (
          <button
            type="button"
            onClick={() => {
              setFiltroEstado('')
              setFiltroDesde('')
              setFiltroHasta('')
              setPagina(1)
            }}
            className={styles.buttonSecondary}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Contenido / Listado */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--tus-muted)' }}>Cargando turnos...</div>
      ) : error ? (
        <div role="alert" style={{ background: '#fee2e2', color: '#dc2626', padding: 16, borderRadius: 8 }}>{error}</div>
      ) : turnos.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid var(--tus-line)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--tus-muted)' }}>
          No se encontraron turnos con los filtros actuales.
        </div>
      ) : (
        <div style={{ background: '#ffffff', border: '1px solid var(--tus-line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--tus-surface)', borderBottom: '1px solid var(--tus-line)' }}>
                  <th style={{ padding: '12px 16px' }}>Fecha y Hora</th>
                  <th style={{ padding: '12px 16px' }}>Prestador</th>
                  <th style={{ padding: '12px 16px' }}>Servicio</th>
                  <th style={{ padding: '12px 16px' }}>Cliente</th>
                  <th style={{ padding: '12px 16px' }}>Precio</th>
                  <th style={{ padding: '12px 16px' }}>Estado</th>
                  <th style={{ padding: '12px 16px' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {turnos.map((t) => {
                  const fecha = new Date(t.inicio).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  const hora = new Date(t.inicio).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--tus-line)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                        {fecha} {hora} hs
                        <div style={{ fontSize: '0.8rem', color: 'var(--tus-muted)' }}>{t.duracionMinutos} min</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{t.prestadorNombre}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div>{t.tarifaNombre || t.oficioId}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div>{t.clienteNombre || 'Invitado'}</div>
                        {t.clienteTelefono ? <div style={{ fontSize: '0.8rem', color: 'var(--tus-muted)' }}>{t.clienteTelefono}</div> : null}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div>${PESOS.format(t.precioFinal ?? 0)}</div>
                        {t.modificadoPorAdminId ? (
                          <span style={{ fontSize: '0.75rem', background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: 4 }}>
                            Auditado
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background:
                              t.estado === 'confirmed'
                                ? '#dcfce7'
                                : t.estado === 'completed'
                                ? '#e0e7ff'
                                : t.estado === 'cancelled'
                                ? '#fee2e2'
                                : '#f3f4f6',
                            color:
                              t.estado === 'confirmed'
                                ? '#15803d'
                                : t.estado === 'completed'
                                ? '#4338ca'
                                : t.estado === 'cancelled'
                                ? '#b91c1c'
                                : '#4b5563',
                          }}
                        >
                          {t.estado}
                        </span>
                        {t.forzadoFueraHorario ? (
                          <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 2 }}>⚡ Forzado</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setTurnoAEditar(t)
                            setNuevoPrecio(String(t.precioFinal ?? ''))
                            setMotivoPrecio(t.motivoModificacionPrecio ?? '')
                            setErrorPrecio(null)
                          }}
                          style={{
                            background: '#ffffff',
                            border: '1px solid var(--tus-line)',
                            borderRadius: 6,
                            padding: '6px 10px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                          }}
                        >
                          Editar precio
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--tus-surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--tus-muted)', fontSize: '0.88rem' }}>Total: {total} turnos</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--tus-line)', background: '#fff', cursor: pagina > 1 ? 'pointer' : 'default' }}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={turnos.length < 25}
                onClick={() => setPagina((p) => p + 1)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--tus-line)', background: '#fff', cursor: turnos.length >= 25 ? 'pointer' : 'default' }}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal modificar precio */}
      {turnoAEditar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20, 33, 61, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div className={styles.card} style={{ maxWidth: 460, width: '100%', padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 12px 0' }}>Modificar precio de turno</h2>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: 'var(--tus-muted)' }}>
              Prestador: <strong>{turnoAEditar.prestadorNombre}</strong> · Cliente: <strong>{turnoAEditar.clienteNombre}</strong>
            </p>

            <form className={styles.form} onSubmit={handleGuardarPrecio}>
              <div>
                <label>Precio final ($ ARS) *</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={nuevoPrecio}
                  onChange={(e) => setNuevoPrecio(e.target.value)}
                />
              </div>

              <div>
                <label>Motivo obligatorio de modificación *</label>
                <textarea
                  required
                  rows={3}
                  value={motivoPrecio}
                  onChange={(e) => setMotivoPrecio(e.target.value)}
                  placeholder="Justificá el motivo por el cual se modifica el precio del turno..."
                />
              </div>

              {errorPrecio && <p className={styles.error} role="alert">{errorPrecio}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setTurnoAEditar(null)}
                  className={styles.buttonSecondary}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoPrecio}
                  className={styles.buttonPrimary}
                >
                  {guardandoPrecio ? 'Guardando...' : 'Guardar y auditar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal forzar turno fuera de horario */}
      {modalForzar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20, 33, 61, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div className={styles.card} style={{ maxWidth: 500, width: '100%', padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 8px 0' }}>Forzar turno fuera de horario</h2>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.88rem', color: 'var(--tus-muted)' }}>
              Permite agendar un turno especial fuera de la jornada regular. Requiere motivo de auditoría.
            </p>

            <form className={styles.form} onSubmit={handleGuardarForzado}>
              <div className={styles.formGrid}>
                <div>
                  <label>ID Prestador *</label>
                  <input
                    type="text"
                    required
                    value={forzarPrestadorId}
                    onChange={(e) => setForzarPrestadorId(e.target.value)}
                    placeholder="ID de perfil o prestador"
                  />
                </div>
                <div>
                  <label>ID Oficio/Servicio *</label>
                  <input
                    type="text"
                    required
                    value={forzarOficioId}
                    onChange={(e) => setForzarOficioId(e.target.value)}
                    placeholder="ej. masajes, mecanica"
                  />
                </div>
              </div>

              <div>
                <label>Fecha y hora de inicio *</label>
                <input
                  type="datetime-local"
                  required
                  value={forzarInicio}
                  onChange={(e) => setForzarInicio(e.target.value)}
                />
              </div>

              <div className={styles.formGrid}>
                <div>
                  <label>Nombre Cliente *</label>
                  <input
                    type="text"
                    required
                    value={forzarCliente}
                    onChange={(e) => setForzarCliente(e.target.value)}
                    placeholder="Nombre y apellido"
                  />
                </div>
                <div>
                  <label>Teléfono</label>
                  <input
                    type="tel"
                    value={forzarTelefono}
                    onChange={(e) => setForzarTelefono(e.target.value)}
                    placeholder="3794..."
                  />
                </div>
              </div>

              <div>
                <label>Motivo obligatorio de forzado *</label>
                <textarea
                  required
                  rows={2}
                  value={forzarMotivo}
                  onChange={(e) => setForzarMotivo(e.target.value)}
                  placeholder="Motivo de urgencia o autorización de excepción..."
                />
              </div>

              {errorForzado && <p className={styles.error} role="alert">{errorForzado}</p>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setModalForzar(false)}
                  className={styles.buttonSecondary}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoForzado}
                  className={styles.buttonPrimary}
                >
                  {guardandoForzado ? 'Forzando...' : 'Confirmar forzado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
