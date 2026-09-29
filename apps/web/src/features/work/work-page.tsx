'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkSummary, WorkMessage } from '@factory/contracts'
import { WORK_MESSAGE_MAX_LENGTH } from '@factory/contracts'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  TusRequestError,
} from '../../lib/tus-client'
import { createWorkIntent } from '../../lib/tus-work-intent'
import type { TusWebSession } from '../../lib/tus-ui-contract'
import { useTusSession } from '../session/use-tus-session'
import { useAccountView } from '../session/use-account-view'
import { tradeOf, useCatalog } from '../catalog/use-catalog'
import { PrivateImages } from '../provider/provider-inbox'
import styles from './work.module.css'

export const WORK_LABELS: Record<WorkSummary['status'], string> = {
  requested: 'Pendiente',
  in_diagnosis: 'En diagnóstico',
  budget_pending: 'Presupuesto por decidir',
  accepted: 'Presupuesto aceptado',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
}
const date = (value: string) => new Date(value).toLocaleString('es-AR')

export function WorkPage({ id }: { id?: string }): React.ReactNode {
  const path = id ? `/trabajos/${encodeURIComponent(id)}` : '/trabajos'
  const auth = useTusSession(path)
  useEffect(() => {
    if (auth.status === 'guest')
      window.location.replace(`/sign-in?returnTo=${encodeURIComponent(path)}`)
  }, [auth.status, path])
  return (
    <div className={styles.page}>
      {auth.status === 'authenticated' ? (
        id ? (
          <WorkDetail key={id} id={id} session={auth.session} />
        ) : (
          <WorkList session={auth.session} />
        )
      ) : (
        <p role="status">
          {auth.status === 'unavailable'
            ? 'No pudimos conectar con TUS. Volvé a intentar.'
            : 'Verificando tu sesión…'}
        </p>
      )}
    </div>
  )
}

export function WorkList({ session }: { session: TusWebSession }): React.ReactNode {
  const account = useAccountView()
  const [items, setItems] = useState<WorkSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError(false)
    void Promise.resolve()
      .then(() => createTusWebClient(createTusWebFetchTransport()).listMyWorks(session))
      .then((r) => {
        if (active) setItems(r.items)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [session, attempt])
  return (
    <>
      <h1>Mis trabajos</h1>
      {error ? (
        <p role="alert">
          No pudimos cargar tus trabajos.{' '}
          <button onClick={() => setAttempt((a) => a + 1)}>Reintentar</button>
        </p>
      ) : items === null ? (
        <p role="status">Cargando trabajos…</p>
      ) : (
        <WorkListContent
          items={items}
          provider={account.status === 'signed-in' && account.capabilities.provider}
        />
      )}
    </>
  )
}

export function WorkListContent({
  items,
  provider,
}: {
  items: WorkSummary[]
  provider: boolean
}): React.ReactNode {
  if (!items.length)
    return <p>{provider ? 'Todavía no tenés trabajos asignados.' : 'Todavía no tenés trabajos.'}</p>
  return (
    <ul className={styles.list}>
      {items.map((w) => (
        <li className={styles.card} key={w.id}>
          <h2>{w.title}</h2>
          <p>
            {WORK_LABELS[w.status]} · {w.counterpart.displayName}
          </p>
          <p>
            Tu rol: {w.role === 'cliente' ? 'Cliente' : 'Prestador'} · {date(w.createdAt)}
          </p>
          <a href={`/trabajos/${encodeURIComponent(w.id)}`}>Ver trabajo</a>
        </li>
      ))}
    </ul>
  )
}

type Action = 'start' | 'complete' | 'cancel' | 'budget' | 'accept' | 'reject'

export function WorkDetail({
  id,
  session,
}: {
  id: string
  session: TusWebSession
}): React.ReactNode {
  const catalog = useCatalog()
  const [work, setWork] = useState<WorkSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const inFlight = useRef(false)
  const generation = useRef(0)
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  const pendingIntent = useRef<{
    key: string
    intent: Awaited<ReturnType<typeof createWorkIntent>>
  } | null>(null)
  const refresh = useCallback(async () => {
    const n = ++generation.current
    const next = await createTusWebClient(createTusWebFetchTransport()).workSummary(session, id)
    if (n === generation.current) setWork(next)
  }, [id, session])
  useEffect(() => {
    void refresh().catch(() =>
      setError('No pudimos abrir el trabajo. Verificá tu acceso y volvé a intentar.')
    )
    return invalidate
  }, [refresh, invalidate])

  async function act(action: Action) {
    if (!work || inFlight.current) return
    if (action === 'cancel' && !window.confirm('¿Querés cancelar este trabajo?')) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const client = createTusWebClient(createTusWebFetchTransport())
      const totalMinor = amountToMinor(amount)
      if (action === 'budget' && (!totalMinor || !scope.trim()))
        throw new Error('Ingresá el alcance y un monto válido en pesos, con hasta dos decimales.')
      if (action === 'reject' && !reason.trim())
        throw new Error('Escribí el motivo para rechazar el presupuesto.')
      const payload = {
        id,
        version: work.version,
        scope,
        amount,
        reason,
        budgetVersion: work.budget?.version,
      }
      const key = JSON.stringify([action, payload])
      const intent =
        pendingIntent.current?.key === key
          ? pendingIntent.current.intent
          : await createWorkIntent(action, payload)
      pendingIntent.current = { key, intent }
      const input = { ...session, workId: id, ...intent }
      if (action === 'start') await client.startWork({ ...input, expectedVersion: work.version })
      if (action === 'complete')
        await client.completeWork({ ...input, expectedVersion: work.version })
      if (action === 'cancel') await client.cancelWork({ ...input, expectedVersion: work.version })
      if (action === 'budget')
        await client.createWorkBudget({
          ...input,
          currency: 'ARS',
          scope: scope.trim(),
          totalMinor: totalMinor!,
          lines: [
            {
              lineId: 'servicio',
              description: scope.trim(),
              quantity: 1,
              unitAmountMinor: totalMinor!,
              totalAmountMinor: totalMinor!,
            },
          ],
        })
      if ((action === 'accept' || action === 'reject') && work.budget) {
        const decision = {
          ...input,
          budgetId: work.budget.presupuestoId,
          budgetVersion: work.budget.version,
        }
        if (action === 'accept') await client.acceptWorkBudget(decision)
        else
          await client.rejectWorkBudget({
            ...decision,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          })
      }
      pendingIntent.current = null
      await refresh()
    } catch (e) {
      if (e instanceof TusRequestError && e.status === 409) {
        pendingIntent.current = null
        setWork(null)
        await refresh().catch(() => undefined)
        setError(
          'El trabajo cambió mientras lo estabas viendo. Revisá el estado actualizado antes de volver a actuar.'
        )
      } else
        setError(
          e instanceof TusRequestError
            ? 'No pudimos guardar la acción. Actualizá el trabajo para comprobar su estado.'
            : e instanceof Error
              ? e.message
              : 'No pudimos guardar la acción.'
        )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <a href="/trabajos">← Mis trabajos</a>
      {error ? <p role="alert">{error}</p> : null}
      <button
        disabled={busy}
        onClick={() =>
          void refresh()
            .then(() => setError(''))
            .catch(() => setError('No pudimos actualizar el trabajo.'))
        }
      >
        Actualizar trabajo
      </button>
      {!work ? (
        <p role="status">{error ? 'Trabajo no disponible.' : 'Cargando trabajo…'}</p>
      ) : (
        <>
          <header>
            <h1>{work.title}</h1>
            <p>
              {WORK_LABELS[work.status]} · {work.counterpart.displayName}
            </p>
          </header>
          <section className={styles.card}>
            <h2>Estado del trabajo</h2>
            <p>{WORK_LABELS[work.status]}</p>
            <p>
              Creado: {date(work.createdAt)}
              <br />
              Actualizado: {date(work.updatedAt)}
            </p>
          </section>
          {work.request ? (
            <section className={styles.card}>
              <h2>Solicitud original</h2>
              <p>{work.request.description}</p>
              <p>
                {tradeOf(catalog.data, work.request.category).label} · {work.request.area}
              </p>
              <PrivateImages paths={work.request.images} session={session} />
            </section>
          ) : null}
          {work.budgetRequired || work.budget ? (
            <section className={styles.card}>
              <h2>Presupuesto</h2>
              {work.budget ? (
                <>
                  <p>
                    {budgetLabel(work.budget.status)} · Versión {work.budget.version}
                  </p>
                  <p>
                    {new Intl.NumberFormat('es-AR', {
                      style: 'currency',
                      currency: work.budget.currency,
                    }).format(Number(work.budget.totalMinor) / 100)}
                  </p>
                  <p>{work.budget.scope}</p>
                  {work.budget.validUntil ? (
                    <p>Válido hasta {date(work.budget.validUntil)}</p>
                  ) : null}
                  {work.budget.status === 'accepted' ? <p>Pago pendiente de configuración.</p> : null}
                </>
              ) : (
                <p>Esperando presupuesto del Prestador.</p>
              )}
            </section>
          ) : null}
          <section className={styles.card}>
            <h2>Acciones</h2>
            {!Object.entries(work.actions).some(
              ([key, allowed]) => key !== 'canSendMessage' && allowed
            ) ? (
              <p>No hay acciones disponibles en este estado.</p>
            ) : null}
            <WorkActionButtons work={work} busy={busy} onAction={act} />
            {work.actions.canCreateBudget ? (
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault()
                  void act('budget')
                }}
              >
                <label>
                  Alcance del presupuesto
                  <textarea
                    required
                    maxLength={2000}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  />
                </label>
                <label>
                  Monto en pesos (ARS)
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <button disabled={busy} type="submit">
                  Crear presupuesto
                </button>
              </form>
            ) : null}
            {work.actions.canRejectBudget ? (
              <label>
                Motivo de rechazo
                <input
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            ) : null}
          </section>
          <WorkChat id={id} session={session} canSend={work.actions.canSendMessage} />
        </>
      )}
    </>
  )
}

export function WorkActionButtons({
  work,
  busy,
  onAction,
}: {
  work: WorkSummary
  busy: boolean
  onAction: (action: Action) => void
}): React.ReactNode {
  const buttons = [
    ['canStart', 'start', 'Iniciar trabajo'],
    ['canComplete', 'complete', 'Marcar como terminado'],
    ['canCancel', 'cancel', 'Cancelar'],
    ['canAcceptBudget', 'accept', 'Aceptar presupuesto'],
    ['canRejectBudget', 'reject', 'Rechazar presupuesto'],
  ] as const
  return (
    <div className={styles.actions}>
      {buttons.map(([capability, action, label]) =>
        work.actions[capability] ? (
          <button disabled={busy} key={action} onClick={() => onAction(action)}>
            {label}
          </button>
        ) : null
      )}
    </div>
  )
}

export function WorkChat({
  id,
  session,
  canSend,
}: {
  id: string
  session: TusWebSession
  canSend: boolean
}): React.ReactNode {
  const [messages, setMessages] = useState<WorkMessage[] | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const pending = useRef<{ text: string; id: string } | null>(null)
  const sending = useRef(false)
  const box = useRef<HTMLDivElement>(null)
  const olderHeight = useRef<number | null>(null)
  const reading = useRef(false)
  const load = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    setLoading(true)
    try {
      const result = await createTusWebClient(createTusWebFetchTransport()).workMessages(
        session,
        id
      )
      setMessages(result.items)
      setHasOlder(result.items.length === 100)
      setError('')
    } catch {
      setError('No pudimos cargar los mensajes. Volvé a actualizar.')
    } finally {
      reading.current = false
      setLoading(false)
    }
  }, [id, session])
  async function older() {
    if (!messages?.length || reading.current) return
    reading.current = true
    setLoading(true)
    try {
      const result = await createTusWebClient(createTusWebFetchTransport()).workMessages(
        session,
        id,
        messages[0]!.createdAt
      )
      olderHeight.current = box.current?.scrollHeight ?? null
      setMessages((current) => [...result.items, ...(current ?? [])])
      setHasOlder(result.items.length === 100)
    } catch {
      setError('No pudimos cargar los mensajes anteriores.')
    } finally {
      reading.current = false
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (box.current)
      box.current.scrollTop =
        olderHeight.current === null
          ? box.current.scrollHeight
          : box.current.scrollHeight - olderHeight.current
    olderHeight.current = null
  }, [messages])
  async function send() {
    const value = text.trim()
    if (!value || value.length > WORK_MESSAGE_MAX_LENGTH || sending.current || reading.current)
      return
    sending.current = true
    setBusy(true)
    setError('')
    pending.current =
      pending.current?.text === value ? pending.current : { text: value, id: crypto.randomUUID() }
    try {
      const message = await createTusWebClient(createTusWebFetchTransport()).sendWorkMessage(
        session,
        id,
        value,
        pending.current.id
      )
      setMessages((items) => [...(items ?? []).filter((m) => m.id !== message.id), message])
      setText('')
      pending.current = null
      await load()
    } catch {
      setError('No pudimos enviar el mensaje. Tu texto sigue acá para reintentar.')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <section className={styles.card}>
      <h2>Mensajes</h2>
      <p>Chat privado entre Cliente y Prestador. Podés compartir datos de contacto.</p>
      <button disabled={loading || busy} onClick={() => void load()}>
        Actualizar mensajes
      </button>
      {hasOlder ? (
        <button disabled={loading || busy} onClick={() => void older()}>
          Ver mensajes anteriores
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">Cargando mensajes…</p> : null}
      <div
        className={styles.chat}
        ref={box}
        role="log"
        aria-label="Mensajes del trabajo"
        aria-live="polite"
      >
        {messages?.length === 0 ? <p>Todavía no hay mensajes.</p> : null}
        {messages?.map((m) => (
          <article className={m.mine ? styles.mine : styles.message} key={m.id}>
            <strong>
              {m.authorRole === 'cliente' ? 'Cliente' : 'Prestador'}
              {m.mine ? ' (vos)' : ''}
            </strong>
            <p>{m.text}</p>
            <time dateTime={m.createdAt}>{date(m.createdAt)}</time>
          </article>
        ))}
      </div>
      {canSend ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <label>
            Tu mensaje
            <textarea
              maxLength={WORK_MESSAGE_MAX_LENGTH}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <small>
            {text.length}/{WORK_MESSAGE_MAX_LENGTH}
          </small>
          <button disabled={busy || loading || !text.trim()} type="submit">
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
      ) : null}
    </section>
  )
}

export function amountToMinor(value: string): string | null {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  return minor > 0n ? String(minor) : null
}
function budgetLabel(status: NonNullable<WorkSummary['budget']>['status']): string {
  return (
    (
      {
        draft: 'Borrador',
        issued: 'Esperando decisión del Cliente',
        accepted: 'Presupuesto aceptado',
        rejected: 'Presupuesto rechazado',
        expired: 'Presupuesto vencido',
        superseded: 'Reemplazado',
      } as Record<string, string>
    )[status] ?? 'Presupuesto'
  )
}
