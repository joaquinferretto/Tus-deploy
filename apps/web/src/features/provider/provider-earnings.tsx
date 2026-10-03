'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { mensajeMotivoSinLiquidacion } from '@factory/contracts'

import {
  TusRequestError,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusEarningsMovement,
  type TusPayout,
  type TusProviderEarnings,
} from '../../lib/tus-client'
import { formatMoney } from '../../lib/tus-money'
import type { TusWebSession } from '../../lib/tus-ui-contract'
import { startMercadoPagoConnection } from './provider-payments'
import styles from '../work/work.module.css'

const client = () => createTusWebClient(createTusWebFetchTransport())

const ESTADO_MOVIMIENTO: Record<TusEarningsMovement['status'], string> = {
  available: 'Disponible',
  reserved: 'Reservado',
  processing: 'En proceso',
  paid: 'Pagado',
  adjustment: 'Ajuste',
  failed: 'Fallido',
  cancelled: 'Cancelado',
}

const TIPO_MOVIMIENTO: Record<TusEarningsMovement['kind'], string> = {
  earning: 'Ganancia',
  mercado_pago_fee: 'Tarifa Mercado Pago',
  refund: 'Devolución',
  chargeback: 'Contracargo',
  adjustment: 'Ajuste',
  payout_reserve: 'Solicitud de pago',
  payout_release: 'Liberación',
  payout_completed: 'Pago enviado',
}

const ESTADO_SOLICITUD: Record<TusPayout['status'], string> = {
  requested: 'Solicitada · Pendiente de procesamiento por TUS',
  processing: 'En proceso',
  paid: 'Pagada',
  failed: 'Fallida (el monto volvió a estar disponible)',
  cancelled: 'Cancelada (el monto volvió a estar disponible)',
}

const ERRORES_SOLICITUD: Record<string, string> = {
  PAYOUT_NO_FUNDS: 'Todavía no tenés ganancias disponibles para solicitar.',
  PAYOUT_BELOW_MINIMUM: 'Todavía no llegaste al mínimo para solicitar el pago de tus ganancias.',
  PAYMENT_ACCOUNT_REQUIRED: 'Vinculá tu cuenta de Mercado Pago para retirar tus ganancias.',
  PAYOUT_ALREADY_OPEN: 'Ya tenés una solicitud de pago en proceso.',
  PROVIDER_IDENTITY_NOT_VERIFIED: 'Para solicitar el pago de tus ganancias tu identidad tiene que estar verificada.',
  INVALID_DESTINATION_EMAIL: 'Escribí el email de tu cuenta de Mercado Pago.',
}

// Movements and the available balance are signed (a refund can leave it negative).
function monto(amountMinor: string, currency: string): string {
  return amountMinor.startsWith('-') ? `- ${formatMoney(amountMinor.slice(1), currency)}` : formatMoney(amountMinor, currency)
}

function fecha(value: string): string {
  return new Date(value).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function turno(value: string | null): string {
  return value ? new Date(value).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) : '—'
}

// What happens with an open request, in words the provider can act on.
function textoSolicitud(payout: TusPayout): string {
  if (payout.status === 'requested') return 'TUS tiene que procesarla: el pago todavía no se envió.'
  if (payout.mechanism === 'mercado_pago_payouts') return 'TUS envió la transferencia a tu cuenta de Mercado Pago; esperamos la confirmación de Mercado Pago.'
  return 'TUS está realizando el pago por otro medio y lo va a registrar con su comprobante.'
}

// "Ganancias": what TUS collected for the provider (it had no Mercado Pago linked when the client
// paid) and the provider's payout requests. Everything shown is derived by TUS from its ledger.
export function ProviderEarningsPanel({ session }: { session: TusWebSession }): React.ReactNode {
  const [summary, setSummary] = useState<TusProviderEarnings | null>(null)
  const [history, setHistory] = useState<readonly TusEarningsMovement[]>([])
  const [payouts, setPayouts] = useState<readonly TusPayout[]>([])
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const request = useRef(0)
  // One key per attempt: a retried click after a network failure replays the same request.
  const attempt = useRef<string | null>(null)

  const load = useCallback(async () => {
    const id = ++request.current
    setFailed(false)
    try {
      const [current, movements, requests] = await Promise.all([client().providerEarnings(session), client().providerEarningsHistory(session), client().providerPayouts(session)])
      if (id !== request.current) return
      setSummary(current)
      setHistory(movements.items)
      setPayouts(requests.items)
      setEmail((value) => value || current.lastDestinationEmail || '')
    } catch {
      if (id === request.current) setFailed(true)
    }
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  async function requestPayout(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    attempt.current ??= crypto.randomUUID()
    try {
      await client().requestPayout({ ...session, idempotencyKey: attempt.current, destinationEmail: email.trim() })
      attempt.current = null
      setNotice('Recibimos tu solicitud. Los fondos quedaron reservados y TUS va a procesar el pago a tu cuenta de Mercado Pago.')
      await load()
    } catch (error) {
      if (error instanceof TusRequestError && (error.status ?? 500) < 500) attempt.current = null
      setNotice(
        error instanceof TusRequestError
          ? (ERRORES_SOLICITUD[error.code ?? ''] ?? 'No se pudo solicitar el pago. Reintentá.')
          : 'No se pudo solicitar el pago. Reintentá.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function cancelPayout(payoutId: string) {
    if (busy) return
    setBusy(true)
    try {
      await client().cancelPayout(session, payoutId)
      setNotice('Cancelaste la solicitud. El monto volvió a estar disponible.')
      await load()
    } catch {
      setNotice('No se pudo cancelar la solicitud. Puede que ya esté en proceso.')
    } finally {
      setBusy(false)
    }
  }

  async function connect() {
    if (busy) return
    setBusy(true)
    try {
      const failure = await startMercadoPagoConnection(session)
      if (failure) setNotice(failure)
    } finally {
      setBusy(false)
    }
  }

  const blocked = summary ? mensajeMotivoSinLiquidacion(summary.blockedReason) : null
  return (
    <section className={styles.card} aria-labelledby="pagos-ganancias">
      <h2 id="pagos-ganancias">Ganancias</h2>
      <p>
        Cuando un cliente te paga y todavía no tenés Mercado Pago conectado, TUS cobra por vos, descuenta su comisión y te
        guarda el resto como ganancia. La tarifa de Mercado Pago de ese cobro se descuenta de tu ganancia, igual que cuando
        cobrás con tu cuenta. Podés solicitar el pago cuando quieras, desde el mínimo indicado; TUS lo envía a tu cuenta de
        Mercado Pago.
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {failed ? (
        <p role="alert">
          No pudimos consultar tus ganancias. <button onClick={() => void load()} type="button">Reintentar</button>
        </p>
      ) : !summary ? (
        <p role="status">Consultando tus ganancias…</p>
      ) : (
        <>
          <p>
            Las ganancias disponibles están acumuladas en TUS: todavía no te las transferimos. Se te pagan cuando solicitás el
            retiro y TUS lo completa en tu cuenta de Mercado Pago.
          </p>
          <dl>
            <dt>Total histórico cobrado</dt>
            <dd>{formatMoney(summary.earnedMinor, summary.currency)}</dd>
            <dt>Ganancias disponibles</dt>
            <dd>{summary.negativeMinor !== '0' ? formatMoney('0', summary.currency) : formatMoney(summary.availableMinor, summary.currency)}</dd>
            <dt>En liquidación</dt>
            <dd>{formatMoney((BigInt(summary.reservedMinor) + BigInt(summary.processingMinor)).toString(), summary.currency)}</dd>
            <dt>Pagadas</dt>
            <dd>{formatMoney(summary.paidMinor, summary.currency)}</dd>
            <dt>Saldo negativo</dt>
            <dd>{formatMoney(summary.negativeMinor, summary.currency)}</dd>
            {summary.feesMinor !== '0' ? (
              <>
                <dt>Tarifas de Mercado Pago</dt>
                <dd>{formatMoney(summary.feesMinor, summary.currency)}</dd>
              </>
            ) : null}
            {summary.adjustmentsMinor !== '0' ? (
              <>
                <dt>Devoluciones, contracargos y ajustes</dt>
                <dd>{monto((-BigInt(summary.adjustmentsMinor)).toString(), summary.currency)}</dd>
              </>
            ) : null}
            <dt>Mínimo para solicitar</dt>
            <dd>{formatMoney(summary.minimumPayoutMinor, summary.currency)}</dd>
            <dt>Mercado Pago</dt>
            <dd>{summary.paymentAccountStatus === 'connected' ? 'Conectado' : 'No conectado'}</dd>
          </dl>
          {summary.negativeMinor !== '0' ? (
            <p role="status">
              Tenés un saldo negativo de {formatMoney(summary.negativeMinor, summary.currency)} por devoluciones o contracargos.
              Se descuenta automáticamente de tus próximas ganancias; TUS no te cobra nada aparte.
            </p>
          ) : null}
          {summary.canRequest ? (
            <form onSubmit={(event) => void requestPayout(event)}>
              <label>
                Email de tu cuenta de Mercado Pago
                <input autoComplete="email" disabled={busy} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
              </label>
              <button disabled={busy} type="submit">
                {busy ? 'Solicitando…' : 'Solicitar pago'}
              </button>
            </form>
          ) : blocked ? (
            <p role="status">{blocked}</p>
          ) : null}
          {summary.blockedReason === 'PAYMENT_ACCOUNT_REQUIRED' ? (
            <button disabled={busy} onClick={() => void connect()} type="button">
              Conectar Mercado Pago
            </button>
          ) : null}
          {summary.openPayout ? (
            <p>
              Solicitud por {formatMoney(summary.openPayout.amountMinor, summary.openPayout.currency)} del{' '}
              {fecha(summary.openPayout.createdAt)} a {summary.openPayout.destinationEmail}: {ESTADO_SOLICITUD[summary.openPayout.status]}.{' '}
              {textoSolicitud(summary.openPayout)}{' '}
              {summary.openPayout.status === 'requested' ? (
                <button disabled={busy} onClick={() => void cancelPayout(summary.openPayout!.payoutId)} type="button">
                  Cancelar solicitud
                </button>
              ) : null}
            </p>
          ) : null}
          {payouts.length > 0 ? (
            <>
              <h3>Solicitudes de pago</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Monto</th>
                    <th scope="col">Cuenta de Mercado Pago</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((payout) => (
                    <tr key={payout.payoutId}>
                      <td>{fecha(payout.createdAt)}</td>
                      <td>{formatMoney(payout.amountMinor, payout.currency)}</td>
                      <td>{payout.destinationEmail}</td>
                      <td>{ESTADO_SOLICITUD[payout.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          <h3>Historial</h3>
          {history.length === 0 ? (
            <p>Todavía no tenés movimientos.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Concepto</th>
                  <th scope="col">Servicio</th>
                  <th scope="col">Turno</th>
                  <th scope="col">Importe</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item, index) => (
                  <tr key={`${item.date}-${index}`}>
                    <td>{fecha(item.date)}</td>
                    <td>{TIPO_MOVIMIENTO[item.kind]}</td>
                    <td>{item.concept}</td>
                    <td>{item.service ?? '—'}</td>
                    <td>{turno(item.appointmentAt)}</td>
                    <td>{monto(item.amountMinor, 'ARS')}</td>
                    <td>{ESTADO_MOVIMIENTO[item.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
