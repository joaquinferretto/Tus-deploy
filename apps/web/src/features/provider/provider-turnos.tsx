'use client'

import { useState, useEffect, useCallback } from 'react'
import type { DetalleTurno } from '@factory/contracts'
import homeStyles from '../home/home.module.css'
import styles from '../directory/directory.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function ProviderTurnos(): React.ReactNode {
  const [turnos, setTurnos] = useState<DetalleTurno[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<string>('')

  // Modal turno manual
  const [modalManual, setModalManual] = useState(false)
  const [manualOficio, setManualOficio] = useState('')
  const [manualInicio, setManualInicio] = useState('')
  const [manualCliente, setManualCliente] = useState('')
  const [manualTelefono, setManualTelefono] = useState('')
  const [manualPrecio, setManualPrecio] = useState('')
  const [manualNotas, setManualNotas] = useState('')
  const [guardandoManual, setGuardandoManual] = useState(false)
  const [errorManual, setErrorManual] = useState<string | null>(null)

  // Modal bloqueo
  const [modalBloqueo, setModalBloqueo] = useState(false)
  const [bloqueoInicio, setBloqueoInicio] = useState('')
  const [bloqueoFin, setBloqueoFin] = useState('')
  const [bloqueoMotivo, setBloqueoMotivo] = useState('')
  const [guardandoBloqueo, setGuardandoBloqueo] = useState(false)
  const [errorBloqueo, setErrorBloqueo] = useState<string | null>(null)

  const cargarTurnos = useCallback(() => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (filtroEstado) params.set('estado', filtroEstado)

    fetch(`/tus/v1/prestador/turnos?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'x-correlation-id': `pres-turnos-${Date.now()}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'No se pudieron cargar tus turnos')
        }
        return res.json()
      })
      .then((data) => {
        setTurnos(data.items || [])
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [filtroEstado])

  useEffect(() => {
    cargarTurnos()
  }, [cargarTurnos])

  async function cambiarEstado(id: string, nuevoEstado: string) {
    try {
      const res = await fetch(`/tus/v1/prestador/turnos/${encodeURIComponent(id)}/estado`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': `pres-estado-${Date.now()}`,
        },
        body: JSON.stringify({ estado: nuevoEstado }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Error al cambiar estado')
      }
      cargarTurnos()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al actualizar turno')
    }
  }

  async function handleCrearManual(e: React.FormEvent) {
    e.preventDefault()
    if (!manualOficio || !manualInicio || !manualCliente.trim()) {
      setErrorManual('Servicio, inicio y nombre de cliente son obligatorios.')
      return
    }

    setGuardandoManual(true)
    setErrorManual(null)

    try {
      const res = await fetch('/tus/v1/prestador/turnos/manual', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': `pres-man-${Date.now()}`,
        },
        body: JSON.stringify({
          oficioId: manualOficio.trim(),
          inicio: manualInicio,
          clienteNombre: manualCliente.trim(),
          clienteTelefono: manualTelefono.trim() || undefined,
          precioFinal: manualPrecio ? Number(manualPrecio) : undefined,
          notas: manualNotas.trim() || undefined,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo crear el turno manual')
      }

      setModalManual(false)
      cargarTurnos()
    } catch (err: unknown) {
      setErrorManual(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setGuardandoManual(false)
    }
  }

  async function handleBloquear(e: React.FormEvent) {
    e.preventDefault()
    if (!bloqueoInicio || !bloqueoFin) {
      setErrorBloqueo('Inicio y fin son obligatorios.')
      return
    }

    setGuardandoBloqueo(true)
    setErrorBloqueo(null)

    try {
      const res = await fetch('/tus/v1/prestador/turnos/bloquear', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': `pres-bloq-${Date.now()}`,
        },
        body: JSON.stringify({
          inicio: bloqueoInicio,
          fin: bloqueoFin,
          motivo: bloqueoMotivo.trim() || 'Bloqueo manual de horario',
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo registrar el bloqueo')
      }

      setModalBloqueo(false)
      cargarTurnos()
    } catch (err: unknown) {
      setErrorBloqueo(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setGuardandoBloqueo(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Botones de acción principales */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>Filtrar:</label>
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #d1d5db', minHeight: 40 }}
          >
            <option value="">Todos</option>
            <option value="confirmed">Confirmados</option>
            <option value="completed">Completados</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={homeStyles.buttonPrimary}
            onClick={() => {
              setModalManual(true)
              setErrorManual(null)
            }}
          >
            + Turno manual
          </button>
          <button
            type="button"
            className={homeStyles.buttonSecondary}
            onClick={() => {
              setModalBloqueo(true)
              setErrorBloqueo(null)
            }}
          >
            Bloquear horario
          </button>
        </div>
      </div>

      {/* Lista de turnos */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando agenda de turnos...</div>
      ) : error ? (
        <div role="alert" style={{ background: '#fee2e2', color: '#dc2626', padding: 16, borderRadius: 'var(--tus-control-radius)' }}>{error}</div>
      ) : turnos.length === 0 ? (
        <div className={styles.panel} style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
          No tenés turnos registrados con este filtro. Podés agendar uno manualmente o esperar reservas de clientes.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {turnos.map((t) => {
            const fecha = new Date(t.inicio).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
            const horaInicio = new Date(t.inicio).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            const horaFin = new Date(t.fin).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

            return (
              <div key={t.id} className={styles.panel} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    {fecha} · {horaInicio} a {horaFin} hs
                  </div>
                  <div style={{ color: '#4b5563', fontSize: '0.9rem', marginTop: 2 }}>
                    Cliente: <strong>{t.clienteNombre || 'Cliente'}</strong> {t.clienteTelefono ? `(${t.clienteTelefono})` : ''}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                    {t.tarifaNombre || t.oficioId} · {t.duracionMinutos} min · ${PESOS.format(t.precioFinal ?? 0)}
                  </div>
                  {t.notas ? <div style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 4 }}>Nota: {t.notas}</div> : null}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      padding: '4px 8px',
                      borderRadius: 'var(--tus-control-radius)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: t.estado === 'confirmed' ? '#dcfce7' : t.estado === 'completed' ? '#e0e7ff' : '#fee2e2',
                      color: t.estado === 'confirmed' ? '#15803d' : t.estado === 'completed' ? '#4338ca' : '#b91c1c',
                    }}
                  >
                    {t.estado}
                  </span>

                  {t.estado === 'confirmed' && (
                    <>
                      <button
                        type="button"
                        onClick={() => cambiarEstado(t.id, 'completed')}
                        style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #22c55e', background: '#f0fdf4', color: '#15803d', fontSize: '0.85rem', cursor: 'pointer' }}
                      >
                        ✓ Completado
                      </button>
                      <button
                        type="button"
                        onClick={() => cambiarEstado(t.id, 'cancelled')}
                        style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #ef4444', background: '#fef2f2', color: '#b91c1c', fontSize: '0.85rem', cursor: 'pointer' }}
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal turno manual */}
      {modalManual && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 12px 0' }}>Nuevo turno manual</h2>
            <form onSubmit={handleCrearManual} style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Oficio / Servicio *</label>
                <input
                  type="text"
                  required
                  value={manualOficio}
                  onChange={(e) => setManualOficio(e.target.value)}
                  placeholder="ej. masajes, electricidad"
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Fecha y hora de inicio *</label>
                <input
                  type="datetime-local"
                  required
                  value={manualInicio}
                  onChange={(e) => setManualInicio(e.target.value)}
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Nombre Cliente *</label>
                <input
                  type="text"
                  required
                  value={manualCliente}
                  onChange={(e) => setManualCliente(e.target.value)}
                  placeholder="Nombre y apellido"
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Teléfono</label>
                <input
                  type="tel"
                  value={manualTelefono}
                  onChange={(e) => setManualTelefono(e.target.value)}
                  placeholder="3794..."
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Precio final ($ ARS)</label>
                <input
                  type="number"
                  min="0"
                  value={manualPrecio}
                  onChange={(e) => setManualPrecio(e.target.value)}
                  placeholder="ej. 25000"
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Notas / Observaciones</label>
                <textarea
                  rows={2}
                  value={manualNotas}
                  onChange={(e) => setManualNotas(e.target.value)}
                  placeholder="Detalles sobre el turno o trabajo..."
                  className={styles.bookingControl}
                  style={{ minHeight: 80, resize: 'vertical' }}
                />
              </div>

              {errorManual && (
                <div role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', background: '#fee2e2', padding: '8px 12px', borderRadius: 'var(--tus-control-radius)' }}>
                  {errorManual}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setModalManual(false)}
                  className={homeStyles.buttonSecondary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoManual}
                  className={homeStyles.buttonPrimary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  {guardandoManual ? 'Guardando...' : 'Crear turno'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal bloqueo */}
      {modalBloqueo && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 12px 0' }}>Bloquear horario / Vacaciones</h2>
            <form onSubmit={handleBloquear} style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Desde *</label>
                <input
                  type="datetime-local"
                  required
                  value={bloqueoInicio}
                  onChange={(e) => setBloqueoInicio(e.target.value)}
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Hasta *</label>
                <input
                  type="datetime-local"
                  required
                  value={bloqueoFin}
                  onChange={(e) => setBloqueoFin(e.target.value)}
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Motivo</label>
                <input
                  type="text"
                  value={bloqueoMotivo}
                  onChange={(e) => setBloqueoMotivo(e.target.value)}
                  placeholder="ej. Médico, Trámites, Vacaciones"
                  className={styles.bookingControl}
                />
              </div>

              {errorBloqueo && (
                <div role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', background: '#fee2e2', padding: '8px 12px', borderRadius: 'var(--tus-control-radius)' }}>
                  {errorBloqueo}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setModalBloqueo(false)}
                  className={homeStyles.buttonSecondary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoBloqueo}
                  className={homeStyles.buttonPrimary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  {guardandoBloqueo ? 'Bloqueando...' : 'Confirmar bloqueo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
