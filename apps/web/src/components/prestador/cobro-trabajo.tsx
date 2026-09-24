'use client'

import { useEffect, useState, type ReactNode } from 'react'

import {
  TusRequestError,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusWorkFinanceResponse,
} from '@/lib/tus-client'
import { formatMoney } from '@/lib/tus-money'
import { type TusWebSession } from '@/lib/tus-ui-contract'
import { TusStateMessage } from '../../app/tus/tus-ui'

// WEB-09E provider view of a paid service: gross, TUS commission, Mercado Pago cost (once
// reported by Mercado Pago) and the resulting net. Values are server snapshots; the Web does no
// arithmetic and never promises when the money becomes available.
export function CobroTrabajo({
  session,
  workId,
  onUnauthorized,
}: {
  session: TusWebSession
  workId: string
  onUnauthorized: () => void
}): ReactNode {
  const [finance, setFinance] = useState<TusWorkFinanceResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    createTusWebClient(createTusWebFetchTransport())
      .workFinance(session, workId)
      .then((value) => {
        if (!cancelled) setFinance(value)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        if (reason instanceof TusRequestError && reason.status === 401) onUnauthorized()
        setError('No pudimos consultar el cobro de este trabajo.')
      })
    return () => {
      cancelled = true
    }
  }, [onUnauthorized, session, workId])

  if (error)
    return <TusStateMessage state={{ status: 'error', message: error, resource: 'Cobro' }} />
  if (!finance) return null
  const approved = finance.payments.find((payment) => payment.providerStatus === 'approved')
  const commission = finance.commission
  const currency = commission?.currency ?? finance.obligation?.currency ?? 'ARS'
  const money = (value: string | null | undefined, missing: string) =>
    value === null || value === undefined ? missing : formatMoney(value, currency)

  return (
    <section className="tus-prestador-panel" aria-labelledby={`cobro-${workId}`}>
      <div className="tus-section-label">
        <span>05</span>
        <h3 id={`cobro-${workId}`}>Cobro.</h3>
      </div>
      {!approved || !commission ? (
        <p>
          {finance.obligation
            ? 'El cliente todavía no tiene un pago confirmado por Mercado Pago.'
            : 'Todavía no hay un pago para este trabajo.'}
        </p>
      ) : (
        <dl className="tus-prestador-listings">
          <dt>Importe del servicio</dt>
          <dd>{money(commission.grossMinor, 'no disponible')}</dd>
          <dt>Comisión TUS ({(commission.rateBps / 100).toFixed(2)}%)</dt>
          <dd>{money(commission.commissionMinor, 'no disponible')}</dd>
          <dt>Costo Mercado Pago</dt>
          <dd>{money(commission.pspFeeMinor, 'pendiente de informar por Mercado Pago')}</dd>
          <dt>Neto para vos</dt>
          <dd>
            {money(commission.providerNetMinor, 'se calcula cuando Mercado Pago informe su costo')}
          </dd>
          <dt>Estado</dt>
          <dd>
            Pago confirmado
            {approved.providerReference ? ` (Mercado Pago ${approved.providerReference})` : ''}.
            Mercado Pago acredita el dinero en tu cuenta según sus plazos.
          </dd>
        </dl>
      )}
    </section>
  )
}

const cobroTrabajoModule = { CobroTrabajo }

export default cobroTrabajoModule
