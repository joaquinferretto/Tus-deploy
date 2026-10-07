'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { TusRequestError, createTusWebClient, createTusWebFetchTransport, type TusWhatsappAdminConversation, type TusWhatsappAdminDetail, type TusWhatsappProviderNotice } from '@/lib/tus-client'
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

// Why a send did not leave, in words: the class the server gave to what Meta answered.
const ERROR_DE_META: Record<string, string> = {
  WHATSAPP_INVALID_REQUEST: 'Meta rechazó el mensaje',
  WHATSAPP_WINDOW_CLOSED: 'Meta indica que la ventana de 24 h está cerrada',
  WHATSAPP_RATE_LIMITED: 'Meta limitó los envíos por ahora',
  WHATSAPP_AUTH: 'Meta rechazó la credencial de la cuenta de WhatsApp de TUS',
  WHATSAPP_UNAVAILABLE: 'Meta no está disponible',
  WHATSAPP_TIMEOUT: 'Meta no respondió a tiempo',
  WHATSAPP_NOT_CONFIGURED: 'WhatsApp no está configurado en el servidor',
  WHATSAPP_DELIVERY_FAILED: 'Meta aceptó el mensaje pero no pudo entregarlo',
  SEND_FAILED: 'no se pudo enviar',
}

// "Meta rechazó el mensaje (código de Meta 131030)": the real reason, with Meta's own number.
function motivoDeMeta(code: string, metaCode: number | null): string {
  return `${ERROR_DE_META[code] ?? `no se pudo enviar (${code})`}${metaCode === null ? '' : ` (código de Meta ${metaCode})`}`
}

// What to tell the operator when an answer or a template was not sent.
function errorDeEnvio(error: unknown): string {
  const code = error instanceof TusRequestError ? (error.code ?? '') : ''
  if (code === 'SERVICE_WINDOW_CLOSED') return 'La ventana de 24 h se cerró: ya no se puede enviar texto libre. Usá "Contactar con plantilla".'
  if (code === 'SERVICE_WINDOW_OPEN') return 'La ventana de 24 h está abierta: escribí el mensaje directamente.'
  if (code === 'TAKE_OVER_FIRST') return 'La conversación volvió al asistente. Tomala de nuevo para responder.'
  if (code === 'TEMPLATE_NOT_APPROVED') return 'Esa plantilla no está aprobada o configurada para contacto manual.'
  if (code in ERROR_DE_META || code.startsWith('WHATSAPP_')) {
    const numero = error instanceof Error ? /Meta (\d+)/u.exec(error.message)?.[1] : undefined
    return `No se envió: ${motivoDeMeta(code, numero ? Number(numero) : null)}. Podés reintentar.`
  }
  return 'No se pudo enviar el mensaje. Podés reintentar.'
}

// The body of a template as the person will read it ("{{1}}" is the first name of the contact).
function vistaPlantilla(body: string, nombre: string | null): string {
  return body.replace(/\{\{1\}\}/gu, (nombre ?? '').trim().split(/\s+/u)[0] || 'cómo estás')
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
  // Why the last answer or template was not sent (shown next to the composer; the text is kept).
  const [sendError, setSendError] = useState('')
  // What is typed in the search field, and what was last asked to the server (after a pause).
  const [search, setSearch] = useState('')
  const [busqueda, setBusqueda] = useState('')
  // The search the list on screen answers to (the field stays mounted until the plain list is back).
  const [listada, setListada] = useState('')
  const [filtro, setFiltroState] = useState<'todas' | 'human'>('todas')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  // Changing the filter goes back to the first page.
  const setFiltro = (value: 'todas' | 'human') => { setFiltroState(value); setPage(1) }

  // The search runs on the server over every conversation, a moment after the last key; it goes
  // back to the first page and keeps the filter.
  useEffect(() => {
    const valor = search.trim()
    if (valor === busqueda) return
    const espera = window.setTimeout(() => { setBusqueda(valor); setPage(1) }, 300)
    return () => window.clearTimeout(espera)
  }, [search, busqueda])

  useEffect(() => {
    void createTusWebAuthClient().restore(window.location.pathname).then((result) => setSession(result.session ? toTusWebSession(result.session) : null))
  }, [])

  // Only the answer to the LAST request is shown: a slower, older page never replaces a newer one
  // (page 1 of 25 arriving after the person already asked for 10 per page).
  const pedido = useRef(0)
  const loadList = useCallback(async (current: TusWebSession) => {
    const turno = (pedido.current += 1)
    try {
      const result = await client().listWhatsappAdminConversations(current, filtro === 'human' ? 'human' : undefined, page, pageSize, busqueda)
      if (turno !== pedido.current) return
      setItems(result.conversations)
      setListada(busqueda)
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
  }, [filtro, page, pageSize, busqueda])

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

  // True when the server did it. Nothing is drawn as sent before that: the message appears when
  // the conversation is read again, with the state the server recorded.
  async function act(action: 'takeover' | 'release' | 'reply' | 'template', body: Record<string, unknown> = {}): Promise<boolean> {
    if (!session || !detail || busy) return false
    const envio = action === 'reply' || action === 'template'
    setBusy(true)
    setSendError('')
    let hecho = true
    try {
      await client().whatsappAdminAction(session, detail.conversationId, action, body)
    } catch (failure) {
      hecho = false
      if (envio) setSendError(errorDeEnvio(failure))
      else setError('No se pudo completar la acción.')
    }
    // Also after a failure: the message Meta refused is in the conversation, marked as failed.
    await Promise.all([loadDetail(session, detail.conversationId), loadList(session)])
    setBusy(false)
    return hecho
  }

  // The text is only cleared once it was sent: after a failure it stays, to try again.
  async function send(event?: FormEvent) {
    event?.preventDefault()
    const text = reply.trim()
    if (!text || busy) return
    if (await act('reply', { text })) setReply('')
  }

  // Enter sends; Shift+Enter is a new line (and Enter while composing an accent is not a send).
  function onReplyKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  // Another conversation: its own draft and its own errors.
  useEffect(() => { setReply(''); setSendError('') }, [selectedId])

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
      {items === null ? <p className={styles.muted} role="status">Cargando conversaciones…</p> : items.length === 0 && !busqueda && !search && !listada ? (
        <AdminEmpty text={filtro === 'human' ? 'No hay conversaciones pendientes.' : 'Todavía no hay conversaciones de WhatsApp.'} />
      ) : (
        <div className={styles.chatLayout}>
          <div className={styles.chatSide}>
          <div className={styles.chatSearch} role="search">
            <label className={styles.srOnlyLabel} htmlFor="admin-whatsapp-search">Buscar por nombre o celular</label>
            <input autoComplete="off" id="admin-whatsapp-search" inputMode="search" maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o celular..." type="text" value={search} />
            {search ? <button aria-label="Limpiar la búsqueda" onClick={() => setSearch('')} type="button">×</button> : null}
          </div>
          {/* No result is not an error: the layout stays and the field keeps what was typed. */}
          {items.length === 0 && listada ? <p className={styles.chatNoResults} role="status">No encontramos conversaciones con ese nombre o celular.</p> : null}
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
                    {detail.contact.displayName && detail.contact.waIdMasked ? <span className={styles.muted}> · WhatsApp {mascara(detail.contact.waIdMasked)}</span> : null}
                    <div className={styles.muted} data-atencion={detail.mode}>
                      {detail.mode === 'human' ? `Atendida por ${detail.operator?.name ?? 'una persona de TUS'}` : 'Asistente'} · {detail.serviceWindowOpen ? 'Ventana abierta' : 'Ventana cerrada'}
                      {detail.status === 'active' ? '' : ' · Conversación cerrada'}
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
                          {message.direction === 'outbound' && ESTADO_MENSAJE[message.status] ? ` · ${ESTADO_MENSAJE[message.status]}${message.status === 'failed' && message.error ? `: ${motivoDeMeta(message.error.code, message.error.metaCode)}` : ''}${message.statusAt && message.status !== 'sent' ? ` ${formatFecha(message.statusAt)}` : ''}` : ''}
                        </small>
                        {/* Meta says it went to a number that is not this contact's: never hidden. */}
                        {message.recipientMismatch && message.recipient ? (
                          <small className={styles.bubbleWarn} role="note">
                            Destinatario distinto al de esta conversación: enviado a {mascara(message.recipient.to)}
                            {message.recipient.meta ? ` · Meta lo resolvió a ${mascara(message.recipient.meta)}` : ''}
                            {message.recipient.status ? ` · estado informado para ${mascara(message.recipient.status)}` : ''}
                          </small>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                {sendError ? <p className={styles.chatSendError} role="alert">{sendError}</p> : null}
                {detail.mode === 'human' && detail.serviceWindowOpen ? (
                  <form className={styles.chatForm} onSubmit={(event) => void send(event)}>
                    <label className={styles.srOnlyLabel} htmlFor="admin-whatsapp-reply">Respuesta</label>
                    <textarea id="admin-whatsapp-reply" maxLength={1000} onChange={(event) => setReply(event.target.value)} onKeyDown={onReplyKey} placeholder="Escribí un mensaje…" rows={Math.min(5, Math.max(1, reply.split('\n').length))} value={reply} />
                    <button className={styles.buttonPrimary} disabled={busy || !reply.trim()} type="submit">{busy ? 'Enviando…' : 'Enviar'}</button>
                  </form>
                ) : detail.mode !== 'human' ? (
                  <p className={styles.chatClosed}>Tomá la conversación para responder.</p>
                ) : (
                  <div className={styles.chatClosed} data-ventana="cerrada">
                    <p>La ventana de 24 h de Meta está cerrada: no se puede escribir texto libre. Solo se puede contactar con una plantilla aprobada; cuando la persona responda, vas a poder escribirle de nuevo.</p>
                    {detail.templates.length === 0 ? (
                      <p className={styles.muted}>No hay ninguna plantilla de contacto aprobada y configurada en el servidor.</p>
                    ) : detail.templates.map((template) => (
                      <div className={styles.templateOption} key={template.name}>
                        <blockquote>
                          {vistaPlantilla(template.body, detail.contact.displayName)}
                          {template.buttons.length > 0 ? <span className={styles.muted}> [{template.buttons.join('] [')}]</span> : null}
                        </blockquote>
                        <button className={styles.buttonPrimary} data-plantilla={template.name} disabled={busy} onClick={() => void act('template', { template: template.name })} type="button">{busy ? 'Enviando…' : 'Contactar con plantilla'}</button>
                      </div>
                    ))}
                  </div>
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
