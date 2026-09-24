'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  TusRequestError,
  createStableIdempotencyKey,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusPaymentPreview,
} from '@/lib/tus-client'
import { formatMoney } from '@/lib/tus-money'
import { type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

// WEB-09D: payment block of a completed service. Every amount comes from TUS; the Web only
// formats the minor-unit string it receives and never sends money back.

type PreviewState =
  | { status: 'loading'; preview: null; message: string }
  | { status: 'ready'; preview: TusPaymentPreview; message: string }
  | { status: 'error'; preview: null; message: string }

const NOT_PAYABLE_COPY: Record<string, string> = {
  WORK_NOT_COMPLETED: 'El pago se habilita cuando el prestador marque el trabajo como completado.',
  BUDGET_REQUIRED: 'Este trabajo no tiene un presupuesto aceptado. Sin presupuesto no se cobra.',
  BUDGET_INCONSISTENT: 'El presupuesto aceptado no coincide con el trabajo. Contactá a soporte.',
  INCONSISTENT_COMMERCIAL_CHAIN: 'Los datos del servicio no son consistentes. Contactá a soporte.',
  WORK_CANCELLED: 'El trabajo fue cancelado; no hay nada para pagar.',
  ALREADY_PAID: 'Este trabajo ya está pagado.',
  OBLIGATION_CLOSED: 'El pago de este trabajo ya fue cerrado.',
}

const PAYMENT_STATUS_COPY: Record<string, string> = {
  not_started: 'Sin pago iniciado',
  pending: 'Pago en proceso',
  approved: 'Pago aprobado',
  rejected: 'Pago rechazado',
  expired: 'Pago vencido',
  cancelled: 'Pago cancelado',
  refunded: 'Pago reintegrado',
  charged_back: 'Contracargo',
}

export function PagoTrabajo({
  session,
  workId,
  onUnauthorized,
}: {
  session: TusWebSession
  workId: string
  onUnauthorized: () => void
}): ReactNode {
  const [state, setState] = useState<PreviewState>({
    status: 'loading',
    preview: null,
    message: 'Consultando el estado del pago en TUS.',
  })
  const [action, setAction] = useState<{
    status: 'idle' | 'loading' | 'error' | 'ready'
    message: string
  }>({
    status: 'idle',
    message: '',
  })
  const requestRef = useRef(0)
  const intentKeyRef = useRef<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setState({
      status: 'loading',
      preview: null,
      message: 'Consultando el estado del pago en TUS.',
    })
    try {
      const preview = await client().paymentPreview(session, workId)
      if (requestId !== requestRef.current) return
      setState({ status: 'ready', preview, message: '' })
    } catch (error) {
      if (requestId !== requestRef.current) return
      if (errorStatus(error) === 401) onUnauthorized()
      setState({ status: 'error', preview: null, message: previewErrorMessage(error) })
    }
  }, [onUnauthorized, session, workId])

  useEffect(() => {
    intentKeyRef.current = null
    void load()
  }, [load])

  async function pay(): Promise<void> {
    if (state.status !== 'ready' || !state.preview.paymentAvailable || action.status === 'loading')
      return
    // Same key on retry: a repeated click never creates a second payment.
    intentKeyRef.current ??= createStableIdempotencyKey(
      'work-payment',
      `${workId}:${crypto.randomUUID()}`
    )
    setAction({ status: 'loading', message: 'Iniciando el pago en TUS.' })
    try {
      await client().createWorkPaymentIntent({
        ...session,
        workId,
        idempotencyKey: intentKeyRef.current,
      })
      setAction({
        status: 'ready',
        message: 'TUS registró el pago. Te avisaremos cuando Mercado Pago lo confirme.',
      })
      await load()
    } catch (error) {
      if (errorStatus(error) === 401) onUnauthorized()
      setAction({ status: 'error', message: paymentErrorMessage(error) })
      if (errorStatus(error) === 409 || errorStatus(error) === 503) await load()
    }
  }

  if (state.status !== 'ready') {
    return (
      <TusStateMessage
        state={{
          status: state.status,
          message: state.message,
          resource: 'Pago',
          retry: state.status === 'error' ? () => void load() : undefined,
        }}
      />
    )
  }

  const preview = state.preview
  const total =
    preview.amountMinor !== null && preview.currency !== null
      ? formatMoney(preview.amountMinor, preview.currency)
      : preview.budget
        ? formatMoney(preview.budget.totalMinor, preview.budget.currency)
        : null

  return (
    <section className="tus-state-box" aria-labelledby={`pago-${workId}`}>
      <h4 id={`pago-${workId}`}>Pago</h4>
      <p>Servicio: {preview.serviceName ?? 'Servicio contratado'}</p>
      <p>Prestador: {preview.prestadorId}</p>
      <p>
        Presupuesto aceptado:{' '}
        {preview.budget ? `versión ${preview.budget.version}` : 'no hay presupuesto aceptado'}
      </p>
      <p>
        <strong>Total: {total ?? 'no disponible'}</strong>
      </p>
      <p>Estado del pago: {PAYMENT_STATUS_COPY[preview.paymentStatus] ?? preview.paymentStatus}</p>
      {preview.payable ? null : (
        <p role="status">
          {NOT_PAYABLE_COPY[preview.notPayableReason ?? ''] ??
            'Este trabajo todavía no se puede pagar.'}
        </p>
      )}
      {preview.payable && !preview.paymentAvailable ? (
        <p role="status">
          <strong>Pago online no disponible todavía.</strong> El monto ya está definido por el
          presupuesto aceptado; TUS habilitará el cobro con Mercado Pago más adelante. No se
          registró ningún pago.
        </p>
      ) : null}
      {preview.paymentAvailable ? (
        <TusActionButton
          loading={action.status === 'loading'}
          loadingLabel="Iniciando pago…"
          onClick={() => void pay()}
          type="button"
        >
          Pagar {total}
        </TusActionButton>
      ) : null}
      {action.status === 'idle' ? null : (
        <TusStateMessage
          state={{
            status:
              action.status === 'error'
                ? 'error'
                : action.status === 'loading'
                  ? 'loading'
                  : 'ready',
            message: action.message,
            resource: 'Inicio de pago',
            retry: action.status === 'error' ? () => void pay() : undefined,
          }}
        />
      )}
    </section>
  )
}

function client() {
  return createTusWebClient(createTusWebFetchTransport())
}

function errorStatus(error: unknown): number | undefined {
  return error instanceof TusRequestError ? error.status : undefined
}

function previewErrorMessage(error: unknown): string {
  const status = errorStatus(error)
  if (status === 403) return 'Solo el cliente del trabajo puede ver su pago.'
  if (status === 404) return 'El trabajo no está disponible para esta sesión.'
  if (status === undefined) return 'No pudimos conectar con TUS. Reintentá en unos segundos.'
  return 'TUS no pudo informar el estado del pago. Reintentá.'
}

function paymentErrorMessage(error: unknown): string {
  const code = error instanceof TusRequestError ? error.code : undefined
  if (errorStatus(error) === 503)
    return 'El pago online no está disponible todavía. No se registró ningún pago.'
  if (code === 'IDEMPOTENCY_CONFLICT')
    return 'Este intento ya se usó para otra operación. Recargá la página.'
  if (code && NOT_PAYABLE_COPY[code]) return NOT_PAYABLE_COPY[code]
  if (errorStatus(error) === undefined)
    return 'No pudimos conectar con TUS. Reintentá: no se cobra dos veces.'
  return 'TUS no confirmó el pago. Reintentá: no se cobra dos veces.'
}

const pagoTrabajoModule = { PagoTrabajo }

export default pagoTrabajoModule
