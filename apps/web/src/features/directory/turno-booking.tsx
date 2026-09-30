'use client'

import { useState, useEffect } from 'react'
import type { PerfilPrestadorPublico, SlotDisponible, TarifaServicioPublica, DetalleTurno } from '@factory/contracts'
import homeStyles from '../home/home.module.css'
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
  const [fecha, setFecha] = useState<string>(() => {
    const d = new Date()
    return d.toISOString().slice(0, 10)
  })
  const [tarifas, setTarifas] = useState<TarifaServicioPublica[]>([])
  const [selectedTarifaId, setSelectedTarifaId] = useState<string>('')
  const [slots, setSlots] = useState<SlotDisponible[]>([])
  const [selectedSlot, setSelectedSlot] = useState<SlotDisponible | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotMessage, setSlotMessage] = useState<string | null>(null)

  // Datos de contacto
  const [clienteNombre, setClienteNombre] = useState(authenticatedName ?? '')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [notas, setNotas] = useState('')

  // Estado de reserva
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [confirmedTurno, setConfirmedTurno] = useState<DetalleTurno | null>(null)

  // Cargar disponibilidad y tarifas cuando cambia fecha u oficio
  useEffect(() => {
    let active = true
    setLoadingSlots(true)
    setErrorMsg(null)
    setSelectedSlot(null)

    const params = new URLSearchParams({
      oficioId: selectedOficio,
      fecha,
    })

    fetch(`/tus/v1/public/prestadores/${encodeURIComponent(worker.id)}/turnos/disponibilidad?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'No se pudo consultar la disponibilidad')
        }
        return res.json()
      })
      .then((data) => {
        if (!active) return
        setSlots(data.slots || [])
        setTarifas(data.tarifas || [])
        if (data.tarifas && data.tarifas.length > 0) {
          setSelectedTarifaId((prev) => prev || data.tarifas[0].id)
        }
        setSlotMessage(data.mensaje || null)
        setLoadingSlots(false)
      })
      .catch((err) => {
        if (!active) return
        setSlots([])
        setSlotMessage(err.message)
        setLoadingSlots(false)
      })

    return () => {
      active = false
    }
  }, [worker.id, selectedOficio, fecha])

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
      const res = await fetch(`/tus/v1/public/prestadores/${encodeURIComponent(worker.id)}/turnos/reservar`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': `turno-${Date.now()}`,
        },
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

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo confirmar el turno. Probá con otro horario.')
      }

      setConfirmedTurno(data)
      onConfirmed?.(data)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error inesperado al reservar el turno')
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
    const horaFormateada = inicioDate.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    })

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
              onChange={(e) => setSelectedOficio(e.target.value)}
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
                  onClick={() => setSelectedTarifaId(t.id)}
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

        {/* Selector de fecha */}
        <div>
          <label htmlFor="turno-fecha" style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
            Fecha
          </label>
          <input
            id="turno-fecha"
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className={styles.bookingControl}
            style={{ maxWidth: 240 }}
          />
        </div>

        {/* Grilla de horarios disponibles */}
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
            Horario disponible
          </label>
          {loadingSlots ? (
            <p className={styles.muted}>Consultando disponibilidad en agenda...</p>
          ) : slotMessage ? (
            <p className={styles.muted} style={{ color: '#b45309' }}>{slotMessage}</p>
          ) : slots.length === 0 ? (
            <p className={styles.muted}>No hay turnos disponibles para esta fecha. Elegí otro día.</p>
          ) : (
            <div className={styles.slotGrid}>
              {slots.map((slot) => {
                const hora = new Date(slot.inicio).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
                const isSelected = selectedSlot?.inicio === slot.inicio
                return (
                  <button
                    key={slot.inicio}
                    type="button"
                    onClick={() => setSelectedSlot(slot)}
                    className={`${styles.slotBtn} ${isSelected ? styles.slotBtnActive : ''}`}
                  >
                    {hora}
                  </button>
                )
              })}
            </div>
          )}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div>
            {selectedSlot ? (
              <span style={{ fontSize: '0.95rem' }}>
                Seleccionado: <strong>{new Date(selectedSlot.inicio).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs</strong>
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
