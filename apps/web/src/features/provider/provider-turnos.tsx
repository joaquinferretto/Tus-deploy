'use client'

import { useState, useEffect, useCallback } from 'react'
import { CODIGO_SOLICITUD_SIN_HORARIO, etiquetaEstadoTurno, etiquetaSenaTurno, formatearPesos, normalizarTelefono, type DetalleTurno, type ServicioTurnosDTO } from '@factory/contracts'
import { TurnosError, diaTurno, horaTurno, turnosApi, turnosErrorDe, turnosFetch } from '../../lib/tus-turnos-client'
import { claseEstadoTurno } from '../turnos/estado-turno'
import { ProviderAvailability } from './provider-availability'
import homeStyles from '../home/home.module.css'
import styles from '../directory/directory.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function ProviderTurnos(): React.ReactNode {
  const [turnos, setTurnos] = useState<DetalleTurno[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  // Requests of clients waiting for this provider's answer: accepting opens the deposit payment.
  const [solicitudes, setSolicitudes] = useState<DetalleTurno[]>([])
  const [respondiendo, setRespondiendo] = useState<string | null>(null)
  const [avisoSolicitud, setAvisoSolicitud] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

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
  // Own services (from the API): the manual turno picks one of them, never a typed id.
  const [servicios, setServicios] = useState<ServicioTurnosDTO[]>([])
  // Bumped when a turno or a block changes: the weekly agenda above is asked again.
  const [versionAgenda, setVersionAgenda] = useState(0)
  useEffect(() => {
    void turnosApi.misServicios().then(setServicios).catch(() => setServicios([]))
  }, [])

  const cargarTurnos = useCallback(() => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (filtroEstado) params.set('estado', filtroEstado)

    turnosFetch(`/tus/v1/prestador/turnos?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw await turnosErrorDe(res, 'No se pudieron cargar tus turnos')
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

  const cargarSolicitudes = useCallback(() => {
    turnosApi
      .misSolicitudes()
      .then((resultado) => setSolicitudes(resultado.items))
      .catch(() => setSolicitudes([]))
  }, [])

  useEffect(() => {
    cargarTurnos()
  }, [cargarTurnos])

  useEffect(() => {
    cargarSolicitudes()
  }, [cargarSolicitudes])

  async function responder(solicitud: DetalleTurno, aceptar: boolean) {
    setRespondiendo(solicitud.id)
    setAvisoSolicitud(null)
    try {
      const turno = aceptar ? await turnosApi.aceptarSolicitud(solicitud.id) : await turnosApi.rechazarSolicitud(solicitud.id)
      // Accepting does not confirm a turno with a deposit: it waits for the client's payment.
      const detalle = turno.estado === 'awaiting_payment' ? ' Queda esperando que el cliente abone la seña; se confirma cuando Mercado Pago acredite el pago.' : ''
      setAvisoSolicitud({ tipo: 'ok', texto: `${etiquetaEstadoTurno(turno.estado)}: turno de ${solicitud.clienteNombre ?? 'el cliente'} del ${diaTurno(solicitud.inicio)} a las ${horaTurno(solicitud.inicio)} hs.${detalle}` })
    } catch (err: unknown) {
      // CODIGO_SOLICITUD_SIN_HORARIO: the time was no longer free and the API already stored the
      // request as rejected; the message says so.
      setAvisoSolicitud({ tipo: 'error', texto: err instanceof TurnosError && err.code === CODIGO_SOLICITUD_SIN_HORARIO ? err.message : err instanceof Error ? err.message : 'No pudimos responder la solicitud.' })
    } finally {
      setRespondiendo(null)
      cargarSolicitudes()
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    }
  }

  async function cambiarEstado(id: string, nuevoEstado: string) {
    try {
      const res = await turnosFetch(`/tus/v1/prestador/turnos/${encodeURIComponent(id)}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      })
      if (!res.ok) throw await turnosErrorDe(res, 'No pudimos actualizar el turno.')
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No pudimos actualizar el turno.')
    }
  }

  async function handleCrearManual(e: React.FormEvent) {
    e.preventDefault()
    if (!manualOficio || !manualInicio || !manualCliente.trim()) {
      setErrorManual('Servicio, inicio y nombre de cliente son obligatorios.')
      return
    }
    // The same rules the API applies (it is the authority): each problem names its field.
    const nombreCliente = manualCliente.replace(/\s+/gu, ' ').trim()
    if (nombreCliente.length < 2 || nombreCliente.length > 120) {
      setErrorManual('Nombre del cliente: ingresá entre 2 y 120 caracteres.')
      return
    }
    if (manualTelefono.trim() && !normalizarTelefono(manualTelefono).ok) {
      setErrorManual('Teléfono: ingresalo con código de área, por ejemplo 3794 123456.')
      return
    }
    if (manualPrecio.trim() && !/^\d{1,9}$/u.test(manualPrecio.trim())) {
      setErrorManual('Precio final: ingresá un número entero de pesos, sin decimales ni signos.')
      return
    }
    if (manualNotas.trim().length > 500) {
      setErrorManual('Notas: hasta 500 caracteres.')
      return
    }

    setGuardandoManual(true)
    setErrorManual(null)

    try {
      const res = await turnosFetch('/tus/v1/prestador/turnos/manual', {
        method: 'POST',
        body: JSON.stringify({
          oficioId: manualOficio.trim(),
          // The field is Argentina local time; the API stores the instant.
          inicio: new Date(`${manualInicio}:00.000-03:00`).toISOString(),
          clienteNombre: nombreCliente,
          clienteTelefono: manualTelefono.trim() || undefined,
          precioFinal: manualPrecio.trim() ? Number(manualPrecio.trim()) : undefined,
          notas: manualNotas.trim() || undefined,
        }),
      })

      if (!res.ok) throw await turnosErrorDe(res, 'No se pudo crear el turno manual')

      setModalManual(false)
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
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
    if (bloqueoFin <= bloqueoInicio) {
      setErrorBloqueo('Fin: debe ser posterior al inicio.')
      return
    }
    if (bloqueoMotivo.trim().length > 200) {
      setErrorBloqueo('Motivo: hasta 200 caracteres.')
      return
    }

    setGuardandoBloqueo(true)
    setErrorBloqueo(null)

    try {
      const res = await turnosFetch('/tus/v1/prestador/turnos/bloquear', {
        method: 'POST',
        body: JSON.stringify({
          inicio: new Date(`${bloqueoInicio}:00.000-03:00`).toISOString(),
          fin: new Date(`${bloqueoFin}:00.000-03:00`).toISOString(),
          motivo: bloqueoMotivo.trim() || 'Bloqueo manual de horario',
        }),
      })

      if (!res.ok) throw await turnosErrorDe(res, 'No se pudo registrar el bloqueo')

      setModalBloqueo(false)
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    } catch (err: unknown) {
      setErrorBloqueo(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setGuardandoBloqueo(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Solicitudes de reserva: lo que los clientes pidieron y espera la respuesta del prestador */}
      <section aria-labelledby="solicitudes-reserva" className={styles.panel} data-solicitudes>
        <h2 className={styles.panelTitle} id="solicitudes-reserva">
          Solicitudes de reserva{solicitudes.length > 0 ? ` (${solicitudes.length})` : ''}
        </h2>
        {avisoSolicitud ? (
          <p className={styles.notice} role={avisoSolicitud.tipo === 'error' ? 'alert' : 'status'} style={{ marginBottom: 12 }}>
            {avisoSolicitud.texto}
          </p>
        ) : null}
        {solicitudes.length === 0 ? (
          <p className={styles.muted} style={{ margin: 0 }}>
            No tenés solicitudes pendientes. Cuando un cliente pida un turno aparece acá para que la aceptes o la rechaces.
          </p>
        ) : (
          <div className={styles.turnoList}>
            {solicitudes.map((solicitud) => (
              <article className={`${styles.panel} ${styles.turnoCard} ${styles.turnoCardNew}`} data-solicitud={solicitud.id} key={solicitud.id}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <strong>Nueva solicitud</strong>
                  <dl className={styles.turnoData}>
                    <div>
                      <dt>Cliente:</dt>
                      <dd>{solicitud.clienteNombre ?? 'Cliente de TUS'}</dd>
                    </div>
                    <div>
                      <dt>Servicio:</dt>
                      <dd>{[solicitud.oficioNombre, solicitud.tarifaNombre].filter((nombre, indice, lista) => nombre && lista.indexOf(nombre) === indice).join(' · ') || 'Turno'}</dd>
                    </div>
                    {solicitud.precioFinal != null && solicitud.precioFinal > 0 ? (
                      <div>
                        <dt>Precio:</dt>
                        <dd>
                          {formatearPesos(solicitud.precioFinal)}
                          {solicitud.sena ? ` · seña ${formatearPesos(solicitud.sena.monto)} (la abona el cliente cuando aceptes)` : ''}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Fecha:</dt>
                      <dd>{diaTurno(solicitud.inicio)}</dd>
                    </div>
                    <div>
                      <dt>Horario:</dt>
                      <dd>{horaTurno(solicitud.inicio)}</dd>
                    </div>
                    <div>
                      <dt>Duración:</dt>
                      <dd>{solicitud.duracionMinutos} minutos</dd>
                    </div>
                    {solicitud.notas ? (
                      <div>
                        <dt>Nota:</dt>
                        <dd>{solicitud.notas}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <span className={claseEstadoTurno(solicitud.estado)} style={{ justifySelf: 'start' }}>
                    {etiquetaEstadoTurno(solicitud.estado)}
                  </span>
                </div>
                <div className={styles.turnoActions}>
                  <button className={homeStyles.buttonSecondary} disabled={respondiendo === solicitud.id} onClick={() => void responder(solicitud, false)} type="button">
                    Rechazar
                  </button>
                  <button className={homeStyles.buttonPrimary} disabled={respondiendo === solicitud.id} onClick={() => void responder(solicitud, true)} type="button">
                    {respondiendo === solicitud.id ? 'Guardando…' : 'Aceptar'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Disponibilidad semanal (intervalo, días y horarios) y la agenda que ven los clientes */}
      <ProviderAvailability servicios={servicios} version={versionAgenda} />

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
            <option value="pending">Pendientes de respuesta</option>
            <option value="awaiting_payment">Esperando pago de seña</option>
            <option value="confirmed">Confirmados</option>
            <option value="rejected">Rechazados</option>
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
          No tenés turnos registrados con este filtro. Podés agendar uno manualmente o esperar solicitudes de clientes.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {turnos.map((t) => {
            const fecha = new Date(t.inicio).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
            const horaInicio = horaTurno(t.inicio)
            const horaFin = horaTurno(t.fin)

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
                    {t.oficioNombre || t.tarifaNombre || t.oficioId} · {t.duracionMinutos} min · ${PESOS.format(t.precioFinal ?? 0)}
                    {t.sena ? ` · Seña ${formatearPesos(t.sena.monto)}: ${etiquetaSenaTurno(t.sena.estado)}` : ''}
                  </div>
                  {t.notas ? <div style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 4 }}>Nota: {t.notas}</div> : null}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={claseEstadoTurno(t.estado)}>{etiquetaEstadoTurno(t.estado)}</span>

                  {t.estado === 'confirmed' ? (
                    <button
                      type="button"
                      onClick={() => cambiarEstado(t.id, 'completed')}
                      style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #22c55e', background: '#f0fdf4', color: '#15803d', fontSize: '0.85rem', cursor: 'pointer' }}
                    >
                      ✓ Completado
                    </button>
                  ) : null}
                  {t.estado === 'confirmed' || t.estado === 'awaiting_payment' ? (
                    <button
                      type="button"
                      onClick={() => cambiarEstado(t.id, 'cancelled')}
                      style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #ef4444', background: '#fef2f2', color: '#b91c1c', fontSize: '0.85rem', cursor: 'pointer' }}
                    >
                      Cancelar
                    </button>
                  ) : null}
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
                <select className={styles.bookingControl} onChange={(e) => setManualOficio(e.target.value)} required value={manualOficio}>
                  <option value="">Elegí uno de tus servicios</option>
                  {servicios.map((item) => (
                    <option key={item.oficioId} value={item.oficioId}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
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
                  minLength={2}
                  maxLength={120}
                  autoComplete="off"
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Teléfono</label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={manualTelefono}
                  onChange={(e) => setManualTelefono(e.target.value)}
                  placeholder="3794 123456"
                  maxLength={40}
                  autoComplete="off"
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Precio final ($ ARS)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={9}
                  value={manualPrecio}
                  onChange={(e) => setManualPrecio(e.target.value.replace(/\D/gu, ''))}
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
                  maxLength={500}
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
                  maxLength={200}
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
