'use client'

import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { AssistantConversation } from '../assistant/assistant-conversation'
import { useAssistant } from '../assistant/use-assistant'
import { useAccountView } from '../session/use-account-view'
import styles from './home.module.css'

// Floating TUS assistant. Closed: a round button (bottom right). Open: a small window over the
// page. It is the same conversation as /asistente: the API decides (shared orchestrator with
// WhatsApp); the widget only renders.
export function AssistantWidget(): React.ReactNode {
  const pathname = usePathname() ?? '/'
  const account = useAccountView()
  const [open, setOpen] = useState(false)
  // The conversation is loaded when the window is first opened, not on every page view.
  const assistant = useAssistant(open && account.status !== 'unknown', account.status)

  // The assistant page already is the conversation.
  if (pathname === '/asistente') return null

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
      <AssistantConversation assistant={assistant} compact />
    </section>
  )
}
