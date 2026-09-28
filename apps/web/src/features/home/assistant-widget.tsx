'use client'

import { useEffect, useRef, useState } from 'react'

import { createDirectoryClient } from '../directory/directory-client'
import type { ServiceSearchOutcome } from './service-search'
import { describeOutcome } from './service-search'
import styles from './home.module.css'

interface Message {
  id: number
  from: 'user' | 'tus'
  text: string
  options?: { id: string; label: string }[]
  zone?: string | null
  publish?: boolean
}

// Floating TUS assistant on the home. Closed: a round button (bottom right). Open: a small window
// over the map (the map stays). It searches with the SAME function as the search bar (the home
// passes `search`) so the map updates with each answer; questions that are not a service go to the
// public help (TUS knowledge). It only mentions providers that the directory returned.
export function AssistantWidget({
  search,
  chooseCategory,
}: {
  search: (text: string) => Promise<ServiceSearchOutcome>
  chooseCategory: (id: string, zone: string | null) => Promise<ServiceSearchOutcome>
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: 'tus', text: 'Hola, soy el asistente de TUS. Contame qué necesitás y te muestro profesionales en el mapa.' },
  ])
  const nextId = useRef(1)
  const list = useRef<HTMLDivElement | null>(null)

  const push = (message: Omit<Message, 'id'>) => setMessages((current) => [...current, { ...message, id: nextId.current++ }])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages, open])

  function reply(outcome: ServiceSearchOutcome) {
    push({
      from: 'tus',
      text: describeOutcome(outcome),
      ...(outcome.kind === 'choose' ? { options: outcome.options, zone: outcome.zone } : {}),
      publish: (outcome.kind === 'category' || outcome.kind === 'text') && outcome.providers.length === 0,
    })
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setText('')
    push({ from: 'user', text: value })
    setBusy(true)
    try {
      const outcome = await search(value)
      if (outcome.kind === 'text' && outcome.providers.length === 0) {
        // Not a service we recognise: maybe a question about TUS (public knowledge only).
        const help = await createDirectoryClient().help(value).catch(() => null)
        if (help?.status === 'answered' && help.answers[0]) push({ from: 'tus', text: help.answers[0].excerpt })
        else reply(outcome)
      } else reply(outcome)
    } catch {
      push({ from: 'tus', text: 'Tuve un problema procesando tu solicitud. Probá nuevamente en unos minutos.' })
    } finally {
      setBusy(false)
    }
  }

  async function choose(id: string, label: string, zone: string | null) {
    push({ from: 'user', text: label })
    setBusy(true)
    try {
      reply(await chooseCategory(id, zone))
    } catch {
      push({ from: 'tus', text: 'Tuve un problema procesando tu solicitud. Probá nuevamente en unos minutos.' })
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button aria-label="Abrir el asistente de TUS" className={styles.assistantFab} onClick={() => setOpen(true)} type="button">
        <svg aria-hidden="true" fill="none" height="26" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="26">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
        </svg>
      </button>
    )

  return (
    <section aria-label="Asistente de TUS" className={styles.assistantPanel} role="dialog">
      <header className={styles.assistantHeader}>
        <div>
          <strong>TUS</strong>
          <span>Tu asistente</span>
        </div>
        <button aria-label="Cerrar el asistente" className={styles.assistantClose} onClick={() => setOpen(false)} type="button">
          ×
        </button>
      </header>
      <div aria-live="polite" className={styles.assistantMessages} ref={list}>
        {messages.map((message) => (
          <div className={message.from === 'user' ? styles.assistantUser : styles.assistantBot} key={message.id}>
            <p>{message.text}</p>
            {message.options ? (
              <div className={styles.assistantOptions}>
                {message.options.map((option) => (
                  <button disabled={busy} key={option.id} onClick={() => void choose(option.id, option.label, message.zone ?? null)} type="button">
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            {message.publish ? (
              <a className={styles.assistantLink} href="/publicar">
                Publicar solicitud
              </a>
            ) : null}
          </div>
        ))}
        {busy ? <p className={styles.assistantTyping}>Buscando…</p> : null}
      </div>
      <form className={styles.assistantForm} onSubmit={(event) => void send(event)}>
        <label className={styles.srOnly} htmlFor="asistente-mensaje">
          Mensaje para el asistente
        </label>
        <input
          autoComplete="off"
          id="asistente-mensaje"
          maxLength={300}
          onChange={(event) => setText(event.target.value)}
          placeholder="Escribí lo que necesitás"
          value={text}
        />
        <button disabled={busy || !text.trim()} type="submit">
          Enviar
        </button>
      </form>
    </section>
  )
}
