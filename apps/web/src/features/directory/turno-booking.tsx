'use client'

import { useState } from 'react'
import type { FranjaAgenda, PerfilPrestadorPublico, TarifaServicioPublica, DetalleTurno } from '@factory/contracts'
import { CODIGO_HORARIO_NO_DISPONIBLE, CODIGO_HORARIO_OCUPADO } from '@factory/contracts'
import homeStyles from '../home/home.module.css'
import { AgendaSemanal } from '../turnos/agenda-semanal'
import { TurnosError, fechaTurno, horaTurno, turnosErrorDe, turnosFetch } from '../../lib/tus-turnos-client'
import styles from './directory.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function TurnoBooking({
  worker,
  authenticatedName,
  onConfirmed,
}: {
  worker: PerfilPrestadorPublico
  authenticatedName?: string
  onConfirmed?: (turno: DetalleTurno) => void
}): React.ReactNode {
  const [selectedOficio, setSelectedOficio] = useState<string>(worker.profession.id)
  // Bumped to ask the API for the agenda again (after someone else took the time).
  const [refresh, setRefresh] = useState(0)
  const [tarifas, setTarifas] = useState<TarifaServicioPublica[]>([])
  // The tarifa the client picked; without a pick the first one applies (API and Web alike).
  const [tarifaElegida, setTarifaElegida] = useState<string>('')
  const selectedTarifaId = tarifaElegida || tarifas[0]?.id || ''
  const [duracion, setDuracion] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState<FranjaAgenda | null>(null)

  // Datos de contacto
  const [clienteNombre, setClienteNombre] = useState(authenticatedName ?? '')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [notas, setNotas] = useState('')

  // Estado de reserva
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [confirmedTurno, setConfirmedTurno] = useState<DetalleTurno | null>(null)

  // The service or the tarifa (its duration) changed: the chosen time belongs to another agenda.
  function cambiarServicio(oficioId: string) {
    setSelectedOficio(oficioId)
    setTarifaElegida('')
    setTarifas([])
    setSelectedSlot(null)
    setErrorMsg(null)
  }

  function cambiarTarifa(tarifaId: string) {
    setTarifaElegida(tarifaId)
    setSelectedSlot(null)
    setErrorMsg(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSlot) {
      setErrorMsg('Por favor seleccioná un horario disponible.')
      return
    }
    if (!clienteNombre.trim()) {
      setErrorMsg('Por favor ingresá tu nombre.')
      return
    }

    setSubmitting(true)
    setErrorMsg(null)

    try {
      const res = await turnosFetch(`/tus/v1/public/prestadores/${encodeURIComponent(worker.id)}/turnos/reservar`, {
        method: 'POST',
        body: JSON.stringify({
          oficioId: selectedOficio,
          tarifaId: selectedTarifaId || undefined,
          inicio: selectedSlot.inicio,
          clienteNombre: clienteNombre.trim(),
          clienteTelefono: clienteTelefono.trim() || undefined,
          clienteEmail: clienteEmail.trim() || undefined,
          notas: notas.trim() || undefined,
        }),
      })

      if (!res.ok) throw await turnosErrorDe(res, 'No se pudo confirmar el turno. Probá con otro horario.')
      const data = (await res.json()) as DetalleTurno

      setConfirmedTurno(data)
      onConfirmed?.(data)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error inesperado al reservar el turno')
      // Someone took the slot (409): show the real availability again so another one is chosen.
      if (err instanceof TurnosError && (err.code === CODIGO_HORARIO_OCUPADO || err.code === CODIGO_HORARIO_NO_DISPONIBLE)) setRefresh((value) => value + 1)
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmedTurno) {
    const inicioDate = new Date(confirmedTurno.inicio)
    const fechaFormateada = inicioDate.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    const horaFormateada = horaTurno(confirmedTurno.inicio)

    return (
      <section aria-labelledby="turno-confirmado" className={styles.panel} style={{ marginTop: 24, border: '2px solid #22c55e' }}>
        <h2 className={styles.panelTitle} id="turno-confirmado" style={{ color: '#15803d' }}>
          ✓ ¡Turno Confirmado!
        </h2>
        <div style={{ display: 'grid', gap: 12, lineHeight: 1.6 }}>
          <p style={{ margin: 0, fontSize: '1.05rem' }}>
            Tu turno con <strong>{worker.displayName}</strong> quedó agendado.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li><strong>Fecha:</strong> {fechaFormateada}</li>
            <li><strong>Horario:</strong> {horaFormateada} hs ({confirmedTurno.duracionMinutos} min)</li>
            {confirmedTurno.tarifaNombre ? <li><strong>Servicio:</strong> {confirmedTurno.tarifaNombre}</li> : null}
            {confirmedTurno.precioFinal != null ? (
              <li><strong>Precio:</strong> ${PESOS.format(confirmedTurno.precioFinal)} (fijado históricamente)</li>
            ) : null}
            <li><strong>A nombre de:</strong> {confirmedTurno.clienteNombre}</li>
          </ul>
          <p className={styles.muted} style={{ fontSize: '0.9rem', margin: 0 }}>
            El profesional te esperará en el horario coordinado. Ante cualquier cambio, podés contactarlo a través de la plataforma.
          </p>
        </div>
      </section>
    )
  }

  const selectedTarifa = tarifas.find((t) => t.id === selectedTarifaId)

  return (
    <section aria-labelledby="reservar-turno" className={styles.panel} style={{ marginTop: 24 }}>
      <h2 className={styles.panelTitle} id="reservar-turno">
        Reservar turno con {worker.displayName}
      </h2>

      <form onSubmit={handleSubmit} className={styles.bookingForm}>
        {/* Selector de servicio / oficio si tiene varios */}
        {(worker.professions?.length ?? 0) > 1 && (
          <div>
            <label htmlFor="turno-oficio" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
              Servicio
            </label>
            <select
              id="turno-oficio"
              value={selectedOficio}
              onChange={(e) => cambiarServicio(e.target.value)}
              className={styles.bookingControl}
            >
              {worker.professions?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Variantes de Tarifas y Duración */}
        {tarifas.length > 0 && (
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
              Tarifa / Duración
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tarifas.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selectedTarifaId === t.id}
                  onClick={() => cambiarTarifa(t.id)}
                  className={`${styles.tarifaCard} ${selectedTarifaId === t.id ? styles.tarifaCardActive : ''}`}
                >
                  <div style={{ fontWeight: 600 }}>{t.nombre}</div>
                  <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                    {t.duracionMinutos} min · ${PESOS.format(t.precio)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agenda semanal: every time and its state come from the API, for the real duration of
            the chosen service. The Web never builds a time on its own. */}
        <div aria-labelledby="turno-agenda-titulo" role="group">
          <p id="turno-agenda-titulo" style={{ fontWeight: 600, margin: '0 0 6px' }}>
            Elegí día y horario{duracion > 0 ? <span className={styles.muted} style={{ fontWeight: 400 }}>{` · turnos de ${duracion} min`}</span> : null}
          </p>
          <AgendaSemanal
            onAgenda={(agenda) => {
              setTarifas(agenda.tarifas)
              setDuracion(agenda.duracionMinutos)
            }}
            onSeleccion={(franja) => {
              setSelectedSlot(franja)
              if (franja) setErrorMsg(null)
            }}
            origen={{ tipo: 'publica', prestadorId: worker.id, oficioId: selectedOficio, ...(tarifaElegida ? { tarifaId: tarifaElegida } : {}) }}
            seleccion={selectedSlot?.inicio ?? null}
            version={refresh}
          />
        </div>

        {/* Datos de contacto */}
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          <div>
            <label htmlFor="turno-nombre" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
              Tu nombre y apellido *
            </label>
            <input
              id="turno-nombre"
              type="text"
              required
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
              placeholder="Ej. Juan Pérez"
              className={styles.bookingControl}
            />
          </div>

          <div className={styles.bookingRow2}>
            <div>
              <label htmlFor="turno-tel" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                Teléfono
              </label>
              <input
                id="turno-tel"
                type="tel"
                value={clienteTelefono}
                onChange={(e) => setClienteTelefono(e.target.value)}
                placeholder="Ej. 3794 123456"
                className={styles.bookingControl}
              />
            </div>
            <div>
              <label htmlFor="turno-email" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
                Email
              </label>
              <input
                id="turno-email"
                type="email"
                value={clienteEmail}
                onChange={(e) => setClienteEmail(e.target.value)}
                placeholder="tu@email.com"
                className={styles.bookingControl}
              />
            </div>
          </div>

          <div>
            <label htmlFor="turno-notas" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
              Notas adicionales (opcional)
            </label>
            <textarea
              id="turno-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Detalle o consulta sobre la atención..."
              className={styles.bookingControl}
              style={{ minHeight: 80, resize: 'vertical' }}
            />
          </div>
        </div>

        {errorMsg && (
          <div role="alert" style={{ color: '#dc2626', background: '#fee2e2', padding: '8px 12px', borderRadius: 'var(--tus-control-radius)' }}>
            {errorMsg}
          </div>
        )}

        {/* Resumen y botón de confirmación */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div aria-live="polite">
            {selectedSlot ? (
              <span data-turno-elegido style={{ fontSize: '0.95rem' }}>
                Elegiste: <strong>{fechaTurno(selectedSlot.inicio)}, {horaTurno(selectedSlot.inicio)} hs</strong>
                {selectedTarifa ? ` · $${PESOS.format(selectedTarifa.precio)}` : ''}
              </span>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={submitting || !selectedSlot}
            className={homeStyles.buttonPrimary}
            style={{ opacity: submitting || !selectedSlot ? 0.6 : 1 }}
          >
            {submitting ? 'Confirmando...' : 'Confirmar reserva'}
          </button>
        </div>
      </form>
    </section>
  )
}
