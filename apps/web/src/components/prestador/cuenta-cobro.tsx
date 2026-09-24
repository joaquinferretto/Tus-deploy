'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  TusRequestError,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusPaymentAccount,
} from '@/lib/tus-client'
import { type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

// WEB-09D: the provider links their own Mercado Pago account (OAuth). TUS never shows or
// receives tokens in the browser; it only redirects to Mercado Pago's authorization page.

const STATUS_COPY: Record<string, string> = {
  not_connected: 'No conectado',
  connected: 'Conectado',
  revoked: 'Desconectado',
  expired: 'Requiere reconexión: la autorización de Mercado Pago venció',
  error: 'Error: la cuenta de Mercado Pago cambió; volvé a conectarla',
}

const CALLBACK_ERRORS: Record<string, string> = {
  INVALID_STATE: 'La autorización venció o ya fue usada. Iniciá la conexión otra vez.',
  PROVIDER_NOT_CONFIGURED: 'TUS todavía no tiene Mercado Pago configurado.',
  PROVIDER_OAUTH_FAILED: 'Mercado Pago no confirmó la autorización. Reintentá.',
}

export function CuentaCobro({
  session,
  onUnauthorized,
}: {
  session: TusWebSession
  onUnauthorized: () => void
}): ReactNode {
  const [account, setAccount] = useState<TusPaymentAccount | null>(null)
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; message: string }>({
    status: 'loading',
    message: 'Consultando la cuenta de cobro en TUS.',
  })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const requestRef = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setState({ status: 'loading', message: 'Consultando la cuenta de cobro en TUS.' })
    try {
      const current = await client().paymentAccount(session)
      if (requestId !== requestRef.current) return
      setAccount(current)
      setState({ status: 'ready', message: '' })
    } catch (error) {
      if (requestId !== requestRef.current) return
      if (errorStatus(error) === 401) onUnauthorized()
      setState({
        status: 'error',
        message:
          errorStatus(error) === 403
            ? 'Esta sesión no puede administrar cobros del prestador.'
            : 'No pudimos consultar la cuenta de cobro. Reintentá.',
      })
    }
  }, [onUnauthorized, session])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('mercadoPago')
    if (result === 'connected') setNotice('Mercado Pago quedó conectado a TUS.')
    if (result === 'error')
      setNotice(CALLBACK_ERRORS[params.get('reason') ?? ''] ?? 'No se pudo conectar Mercado Pago.')
    void load()
  }, [load])

  async function connect(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const { authorizationUrl } = await client().connectPaymentAccount(session)
      if (!isMercadoPagoAuthorizationUrl(authorizationUrl)) {
        setNotice('TUS devolvió una dirección de autorización no válida.')
        return
      }
      window.location.assign(authorizationUrl)
    } catch (error) {
      if (errorStatus(error) === 401) onUnauthorized()
      setNotice(
        error instanceof TusRequestError && error.code === 'PROVIDER_IDENTITY_NOT_VERIFIED'
          ? 'Primero completá la verificación de identidad. Después vas a poder conectar Mercado Pago.'
          : errorStatus(error) === 503
            ? 'La conexión con Mercado Pago todavía no está habilitada en TUS.'
            : 'No se pudo iniciar la conexión con Mercado Pago. Reintentá.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      setAccount(await client().disconnectPaymentAccount(session))
      setNotice(
        'La cuenta quedó desconectada en TUS. Podés revocar el acceso también desde Mercado Pago.'
      )
    } catch (error) {
      if (errorStatus(error) === 401) onUnauthorized()
      setNotice('No se pudo desconectar la cuenta. Reintentá.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="provider-payment-account-title">
      <div className="tus-section-label">
        <span>03</span>
        <h2 id="provider-payment-account-title">Cobros con Mercado Pago.</h2>
      </div>
      <p className="tus-evidence-line">
        Los clientes pagan con Mercado Pago y el dinero se acredita en tu propia cuenta; TUS retiene
        su comisión. Nunca te pedimos contraseñas ni claves: la autorización se hace en Mercado
        Pago.
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {state.status !== 'ready' || !account ? (
        <TusStateMessage
          state={{
            status: state.status === 'ready' ? 'loading' : state.status,
            message: state.message,
            resource: 'Cuenta de cobro',
            retry: state.status === 'error' ? () => void load() : undefined,
          }}
        />
      ) : (
        <div className="tus-state-box">
          <p>
            <strong>{STATUS_COPY[account.status] ?? account.status}</strong>
          </p>
          {account.externalAccountId ? (
            <p>Cuenta Mercado Pago: {account.externalAccountId}</p>
          ) : null}
          {account.liveMode === false ? <p>Modo de prueba (sandbox).</p> : null}
          {account.status === 'connected' ? (
            <TusActionButton loading={busy} onClick={() => void disconnect()} type="button">
              Desconectar
            </TusActionButton>
          ) : account.connectAvailable ? (
            <TusActionButton
              loading={busy}
              loadingLabel="Conectando…"
              onClick={() => void connect()}
              type="button"
            >
              {account.status === 'expired' || account.status === 'error'
                ? 'Reconectar Mercado Pago'
                : 'Conectar Mercado Pago'}
            </TusActionButton>
          ) : (
            <p role="status">
              La conexión con Mercado Pago todavía no está habilitada en TUS. Tus servicios siguen
              publicados; el cobro online se activará más adelante.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function isMercadoPagoAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && /(^|\.)mercadopago\.com(\.[a-z]{2})?$/u.test(url.hostname)
  } catch {
    return false
  }
}

function client() {
  return createTusWebClient(createTusWebFetchTransport())
}

function errorStatus(error: unknown): number | undefined {
  return error instanceof TusRequestError ? error.status : undefined
}

const cuentaCobroModule = { CuentaCobro }

export default cuentaCobroModule
