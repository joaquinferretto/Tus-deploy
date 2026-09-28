'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { createTusWebClient, createTusWebFetchTransport, type TusWhatsappAdminConversation, type TusWhatsappAdminDetail } from '@/lib/tus-client'
import { formatFecha } from '@/lib/tus-admin-api'
import type { TusWebSession } from '@/lib/tus-ui-contract'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import styles from './admin.module.css'

// WhatsApp inbox: conversation list + selected chat. Same API and restrictions as before: numbers
// stay masked, a person can only reply after taking the conversation and while Meta's 24 h service
// window is open.
const client = () => createTusWebClient(createTusWebFetchTransport())

function contactName(item: { contact: TusWhatsappAdminConversation['contact'] }) {
  return item.contact.displayName || item.contact.waIdMasked || 'Contacto sin nombre'
}

export function AdminWhatsapp(): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null>(null)
  const [items, setItems] = useState<readonly TusWhatsappAdminConversation[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TusWhatsappAdminDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'human'>('todas')

  useEffect(() => {
    void createTusWebAuthClient().restore(window.location.pathname).then((result) => setSession(result.session ? toTusWebSession(result.session) : null))
  }, [])

  const loadList = useCallback(async (current: TusWebSession) => {
    try {
      const result = await client().listWhatsappAdminConversations(current, filtro === 'human' ? 'human' : undefined)
      setItems(result.conversations)
      setError('')
    } catch {
      setItems([])
      setError('No pudimos cargar las conversaciones de WhatsApp. Si el módulo no está activo en el servidor, esta sección queda vacía.')
    }
  }, [filtro])

  useEffect(() => {
    if (session) void loadList(session)
  }, [session, loadList])

  const loadDetail = useCallback(async (current: TusWebSession, id: string) => {
    setLoadingDetail(true)
    try {
      setDetail(await client().getWhatsappAdminConversation(current, id))
    } catch {
      setDetail(null)
      setError('No pudimos abrir esa conversación.')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    if (session && selectedId) void loadDetail(session, selectedId)
    else setDetail(null)
  }, [session, selectedId, loadDetail])

  async function act(action: 'takeover' | 'release' | 'reply', body: Record<string, unknown> = {}) {
    if (!session || !detail || busy) return
    setBusy(true)
    try {
      await client().whatsappAdminAction(session, detail.conversationId, action, body)
      await Promise.all([loadDetail(session, detail.conversationId), loadList(session)])
    } catch {
      setError(action === 'reply' ? 'No se pudo enviar la respuesta (la ventana de 24 h puede estar cerrada).' : 'No se pudo completar la acción.')
    } finally {
      setBusy(false)
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!reply.trim()) return
    await act('reply', { text: reply.trim() })
    setReply('')
  }

  const who = (actor: string, direction: string) => (direction === 'inbound' ? 'user' : actor === 'assistant' ? 'bot' : 'admin')

  return (
    <>
      <AdminPageHeader subtitle="Conversaciones del asistente de WhatsApp" title="WhatsApp" />
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          <button aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')} type="button">Todas</button>
          <button aria-pressed={filtro === 'human'} onClick={() => setFiltro('human')} type="button">Requieren intervención</button>
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null ? <p className={styles.muted} role="status">Cargando conversaciones…</p> : items.length === 0 ? (
        <AdminEmpty text={filtro === 'human' ? 'No hay conversaciones pendientes.' : 'Todavía no hay conversaciones de WhatsApp.'} />
      ) : (
        <div className={styles.chatLayout}>
          <ul aria-label="Conversaciones" className={styles.chatList}>
            {items.map((item) => (
              <li key={item.conversationId}>
                <button aria-current={item.conversationId === selectedId} onClick={() => setSelectedId(item.conversationId)} type="button">
                  <span className={styles.chatName}>
                    {contactName(item)}
                    <span className={styles.muted}>{formatFecha(item.lastActivity)}</span>
                  </span>
                  <span className={styles.chatPreview}>{item.lastMessage?.preview ?? 'Sin mensajes'}</span>
                  <span>
                    {item.mode === 'human' ? <span className={`${styles.badge} ${styles.badgeWarn}`}>Requiere intervención</span> : <span className={`${styles.badge} ${styles.badgeOff}`}>Asistente</span>}{' '}
                    {item.unread > 0 ? <span className={`${styles.badge} ${styles.badgeBrand}`}>{item.unread} sin leer</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <section aria-label="Conversación seleccionada" className={styles.chatPanel}>
            {!selectedId ? (
              <AdminEmpty text="Elegí una conversación de la lista." />
            ) : loadingDetail && !detail ? (
              <p className={styles.muted} role="status" style={{ padding: 14 }}>Abriendo la conversación…</p>
            ) : detail ? (
              <>
                <header className={styles.chatHeader}>
                  <div>
                    <strong>{contactName(detail)}</strong>
                    <div className={styles.muted}>
                      {detail.mode === 'human' ? 'Atendida por una persona' : 'Atendida por el asistente'} · {detail.status === 'active' ? 'Activa' : 'Cerrada'} ·{' '}
                      {detail.serviceWindowOpen ? 'Ventana de 24 h abierta' : 'Ventana de 24 h cerrada'}
                    </div>
                  </div>
                  {detail.mode === 'human' ? (
                    <button className={styles.buttonSecondary} disabled={busy} onClick={() => void act('release')} type="button">Devolver al asistente</button>
                  ) : (
                    <button className={styles.buttonPrimary} disabled={busy} onClick={() => void act('takeover')} type="button">Tomar conversación</button>
                  )}
                </header>
                <div className={styles.chatMessages}>
                  {detail.messages.length === 0 ? <p className={styles.muted}>Sin mensajes.</p> : detail.messages.map((message) => {
                    const kind = who(message.actor, message.direction)
                    return (
                      <div className={`${styles.bubble} ${kind === 'user' ? styles.bubbleUser : kind === 'bot' ? styles.bubbleBot : styles.bubbleAdmin}`} key={message.messageId}>
                        {message.text ?? (message.hasMedia ? '[Archivo adjunto]' : message.location ? '[Ubicación]' : `[${message.type}]`)}
                        <small>{kind === 'user' ? 'Usuario' : kind === 'bot' ? 'Asistente' : 'Admin'} · {formatFecha(message.createdAt)}</small>
                      </div>
                    )
                  })}
                </div>
                {detail.mode === 'human' && detail.serviceWindowOpen ? (
                  <form className={styles.chatForm} onSubmit={(event) => void send(event)}>
                    <label className={styles.srOnlyLabel} htmlFor="admin-whatsapp-reply">Respuesta</label>
                    <input id="admin-whatsapp-reply" maxLength={1000} onChange={(event) => setReply(event.target.value)} placeholder="Responder…" value={reply} />
                    <button className={styles.buttonPrimary} disabled={busy || !reply.trim()} type="submit">Enviar</button>
                  </form>
                ) : (
                  <p className={styles.muted} style={{ borderTop: '1px solid var(--tus-line)', margin: 0, padding: '10px 14px' }}>
                    {detail.mode !== 'human' ? 'Tomá la conversación para responder.' : 'La ventana de 24 h de Meta está cerrada: no se puede responder con texto libre.'}
                  </p>
                )}
              </>
            ) : (
              <AdminEmpty text="No pudimos abrir esa conversación." />
            )}
          </section>
        </div>
      )}
    </>
  )
}
