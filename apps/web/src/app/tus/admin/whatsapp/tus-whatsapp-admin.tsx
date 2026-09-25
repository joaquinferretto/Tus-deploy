'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  type TusWhatsappAdminAction,
  type TusWhatsappAdminConversation,
  type TusWhatsappAdminDetail,
} from '@/lib/tus-client'
import { formatTusDate, type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../tus-ui'

type SurfaceState = 'loading' | 'ready' | 'empty' | 'error' | 'disabled'

export function TusWhatsappAdminSurface() {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restoring your secure session.')
  const [listState, setListState] = useState<SurfaceState>('loading')
  const [message, setMessage] = useState('Loading WhatsApp conversations from TUS.')
  const [conversations, setConversations] = useState<readonly TusWhatsappAdminConversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TusWhatsappAdminDetail | null>(null)
  const [detailState, setDetailState] = useState<SurfaceState>('loading')
  const [reply, setReply] = useState('')
  const [actionState, setActionState] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [actionMessage, setActionMessage] = useState('')

  const refreshList = useCallback(async (currentSession: TusWebSession) => {
    setListState('loading')
    try {
      const result = await createTusWebClient(
        createTusWebFetchTransport()
      ).listWhatsappAdminConversations(currentSession, 'human')
      setConversations(result.conversations)
      setSelectedId((current) =>
        current && result.conversations.some((item) => item.conversationId === current)
          ? current
          : (result.conversations[0]?.conversationId ?? null)
      )
      setListState(result.conversations.length === 0 ? 'empty' : 'ready')
      setMessage(
        result.conversations.length === 0
          ? 'No human-handoff conversations are waiting.'
          : 'Current human-handoff conversations from TUS.'
      )
    } catch (error: unknown) {
      setListState('error')
      setMessage(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => {
        if (cancelled) return
        setAuthMessage(result.message)
        setSession(result.session === undefined ? null : toTusWebSession(result.session))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (session === null) {
      setListState('disabled')
      setMessage(authMessage)
      return
    }
    if (!hasPermission(session, 'tus:whatsapp:support')) {
      setListState('disabled')
      setMessage('This session does not have the platform WhatsApp support permission.')
      return
    }
    void refreshList(session)
  }, [session, authMessage, refreshList])

  useEffect(() => {
    if (!session || !selectedId) return
    let cancelled = false
    setDetailState('loading')
    void createTusWebClient(createTusWebFetchTransport())
      .getWhatsappAdminConversation(session, selectedId)
      .then((next) => {
        if (cancelled) return
        setDetail(next)
        setDetailState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDetailState('error')
        setActionMessage(errorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [session, selectedId])

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !detail || !reply.trim()) return
    await runAction('reply', { text: reply.trim() })
    setReply('')
  }

  async function runAction(action: TusWhatsappAdminAction, body: Record<string, unknown> = {}) {
    if (!session || !detail || actionState === 'submitting') return
    setActionState('submitting')
    setActionMessage('')
    try {
      await createTusWebClient(createTusWebFetchTransport()).whatsappAdminAction(
        session,
        detail.conversationId,
        action,
        body
      )
      const refreshed = await createTusWebClient(
        createTusWebFetchTransport()
      ).getWhatsappAdminConversation(session, detail.conversationId)
      setDetail(refreshed)
      await refreshList(session)
      setActionState('idle')
    } catch (error: unknown) {
      setActionState('error')
      setActionMessage(errorMessage(error))
    }
  }

  if (session === undefined)
    return (
      <TusStateMessage state={{ status: 'loading', message: 'Restoring your secure session.' }} />
    )
  if (session === null || listState === 'disabled') {
    return (
      <TusStateMessage state={{ status: 'disabled', message: message || authMessage }}>
        <Link
          className="tus-action-button tus-action-link"
          href="/sign-in?returnTo=/tus/admin/whatsapp"
        >
          Sign in through TUS
        </Link>
      </TusStateMessage>
    )
  }

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <Link href="/tus">TUS workspace</Link>
        <Link href="/tus/soporte">Support cases</Link>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">TUS / WhatsApp operations</p>
          <h1>
            Keep the human
            <br />
            <em>conversation accountable.</em>
          </h1>
        </div>
        <p className="tus-intro">
          <strong>Platform-admin only.</strong> Phone identifiers stay masked; actions are audited
          and replies require the Meta service window.
        </p>
      </header>
      <div className="tus-support-workspace tus-whatsapp-admin">
        <section className="tus-support-panel" aria-labelledby="whatsapp-conversations-title">
          <div className="tus-section-label">
            <span>01</span>
            <h2 id="whatsapp-conversations-title">Handoffs.</h2>
          </div>
          {listState === 'loading' ? (
            <TusStateMessage state={{ status: 'loading', message }} />
          ) : listState === 'error' ? (
            <TusStateMessage
              state={{
                status: 'error',
                message,
                retry: () => {
                  if (session) void refreshList(session)
                },
              }}
            />
          ) : listState === 'empty' ? (
            <TusStateMessage state={{ status: 'empty', message }} />
          ) : (
            <ul className="tus-support-case-list">
              {conversations.map((conversation) => (
                <li key={conversation.conversationId}>
                  <button
                    className="tus-whatsapp-conversation"
                    data-selected={conversation.conversationId === selectedId}
                    onClick={() => setSelectedId(conversation.conversationId)}
                    type="button"
                  >
                    <strong>
                      {conversation.contact.displayName ||
                        conversation.contact.waIdMasked ||
                        'Masked contact'}
                    </strong>
                    <span>
                      {conversation.handoffReason || 'human handoff'}
                      {conversation.unread > 0 ? ` · ${conversation.unread} unread` : ''}
                    </span>
                    <small>
                      {formatTusDate(conversation.lastActivity)} ·{' '}
                      {conversation.serviceWindowOpen ? '24h window open' : 'template required'}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="tus-support-panel" aria-labelledby="whatsapp-detail-title">
          <div className="tus-section-label">
            <span>02</span>
            <h2 id="whatsapp-detail-title">Conversation.</h2>
          </div>
          {detailState === 'loading' ? (
            <TusStateMessage
              state={{ status: 'loading', message: 'Loading the selected conversation.' }}
            />
          ) : detailState === 'error' || !detail ? (
            <TusStateMessage
              state={{
                status: 'error',
                message: actionMessage || 'The conversation could not be loaded.',
              }}
            />
          ) : (
            <>
              <div className="tus-whatsapp-detail-meta">
                <strong>
                  {detail.contact.displayName || detail.contact.waIdMasked || 'Masked contact'}
                </strong>
                <span>
                  {detail.contact.waIdMasked || 'masked'} · {detail.mode} ·{' '}
                  {detail.serviceWindowOpen ? 'free text allowed' : 'approved template required'}
                </span>
                {detail.summary ? <p>{detail.summary}</p> : null}
              </div>
              <ol className="tus-whatsapp-messages" aria-label="Conversation messages">
                {detail.messages.map((item) => (
                  <li data-direction={item.direction} key={item.messageId}>
                    <small>
                      {item.actor} · {formatTusDate(item.createdAt)} · {item.status}
                    </small>
                    <p>
                      {item.text || `[${item.type}]`}
                      {item.hasMedia ? ' · media retained for review' : ''}
                    </p>
                  </li>
                ))}
              </ol>
              <div className="tus-whatsapp-actions">
                {detail.mode === 'human' ? (
                  <TusActionButton
                    disabled={actionState === 'submitting'}
                    onClick={() => void runAction('release')}
                    type="button"
                  >
                    Return to bot
                  </TusActionButton>
                ) : (
                  <TusActionButton
                    disabled={actionState === 'submitting'}
                    onClick={() => void runAction('takeover')}
                    type="button"
                  >
                    Take over
                  </TusActionButton>
                )}
                <TusActionButton
                  disabled={actionState === 'submitting'}
                  onClick={() => void runAction('block', { blocked: !detail.contact.blocked })}
                  type="button"
                >
                  {detail.contact.blocked ? 'Unblock contact' : 'Block contact'}
                </TusActionButton>
                <TusActionButton
                  disabled={actionState === 'submitting'}
                  onClick={() => void runAction('unlink')}
                  type="button"
                >
                  Unlink account
                </TusActionButton>
              </div>
              {detail.mode === 'human' && detail.serviceWindowOpen ? (
                <form className="tus-support-form" onSubmit={(event) => void submitReply(event)}>
                  <label htmlFor="whatsapp-reply">
                    Reply inside the 24h window
                    <textarea
                      id="whatsapp-reply"
                      maxLength={4000}
                      onChange={(event) => setReply(event.target.value)}
                      rows={3}
                      value={reply}
                    />
                  </label>
                  <TusActionButton
                    disabled={actionState === 'submitting' || !reply.trim()}
                    loading={actionState === 'submitting'}
                    loadingLabel="Sending through TUS…"
                    type="submit"
                  >
                    Send reply
                  </TusActionButton>
                </form>
              ) : null}
              {actionMessage ? (
                <p className="tus-support-feedback tus-feedback-error" role="alert">
                  {actionMessage}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </>
  )
}

function hasPermission(session: TusWebSession, permission: string) {
  return (
    session.permissions?.includes(permission) === true ||
    session.permissions?.includes('tus:*') === true
  )
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'TUS did not confirm the operation.'
}
