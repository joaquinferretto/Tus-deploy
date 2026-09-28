'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { createDirectoryClient } from '../directory/directory-client'
import { createProfileClient } from '../profile/profile-client'
import { useAccountView } from '../session/use-account-view'
import { createTusWebAuthClient, toTusWebSession } from '../../lib/tus-auth-client'
import { greeting, HOW_IT_WORKS, respond, SEARCH_PROMPT, type AssistantAction, type AssistantContext, type AssistantReply, type AssistantRole } from './assistant-service'
import type { ServiceSearchOutcome } from './service-search'
import { describeOutcome } from './service-search'
import styles from './home.module.css'

interface Message extends AssistantReply {
  id: number
  from: 'user' | 'tus'
}

// Floating TUS assistant. Closed: a round button (bottom right). Open: a small window that floats
// over the page (the map stays). The widget only renders; assistant-service decides (help,
// navigation, session-aware actions, and the shared service search when the map is on screen).
export function AssistantWidget({
  search,
  chooseCategory,
}: {
  // Given on the home (same search as the search bar). Elsewhere the search opens the home map.
  search?: (text: string) => Promise<ServiceSearchOutcome>
  chooseCategory?: (id: string, zone: string | null) => Promise<ServiceSearchOutcome>
}): React.ReactNode {
  const pathname = usePathname() ?? '/'
  const account = useAccountView()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const nextId = useRef(1)
  const list = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  const role: AssistantRole =
    account.status !== 'signed-in' ? 'guest' : account.capabilities.platformAdmin ? 'admin' : account.capabilities.provider ? 'provider' : 'client'

  // The name comes from the account API (never from local data).
  useEffect(() => {
    if (account.status !== 'signed-in') return
    void createTusWebAuthClient()
      .restore(pathname)
      .then((result) => (result.session ? createProfileClient(toTusWebSession(result.session)).account() : null))
      .then((own) => setName(own?.displayName ?? null))
      .catch(() => setName(null))
  }, [account.status, pathname])

  useEffect(() => {
    if (!open || account.status === 'unknown' || messages.length > 0) return
    setMessages([{ id: nextId.current++, from: 'tus', ...greeting({ role, name, returnTo: pathname }) }])
  }, [open, account.status, role, name, pathname, messages.length])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages, open])

  const push = (message: Omit<Message, 'id'>) => setMessages((current) => [...current, { ...message, id: nextId.current++ }])

  const context: AssistantContext = {
    role,
    name,
    returnTo: pathname,
    ...(search ? { search } : {}),
    help: async (question) => {
      const help = await createDirectoryClient().help(question)
      return help.status === 'answered' && help.answers[0] ? help.answers[0].excerpt : null
    },
    providerStatus: async () => {
      const restored = await createTusWebAuthClient().restore(pathname)
      if (!restored.session) throw new Error('no session')
      const directory = createDirectoryClient()
      const mine = await directory.myProfile(toTusWebSession(restored.session))
      if (!mine.profile) return { profile: null }
      // Published = the public directory serves it (visible AND approved provider).
      const published = await directory.profile(mine.profile.id).then(() => true).catch(() => false)
      return { profile: { id: mine.profile.id, visible: mine.profile.visible, published } }
    },
  }

  async function ask(value: string) {
    push({ from: 'user', text: value })
    setBusy(true)
    try {
      push({ from: 'tus', ...(await respond(value, context)) })
    } catch {
      push({ from: 'tus', text: 'Tuve un problema procesando tu solicitud. Probá nuevamente en unos minutos.' })
    } finally {
      setBusy(false)
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setText('')
    await ask(value)
  }

  function runIntent(action: AssistantAction) {
    if (action.intent === 'how') push({ from: 'tus', ...HOW_IT_WORKS })
    if (action.intent === 'search-prompt') {
      push({ from: 'tus', ...SEARCH_PROMPT })
      input.current?.focus()
    }
  }

  async function choose(id: string, label: string, zone: string | null) {
    if (!chooseCategory) return
    push({ from: 'user', text: label })
    setBusy(true)
    try {
      const outcome = await chooseCategory(id, zone)
      push({ from: 'tus', text: describeOutcome(outcome) })
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
        {messages.length === 0 ? <p className={styles.assistantTyping}>Un momento…</p> : null}
        {messages.map((message) => (
          <div className={message.from === 'user' ? styles.assistantUser : styles.assistantBot} key={message.id}>
            <p>{message.text}</p>
            {message.options && chooseCategory ? (
              <div className={styles.assistantOptions}>
                {message.options.map((option) => (
                  <button disabled={busy} key={option.id} onClick={() => void choose(option.id, option.label, message.zone ?? null)} type="button">
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            {message.actions?.length ? (
              <div className={styles.assistantOptions}>
                {message.actions.map((action) =>
                  action.href ? (
                    <a className={styles.assistantChip} href={action.href} key={action.label}>
                      {action.label}
                    </a>
                  ) : (
                    <button disabled={busy} key={action.label} onClick={() => runIntent(action)} type="button">
                      {action.label}
                    </button>
                  )
                )}
              </div>
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
          placeholder="Escribí tu consulta..."
          ref={input}
          value={text}
        />
        <button disabled={busy || !text.trim()} type="submit">
          Enviar
        </button>
      </form>
    </section>
  )
}
