'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import type { AdjuntoAsistente, MensajeAsistenteDTO } from '@factory/contracts'

import { withReturnTo } from '../auth/auth-validation'
import styles from './assistant.module.css'
import { activityLabel, type AssistantState } from './use-assistant'

const ZONA_HORARIA = 'America/Argentina/Buenos_Aires'

// Shortcuts of the empty conversation. They are only a faster way to type: each one sends its
// text to the assistant exactly like a written message.
const SUGGESTIONS = ['Necesito un plomero', 'Quiero sacar un turno', '¿Cómo funciona TUS?', '¿Cómo funciona la protección TUS?']

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_HORARIA })
const dia = (date: string) => new Date(`${date}T12:00:00-03:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA_HORARIA })
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA_HORARIA })
const diaCorto = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: ZONA_HORARIA })
const precio = (value: number) => value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

// Conversation with the TUS assistant (full page and floating window share it). It renders what
// the API returns: the text written by the model and, next to it, the real data the backend
// attached (providers, slots, sources). It never decides an answer.
export function AssistantConversation({ assistant, compact = false }: { assistant: AssistantState; compact?: boolean }): React.ReactNode {
  const pathname = usePathname() ?? '/'
  const [text, setText] = useState('')
  const end = useRef<HTMLLIElement>(null)
  const { messages, busy } = assistant
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')?.id

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, busy, assistant.activity, assistant.error])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!text.trim() || busy) return
    assistant.send(text)
    setText('')
  }

  const attachment = (message: MensajeAsistenteDTO, value: AdjuntoAsistente) => {
    // Only the newest reply is actionable: older cards stay as a record of the conversation.
    const active = message.id === lastAssistant && !busy
    if (value.kind === 'providers')
      return (
        <ul className={styles.cards}>
          {value.providers.map((provider, index) => (
            <li className={styles.card} key={provider.providerId}>
              <div className={styles.cardHead}>
                <strong>
                  {index + 1}. {provider.name}
                </strong>
                {provider.verified ? <span className={styles.badgeOk}>Identidad verificada</span> : null}
              </div>
              <p className={styles.cardMeta}>
                {provider.profession} · {provider.area}
              </p>
              <p className={styles.cardMeta}>
                {provider.completedJobs > 0 ? `${provider.completedJobs} ${provider.completedJobs === 1 ? 'trabajo completado' : 'trabajos completados'} · ` : ''}
                Horarios publicados: {provider.availability}
              </p>
              <div className={styles.cardActions}>
                <button className={styles.buttonPrimary} disabled={!active} onClick={() => assistant.send(`Quiero ver los turnos de ${provider.name}`)} type="button">
                  Ver turnos
                </button>
                <button className={styles.buttonSecondary} disabled={!active} onClick={() => assistant.send(`Quiero continuar con ${provider.name}`)} type="button">
                  Elegir
                </button>
                <Link className={styles.buttonSecondary} href={`/trabajadores/${encodeURIComponent(provider.providerId)}` as Route}>
                  Ver perfil
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )
    // Real free turnos for what the person asked. The times are shortcuts: writing "el segundo",
    // a name or a time does the same.
    if (value.kind === 'appointments')
      return (
        <ul className={styles.cards}>
          {value.providers.map((provider, index) => (
            <li className={styles.card} key={provider.providerId}>
              <div className={styles.cardHead}>
                <strong>
                  {index + 1}. {provider.name}
                </strong>
                {provider.verified ? <span className={styles.badgeOk}>Identidad verificada</span> : null}
              </div>
              <p className={styles.cardMeta}>
                {provider.area}
                {provider.durationMinutes ? ` · turnos de ${provider.durationMinutes} min` : ''}
                {provider.exact ? '' : ' · horarios más cercanos'}
              </p>
              <div className={styles.slots}>
                {provider.starts.map((startsAt) => (
                  <button className={styles.slot} disabled={!active} key={startsAt} onClick={() => assistant.send(`Quiero reservar con ${provider.name} el ${diaDe(startsAt)} a las ${hora(startsAt)}`)} type="button">
                    {hora(startsAt)}
                    <small>{diaCorto(startsAt)}</small>
                  </button>
                ))}
              </div>
              <div className={styles.cardActions}>
                <Link className={styles.buttonSecondary} href={`/trabajadores/${encodeURIComponent(provider.providerId)}` as Route}>
                  Ver perfil
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )
    if (value.kind === 'slots')
      return (
        <div className={styles.card}>
          <strong className={styles.slotsTitle}>Turnos del {dia(value.date)}</strong>
          <div className={styles.slots}>
            {value.slots.map((slot) => (
              <button className={styles.slot} disabled={!active} key={slot.startsAt} onClick={() => assistant.send(`Quiero reservar el turno del ${dia(value.date)} a las ${hora(slot.startsAt)}`)} type="button">
                {hora(slot.startsAt)}
                <small>{slot.durationMinutes} min</small>
              </button>
            ))}
          </div>
          {value.tariffs.length > 0 ? (
            <ul className={styles.tariffs}>
              {value.tariffs.map((tariff) => (
                <li key={tariff.id}>
                  {tariff.name} · {tariff.durationMinutes} min · {precio(tariff.price)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )
    if (value.kind === 'sources')
      return (
        <p className={styles.sources}>
          Fuente: {value.sources.map((source) => source.title).join(' · ')}
        </p>
      )
    return (
      <div className={styles.cardActions}>
        <Link className={styles.buttonPrimary} href={withReturnTo('/sign-in', pathname) as Route}>
          Iniciar sesión
        </Link>
        <Link className={styles.buttonSecondary} href={withReturnTo('/registro', pathname) as Route}>
          Crear cuenta
        </Link>
      </div>
    )
  }

  return (
    <div className={`${styles.conversation} ${compact ? styles.compact : ''}`}>
      <ol aria-live="polite" className={styles.messages}>
        {assistant.status === 'ready' && messages.length === 0 ? (
          <li className={styles.empty}>
            <p>Soy el asistente de TUS. Escribime con tus palabras qué necesitás: buscar un profesional, sacar un turno o entender cómo funciona TUS.</p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((suggestion) => (
                <button className={styles.chip} disabled={busy} key={suggestion} onClick={() => assistant.send(suggestion)} type="button">
                  {suggestion}
                </button>
              ))}
            </div>
          </li>
        ) : null}
        {assistant.status === 'loading' ? (
          <li className={styles.status} role="status">
            Cargando la conversación…
          </li>
        ) : null}
        {messages.map((message) => (
          <li className={message.role === 'user' ? styles.rowUser : styles.rowAssistant} key={message.id}>
            <div className={`${styles.bubble} ${message.role === 'user' ? styles.fromUser : styles.fromAssistant} ${message.fallback ? styles.fallback : ''}`}>
              <span className={styles.srOnly}>{message.role === 'user' ? 'Vos: ' : 'Asistente: '}</span>
              {message.text}
            </div>
            {message.attachment ? attachment(message, message.attachment) : null}
            {message.actions?.length ? (
              <div className={styles.cardActions}>
                {message.actions.map((action) =>
                  action.kind === 'link' ? (
                    <a className={styles.buttonPrimary} href={action.url} key={action.url} rel="noopener noreferrer" target="_blank">
                      {action.label}
                    </a>
                  ) : (
                    <button
                      className={action.id.startsWith('confirm:') ? styles.buttonPrimary : styles.buttonSecondary}
                      disabled={busy || message.id !== lastAssistant}
                      key={action.id}
                      onClick={() => assistant.reply(action.id)}
                      type="button"
                    >
                      {action.label}
                    </button>
                  )
                )}
              </div>
            ) : null}
          </li>
        ))}
        {busy ? (
          <li aria-busy="true" className={styles.status} role="status">
            <span aria-hidden="true" className={styles.dots}>
              <i />
              <i />
              <i />
            </span>
            {activityLabel(assistant.activity)}
          </li>
        ) : null}
        {assistant.error ? (
          <li className={styles.error} role="alert">
            {assistant.error}
          </li>
        ) : null}
        <li aria-hidden="true" ref={end} />
      </ol>

      <form className={styles.composer} onSubmit={submit}>
        <label className={styles.srOnly} htmlFor={compact ? 'asistente-mensaje-flotante' : 'asistente-mensaje'}>
          Mensaje para el asistente
        </label>
        <textarea
          id={compact ? 'asistente-mensaje-flotante' : 'asistente-mensaje'}
          maxLength={1000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event)
          }}
          placeholder="Escribí tu consulta…"
          rows={1}
          value={text}
        />
        <button className={styles.buttonPrimary} disabled={busy || !text.trim()} type="submit">
          Enviar
        </button>
      </form>
    </div>
  )
}
