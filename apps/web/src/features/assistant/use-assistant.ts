'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ActividadAsistenteDTO, MensajeAsistenteDTO } from '@factory/contracts'

import { AssistantError, loadHistory, resetConversation, sendTurn } from './assistant-client'

// What the backend is doing while the reply is prepared, in words. The events are real (emitted
// by the API as each step runs); only their wording lives here.
const TOOL_LABEL: Record<string, string> = {
  collect_service_request: 'Anotando lo que necesitás…',
  search_providers: 'Buscando prestadores…',
  search_services: 'Buscando servicios…',
  get_available_slots: 'Consultando turnos disponibles…',
  book_appointment: 'Preparando la solicitud de turno…',
  request_provider: 'Preparando la solicitud…',
  get_service_details: 'Consultando el servicio…',
}

export function activityLabel(activity: ActividadAsistenteDTO | null): string {
  if (!activity) return 'Pensando…'
  if (activity.type === 'knowledge' && activity.phase === 'start') return 'Consultando la ayuda de TUS…'
  if (activity.type === 'tool' && activity.phase === 'start') return TOOL_LABEL[activity.tool] ?? 'Consultando TUS…'
  return 'Escribiendo…'
}

// Only failures get a fixed text: the conversation itself is always written by the model.
function errorText(error: unknown): string {
  const code = error instanceof AssistantError ? error.code : 'NETWORK'
  if (code === 'RATE_LIMITED') return 'Estás enviando muchos mensajes seguidos. Esperá un momento y volvé a escribir.'
  if (code === 'TURN_IN_PROGRESS') return 'Todavía estoy respondiendo tu mensaje anterior.'
  if (code === 'INVALID_REQUEST') return 'No pude leer ese mensaje. Probá escribirlo de nuevo (hasta 1000 caracteres).'
  return 'No pude conectar con el asistente. Probá de nuevo en unos minutos.'
}

export interface AssistantState {
  status: 'loading' | 'ready'
  messages: MensajeAsistenteDTO[]
  busy: boolean
  activity: ActividadAsistenteDTO | null
  error: string | null
  send(text: string): void
  // label: the text of the pressed button, echoed as the message of the person.
  reply(replyId: string, label?: string): void
  restart(): void
}

// `sessionKey` changes when the person signs in or out: the conversation shown is reloaded for
// that identity (the API decides which one it is from the session cookie).
export function useAssistant(enabled: boolean, sessionKey: string): AssistantState {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [messages, setMessages] = useState<MensajeAsistenteDTO[]>([])
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState<ActividadAsistenteDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const working = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setStatus('loading')
    loadHistory()
      .then((history) => {
        if (!cancelled) setMessages(history.messages)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setStatus('ready')
      })
    return () => {
      cancelled = true
    }
  }, [enabled, sessionKey])

  const turn = useCallback((input: { text: string } | { replyId: string }, optimistic: string) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    setActivity(null)
    const pendingId = `pendiente-${Date.now()}`
    setMessages((current) => [...current, { id: pendingId, role: 'user', text: optimistic, createdAt: new Date().toISOString() }])
    sendTurn(input, {
      onAccepted: (message) => setMessages((current) => current.map((item) => (item.id === pendingId ? message : item))),
      onActivity: setActivity,
      onMessage: (message) => setMessages((current) => [...current, message]),
    })
      .catch((failure: unknown) => setError(errorText(failure)))
      .finally(() => {
        working.current = false
        setBusy(false)
        setActivity(null)
      })
  }, [])

  const send = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, 1000)
      if (clean) turn({ text: clean }, clean)
    },
    [turn]
  )
  const reply = useCallback((replyId: string, label?: string) => turn({ replyId }, label ?? (replyId.startsWith('confirm:') ? 'Confirmar' : 'Cancelar')), [turn])
  const restart = useCallback(() => {
    if (working.current) return
    setMessages([])
    setError(null)
    void resetConversation().catch(() => undefined)
  }, [])

  return { status, messages, busy, activity, error, send, reply, restart }
}
