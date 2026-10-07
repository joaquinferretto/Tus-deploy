'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { createTusWebClient, createTusWebFetchTransport, type TusWhatsappAdminConversation, type TusWhatsappAdminDetail, type TusWhatsappProviderNotice } from '@/lib/tus-client'
import { formatFecha } from '@/lib/tus-admin-api'
import type { TusWebSession } from '@/lib/tus-ui-contract'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
import styles from './admin.module.css'

// WhatsApp inbox: conversation list + selected chat. Same API and restrictions as before: numbers
// stay masked, a person can only reply after taking the conversation and while Meta's 24 h service
// window is open.
const client = () => createTusWebClient(createTusWebFetchTransport())

function contactName(item: { contact: TusWhatsappAdminConversation['contact'] }) {
  return item.contact.displayName || item.contact.waIdMasked || 'Contacto sin nombre'
}

// "••••5022": the masked number as the backend sends it ("****5022"), easier to read.
const mascara = (value: string | null) => (value ? value.replace(/\*/gu, '•') : 'sin número')

// What Meta reported for a message TUS sent. "Enviado" is Meta accepting it, not the phone.
const ESTADO_MENSAJE: Record<string, string> = {
  pending_send: 'Enviando',
  unknown: 'Sin confirmación de Meta',
  sent: 'Enviado',
  delivered: 'Entregado',
  read: 'Leído',
  failed: 'Falló',
}

const MOTIVO_NO_ENVIADO: Record<string, string> = {
  no_whatsapp_linked: 'el prestador no tiene un WhatsApp vinculado',
  provider_without_account: 'el prestador no tiene una cuenta asociada',
  conversation_with_operator: 'su conversación está tomada por una persona de TUS',
  template_required: 'está fuera de la ventana de 24 h y no hay plantilla aprobada',
}

// One line that answers "¿TUS le avisó?": how far the notice really got.
function estadoAviso(notice: TusWhatsappProviderNotice): { label: string; tone: 'ok' | 'warn' | 'off'; at: string | null } {
  const entrega = [...notice.deliveries].sort((a, b) => b.at.localeCompare(a.at))[0]
  const at = entrega?.at ?? notice.notSent?.at ?? null
  const propio = entrega && !['read', 'delivered', 'sent'].includes(entrega.status) ? entrega.status : null
  const estado = notice.answer ? (entrega ? (['read', 'delivered', 'sent'].find((valor) => notice.deliveries.some((item) => item.status === valor)) ?? propio ?? 'sent') : null) : notice.state
  if (estado === 'read') return { label: 'Leído', tone: 'ok', at }
  if (estado === 'delivered') return { label: 'Entregado', tone: 'ok', at }
  if (estado === 'sent') return { label: 'Enviado (Meta lo recibió; todavía sin entrega)', tone: 'off', at }
  if (estado === 'sending' || estado === 'pending_send' || estado === 'unknown') return { label: 'Se intentó enviar; sin confirmación de Meta', tone: 'warn', at }
  if (estado === 'failed') return { label: `Falló el envío${entrega?.error ? ` (${entrega.error})` : ''}`, tone: 'warn', at }
  if (estado === 'template_required') return { label: `No enviado: ${MOTIVO_NO_ENVIADO['template_required']}`, tone: 'warn', at }
  if (estado === 'not_sent') return { label: `No enviado: ${MOTIVO_NO_ENVIADO[notice.notSent?.reason ?? ''] ?? 'no se pudo escribir a ese número'}`, tone: 'warn', at }
  if (estado === null) return { label: 'Sin aviso por WhatsApp registrado', tone: 'off', at: null }
  return { label: 'Pendiente: el aviso todavía no se procesó', tone: 'off', at: null }
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
  const [filtro, setFiltroState] = useState<'todas' | 'human'>('todas')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  // Changing the filter goes back to the first page.
  const setFiltro = (value: 'todas' | 'human') => { setFiltroState(value); setPage(1) }

  useEffect(() => {
    void createTusWebAuthClient().restore(window.location.pathname).then((result) => setSession(result.session ? toTusWebSession(result.session) : null))
  }, [])

  // Only the answer to the LAST request is shown: a slower, older page never replaces a newer one
  // (page 1 of 25 arriving after the person already asked for 10 per page).
  const pedido = useRef(0)
  const loadList = useCallback(async (current: TusWebSession) => {
    const turno = (pedido.current += 1)
    try {
      const result = await client().listWhatsappAdminConversations(current, filtro === 'human' ? 'human' : undefined, page, pageSize)
      if (turno !== pedido.current) return
      setItems(result.conversations)
      setTotalPages(result.totalPages)
      setTotal(result.total)
      // The last page emptied meanwhile (a filter, a released conversation): the last real one.
      if (page > result.totalPages) setPage(Math.max(1, result.totalPages))
      setError('')
    } catch {
      if (turno !== pedido.current) return
      setItems([])
      setError('No pudimos cargar las conversaciones de WhatsApp. Si el módulo no está activo en el servidor, esta sección queda vacía.')
    }
  }, [filtro, page, pageSize])

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
          <div className={styles.chatSide}>
          <ul aria-label={`Conversaciones (${total})`} className={styles.chatList}>
            {items.map((item) => (
              <li key={item.conversationId}>
                <button aria-current={item.conversationId === selectedId} onClick={() => setSelectedId(item.conversationId)} type="button">
                  <span className={styles.chatName}>
                    {contactName(item)}
                    <span className={styles.muted}>{formatFecha(item.lastActivity)}</span>
                  </span>
                  <span className={styles.chatPreview}>{item.lastMessage?.preview ?? 'Sin mensajes'}</span>
                  <span className={styles.chatBadges}>
                    {item.mode === 'human' ? <span className={`${styles.badge} ${styles.badgeWarn}`}>Requiere intervención</span> : <span className={`${styles.badge} ${styles.badgeOff}`}>Asistente</span>}
                    {item.unread > 0 ? <span className={`${styles.badge} ${styles.badgeBrand}`}>{item.unread} sin leer</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Footer of the panel, never an item of the list: the list keeps the height. Paging and
              the page size keep the filter and the conversation that is open. */}
          <AdminPagination compact onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} />
          </div>
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
                {detail.providerNotices.length > 0 ? (
                  <ul aria-label="Avisos a prestadores" className={styles.noticeList}>
                    {detail.providerNotices.map((notice) => {
                      const aviso = estadoAviso(notice)
                      const entrega = notice.deliveries[0]
                      return (
                        <li className={styles.notice} key={notice.reservaId}>
                          <div>
                            <strong>Prestador: {notice.provider.name}</strong>
                            <span className={styles.muted}> · {notice.service}{notice.startsAt ? ` · ${formatFecha(notice.startsAt)}` : ''}</span>
                          </div>
                          {notice.answer ? (
                            <div>
                              <span className={`${styles.badge} ${notice.answer.result === 'accepted' ? styles.badgeOk : styles.badgeWarn}`}>Respondió: {notice.answer.result === 'accepted' ? 'Aceptó' : 'Rechazó'}</span>{' '}
                              <span className={styles.muted}>{formatFecha(notice.answer.at)}{notice.answer.channel === 'whatsapp' ? ' · por WhatsApp' : ' · desde el panel'}</span>
                            </div>
                          ) : null}
                          <div>
                            <span className={styles.muted}>{entrega ? `WhatsApp ${mascara(entrega.waIdMasked)}${entrega.kind === 'template' ? ' · plantilla' : ''} · ` : ''}Aviso: </span>
                            <span className={`${styles.badge} ${aviso.tone === 'ok' ? styles.badgeOk : aviso.tone === 'warn' ? styles.badgeWarn : styles.badgeOff} ${styles.noticeState}`}>{aviso.label}</span>
                            {aviso.at ? <span className={styles.muted}> · {formatFecha(aviso.at)}</span> : null}
                            {entrega ? <button aria-label={`Ver los mensajes enviados a ${notice.provider.name}`} className={styles.noticeLink} onClick={() => setSelectedId(entrega.conversationId)} type="button">Ver mensajes</button> : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                <div className={styles.chatMessages}>
                  {detail.messages.length === 0 ? <p className={styles.muted}>Sin mensajes.</p> : detail.messages.map((message) => {
                    const kind = who(message.actor, message.direction)
                    return (
                      <div className={`${styles.bubble} ${kind === 'user' ? styles.bubbleUser : kind === 'bot' ? styles.bubbleBot : styles.bubbleAdmin}`} key={message.messageId}>
                        {message.text ?? (message.hasMedia ? '[Archivo adjunto]' : message.location ? '[Ubicación]' : `[${message.type}]`)}
                        <small>
                          {kind === 'user' ? 'Usuario' : kind === 'bot' ? 'Asistente' : 'Admin'} · {formatFecha(message.createdAt)}
                          {message.direction === 'outbound' && ESTADO_MENSAJE[message.status] ? ` · ${ESTADO_MENSAJE[message.status]}${message.statusAt && message.status !== 'sent' ? ` ${formatFecha(message.statusAt)}` : ''}` : ''}
                        </small>
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
