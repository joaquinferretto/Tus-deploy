'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  TusRequestError,
  createStableIdempotencyKey,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusPaymentPreview,
} from '@/lib/tus-client'
import { esUrlCheckoutMercadoPago, formatMoney } from '@/lib/tus-money'
import { type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

// WEB-09D/E: payment block of a completed service. Every amount comes from TUS; the Web only
// formats the minor-unit string it receives and never sends money back. Returning from Mercado
// Pago never confirms a payment: only the server state (verified webhook) does.

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

const UNAVAILABLE_COPY: Record<string, string> = {
  PROVIDER_ACCOUNT_NOT_CONNECTED:
    'El prestador todavía no conectó su cuenta de Mercado Pago. Podés coordinar el pago con él.',
}

const PAYMENT_STATUS_COPY: Record<string, string> = {
  not_started: 'Sin pago iniciado',
  pending: 'Pago pendiente de confirmación',
  approved: 'Pago confirmado',
  rejected: 'Pago rechazado',
  expired: 'Pago vencido',
  cancelled: 'Pago cancelado',
  refunded: 'Pago reintegrado',
  charged_back: 'Contracargo',
}

const CONFIRMATION_POLL_MS = 4_000
const CONFIRMATION_MAX_ATTEMPTS = 30

export function PagoTrabajo({
  session,
  workId,
  onUnauthorized,
  returningFromCheckout = false,
}: {
  session: TusWebSession
  workId: string
  onUnauthorized: () => void
  returningFromCheckout?: boolean
}): ReactNode {
  const [state, setState] = useState<PreviewState>({
    status: 'loading',
    preview: null,
    message: 'Consultando el estado del pago en TUS.',
  })
  const [action, setAction] = useState<{
    status: 'idle' | 'loading' | 'error' | 'ready'
    message: string
  }>({ status: 'idle', message: '' })
  const [confirming, setConfirming] = useState(returningFromCheckout)
  const requestRef = useRef(0)
  const intentKeyRef = useRef<string | null>(null)

  const load = useCallback(async (): Promise<TusPaymentPreview | null> => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    try {
      const preview = await client().paymentPreview(session, workId)
      if (requestId !== requestRef.current) return null
      setState({ status: 'ready', preview, message: '' })
      return preview
    } catch (error) {
      if (requestId !== requestRef.current) return null
      if (errorStatus(error) === 401) onUnauthorized()
      setState({ status: 'error', preview: null, message: previewErrorMessage(error) })
      return null
    }
  }, [onUnauthorized, session, workId])

  useEffect(() => {
    intentKeyRef.current = null
    void load()
  }, [load])

  // After the redirect back from Mercado Pago, poll TUS until a verified notification arrives.
  useEffect(() => {
    if (!confirming) return
    let cancelled = false
    let attempts = 0
    const tick = async () => {
      if (cancelled) return
      attempts += 1
      const preview = await load()
      if (cancelled) return
      if (preview?.paymentStatus === 'approved' || attempts >= CONFIRMATION_MAX_ATTEMPTS) {
        setConfirming(false)
        return
      }
      setTimeout(() => void tick(), CONFIRMATION_POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [confirming, load])

  async function pay(): Promise<void> {
    if (state.status !== 'ready' || !state.preview.paymentAvailable || action.status === 'loading')
      return
    // Same key on retry: a repeated click reuses the same checkout and never charges twice.
    intentKeyRef.current ??= createStableIdempotencyKey(
      'work-checkout',
      `${workId}:${crypto.randomUUID()}`
    )
    setAction({ status: 'loading', message: 'Preparando el pago con Mercado Pago.' })
    try {
      const checkout = await client().startWorkCheckout({
        ...session,
        workId,
        idempotencyKey: intentKeyRef.current,
      })
      if (!esUrlCheckoutMercadoPago(checkout.checkoutUrl)) {
        setAction({ status: 'error', message: 'TUS devolvió una dirección de pago no válida.' })
        return
      }
      window.location.assign(checkout.checkoutUrl)
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
  const approved = preview.paymentStatus === 'approved'
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
        <strong>
          {approved ? 'Total pagado' : 'Total'}: {total ?? 'no disponible'}
        </strong>
      </p>
      <p>Estado del pago: {PAYMENT_STATUS_COPY[preview.paymentStatus] ?? preview.paymentStatus}</p>
      {approved ? (
        <p role="status">
          <strong>Pago confirmado.</strong>
          {preview.paymentReference
            ? ` Comprobante de Mercado Pago: ${preview.paymentReference}.`
            : null}
        </p>
      ) : confirming ? (
        <p role="status" aria-busy="true">
          <strong>Estamos confirmando tu pago.</strong> Mercado Pago nos avisará en unos segundos;
          no hace falta que vuelvas a pagar.
        </p>
      ) : null}
      {!approved && preview.lastAttemptFailed ? (
        <p role="status">El último intento de pago fue rechazado. Podés volver a intentarlo.</p>
      ) : null}
      {preview.payable || approved ? null : (
        <p role="status">
          {NOT_PAYABLE_COPY[preview.notPayableReason ?? ''] ??
            'Este trabajo todavía no se puede pagar.'}
        </p>
      )}
      {preview.payable && !preview.paymentAvailable ? (
        <p role="status">
          <strong>Pago online no disponible todavía.</strong>{' '}
          {UNAVAILABLE_COPY[preview.unavailableReason ?? ''] ??
            'El monto ya está definido por el presupuesto aceptado; TUS habilitará el cobro con Mercado Pago más adelante. No se registró ningún pago.'}
        </p>
      ) : null}
      {preview.paymentAvailable && !approved ? (
        <TusActionButton
          loading={action.status === 'loading'}
          loadingLabel="Abriendo Mercado Pago…"
          onClick={() => void pay()}
          type="button"
        >
          Pagar con Mercado Pago
        </TusActionButton>
      ) : null}
      {action.status === 'idle' || action.status === 'loading' ? null : (
        <TusStateMessage
          state={{
            status: action.status === 'error' ? 'error' : 'ready',
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
  if (code === 'IN_PROGRESS') return 'Estamos preparando tu pago. Reintentá en unos segundos.'
  if (code === 'PROVIDER_ACCOUNT_NOT_CONNECTED')
    return 'El prestador necesita reconectar su cuenta de Mercado Pago.'
  if (errorStatus(error) === 503)
    return 'El pago online no está disponible todavía. No se registró ningún pago.'
  if (code === 'IDEMPOTENCY_CONFLICT')
    return 'Este intento ya se usó para otra operación. Recargá la página.'
  if (code && NOT_PAYABLE_COPY[code]) return NOT_PAYABLE_COPY[code]
  if (errorStatus(error) === undefined)
    return 'No pudimos conectar con TUS. Reintentá: no se cobra dos veces.'
  return 'Mercado Pago no pudo preparar el pago. Reintentá: no se cobra dos veces.'
}

const pagoTrabajoModule = { PagoTrabajo }

export default pagoTrabajoModule
