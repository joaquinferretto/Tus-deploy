'use client'

import { useEffect, useState } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  type TusCalendarBooking,
  type TusCalendarSlot,
} from '@/lib/tus-client'
import {
  construirIntencionReserva,
  mensajeErrorCalendario,
  parseTusCalendarBookingResponse,
  type TusReservaIntent,
} from '@/lib/tus-calendar'
import { sessionRequestContext, type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

export function CalendarioCliente({
  calendarId,
  serviceId,
  onReservaConfirmada,
}: {
  calendarId: string
  serviceId: string
  onReservaConfirmada?: (slot: TusCalendarSlot, reserva: TusCalendarBooking) => void
}): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restaurando tu sesión segura.')
  const [authStatus, setAuthStatus] = useState('restoring')
  const [date, setDate] = useState('')
  const [slotState, setSlotState] = useState<SlotState>({ status: 'idle', slots: [] })
  const [selectedSlotId, setSelectedSlotId] = useState<string | undefined>(undefined)
  const [bookingIntent, setBookingIntent] = useState<TusReservaIntent | null>(null)
  const [bookingState, setBookingState] = useState<BookingState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => {
        if (cancelled) return
        setAuthStatus(result.status)
        setAuthMessage(result.message)
        setSession(result.session === undefined ? null : toTusWebSession(result.session))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (session === undefined) {
    return <TusStateMessage state={{ status: 'loading', message: 'Restaurando tu sesión segura…' }} />
  }
  if (session === null) {
    return (
      <TusStateMessage
        state={{
          status: authStatus === 'unavailable' ? 'error' : 'disabled',
          message: authMessage,
        }}
      >
        <p>Necesitás una sesión autenticada para consultar y reservar horarios.</p>
        <a className="tus-action-button tus-action-link" href={`/sign-in?returnTo=${encodeURIComponent(window.location.pathname)}`}>
          Ingresar a TUS
        </a>
      </TusStateMessage>
    )
  }
  const sessionActual = session

  const selectedSlot = slotState.slots.find((slot) => slot.slotId === selectedSlotId)

  async function consultarDisponibilidad(): Promise<void> {
    if (date.length === 0) return
    setSelectedSlotId(undefined)
    setBookingState({ status: 'idle' })
    setSlotState({ status: 'loading', slots: [] })
    try {
      const response = await createTusWebClient(createTusWebFetchTransport()).calendarSlots(
        sessionRequestContext(sessionActual),
        calendarId,
        date,
        new Date().toISOString()
      )
      setSlotState({
        status: response.slots.length === 0 ? 'empty' : 'ready',
        slots: [...response.slots],
      })
    } catch (error: unknown) {
      setSlotState({ status: 'error', slots: [], code: codeOf(error) })
    }
  }

  async function reservarHorario(): Promise<void> {
    if (selectedSlot === undefined) return
    const intent =
      bookingIntent ??
      construirIntencionReserva(
        calendarId,
        serviceId,
        selectedSlot,
        window.crypto.randomUUID(),
        new Date().toISOString()
      )
    setBookingIntent(intent)
    setBookingState({ status: 'loading' })
    try {
      const response = await createTusWebClient(createTusWebFetchTransport()).calendarBooking({
        ...sessionRequestContext(sessionActual),
        calendarId,
        serviceId,
        customerId: sessionActual.actorId,
        slotId: selectedSlot.slotId,
        ...intent,
      })
      const result = parseTusCalendarBookingResponse(response)
      if (result.status === 'rejected') {
        setBookingState({ status: 'conflict', message: 'La capacidad de esta franja ya fue ocupada.' })
      } else if (result.status === 'error') {
        setBookingState({ status: 'error', message: mensajeErrorCalendario(result.reason) })
      } else {
        const reserva = result.status === 'replay' ? result.booking : result
        setBookingState({ status: 'confirmed', reserva })
        onReservaConfirmada?.(selectedSlot, reserva)
      }
    } catch (error: unknown) {
      const code = codeOf(error)
      setBookingState({
        status: statusOf(error) === 409 ? 'conflict' : 'error',
        message: mensajeErrorCalendario(code),
      })
    }
  }

  return (
    <section className="tus-state-box tus-calendar-panel" aria-labelledby="calendario-title">
      <div className="tus-section-label">
        <span>01</span>
        <h2 id="calendario-title">Elegí un horario</h2>
      </div>
      <p>
        Las franjas y la zona horaria vienen del calendario del prestador. TUS vuelve a comprobar la
        disponibilidad antes de confirmar la reserva.
      </p>
      <div className="tus-calendar-controls">
        <label htmlFor="calendar-date">
          Fecha
          <input
            id="calendar-date"
            name="calendarDate"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              setSlotState({ status: 'idle', slots: [] })
              setSelectedSlotId(undefined)
              setBookingIntent(null)
              setBookingState({ status: 'idle' })
            }}
          />
        </label>
        <TusActionButton disabled={date.length === 0} loading={slotState.status === 'loading'} onClick={() => void consultarDisponibilidad()} type="button">
          Consultar horarios
        </TusActionButton>
      </div>
      {slotState.status === 'error' ? (
        <TusStateMessage
          state={{
            status: 'error',
            message: mensajeErrorCalendario(slotState.code),
            code: slotState.code,
            retry: () => void consultarDisponibilidad(),
          }}
        />
      ) : slotState.status === 'empty' ? (
        <TusStateMessage state={{ status: 'empty', message: 'No hay franjas disponibles para esta fecha.' }} />
      ) : slotState.status === 'loading' ? (
        <TusStateMessage state={{ status: 'loading', message: 'Consultando disponibilidad real…' }} />
      ) : slotState.status === 'idle' ? (
        <TusStateMessage state={{ status: 'pending', message: 'Elegí una fecha para consultar el calendario.' }} />
      ) : (
        <div className="tus-calendar-slots" role="radiogroup" aria-label="Franjas disponibles">
          {slotState.slots.map((slot) => (
            <label className="tus-calendar-slot" data-selected={slot.slotId === selectedSlotId} key={slot.slotId}>
              <input
                checked={slot.slotId === selectedSlotId}
                name="calendarSlot"
                onChange={() => setSelectedSlotId(slot.slotId)}
                type="radio"
                value={slot.slotId}
              />
              <span>
                <strong>{formatearFranja(slot)}</strong>
                <small>{slot.capacity} lugares disponibles</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {bookingState.status === 'confirmed' ? (
        <TusStateMessage state={{ status: 'ready', message: `Reserva confirmada: ${bookingState.reserva.bookingId}.` }} />
      ) : bookingState.status === 'loading' ? (
        <TusStateMessage state={{ status: 'loading', message: 'Confirmando la reserva con TUS…' }} />
      ) : bookingState.status === 'conflict' ? (
        <TusStateMessage state={{ status: 'conflict', message: bookingState.message ?? 'La franja ya no está disponible.' }} />
      ) : bookingState.status === 'error' ? (
        <TusStateMessage state={{ status: 'error', message: bookingState.message ?? 'La reserva no fue confirmada.' }} />
      ) : null}
      <TusActionButton disabled={selectedSlot === undefined || bookingState.status === 'loading' || bookingState.status === 'confirmed'} onClick={() => void reservarHorario()} type="button">
        Confirmar reserva
      </TusActionButton>
    </section>
  )
}

interface SlotState {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  slots: TusCalendarSlot[]
  code?: string
}

type BookingState =
  | { status: 'idle' | 'loading' }
  | { status: 'confirmed'; reserva: TusCalendarBooking }
  | { status: 'conflict' | 'error'; message?: string }

function formatearFranja(slot: TusCalendarSlot): string {
  try {
    const formatter = new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: slot.timezone,
    })
    return `${formatter.format(new Date(slot.start))} a ${new Intl.DateTimeFormat('es-AR', {
      timeStyle: 'short',
      timeZone: slot.timezone,
    }).format(new Date(slot.end))} (${slot.timezone})`
  } catch {
    return `${slot.start} a ${slot.end} (${slot.timezone})`
  }
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

const calendarioClienteModule = { CalendarioCliente }

export default calendarioClienteModule
