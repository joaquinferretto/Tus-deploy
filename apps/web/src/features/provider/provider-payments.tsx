'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  CALLBACK_ERRORS,
  STATUS_COPY,
  isMercadoPagoAuthorizationUrl,
} from '../../components/prestador/cuenta-cobro'
import {
  TusRequestError,
  createTusWebClient,
  createTusWebFetchTransport,
  type TusPaymentAccount,
} from '../../lib/tus-client'
import type { TusWebSession } from '../../lib/tus-ui-contract'
import { useTusSession } from '../session/use-tus-session'
import { maskAccountId } from './payment-account-mask'
import styles from '../work/work.module.css'

const RETURN_TO = '/prestador/pagos'
const client = () => createTusWebClient(createTusWebFetchTransport())

// Provider "Pagos": link their own Mercado Pago account via OAuth (the API redirects the browser
// to Mercado Pago). Without it the provider keeps using TUS; only online charging is blocked.
export function ProviderPayments(): React.ReactNode {
  const auth = useTusSession(RETURN_TO)
  useEffect(() => {
    if (auth.status === 'guest')
      window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [auth.status])
  if (auth.status !== 'authenticated')
    return (
      <p role="status">
        {auth.status === 'unavailable' ? 'No pudimos conectar con TUS. Volvé a intentar.' : 'Verificando tu sesión…'}
      </p>
    )
  return <PaymentAccountPanel session={auth.session} />
}

export function PaymentAccountPanel({ session }: { session: TusWebSession }): React.ReactNode {
  const [account, setAccount] = useState<TusPaymentAccount | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)

  const load = useCallback(async () => {
    const id = ++request.current
    setFailed(false)
    try {
      const current = await client().paymentAccount(session)
      if (id === request.current) setAccount(current)
    } catch {
      if (id === request.current) setFailed(true)
    }
  }, [session])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('mercadoPago')
    if (result === 'connected') setNotice('Mercado Pago quedó conectado a TUS.')
    if (result === 'error')
      setNotice(CALLBACK_ERRORS[params.get('reason') ?? ''] ?? 'No se pudo conectar Mercado Pago.')
    void load()
  }, [load])

  async function connect() {
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
      setNotice(
        error instanceof TusRequestError && error.code === 'PROVIDER_IDENTITY_NOT_VERIFIED'
          ? 'Primero completá la verificación de identidad. Después vas a poder conectar Mercado Pago.'
          : error instanceof TusRequestError && error.status === 503
            ? 'La conexión con Mercado Pago todavía no está habilitada en TUS.'
            : 'No se pudo iniciar la conexión con Mercado Pago. Reintentá.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (busy || !window.confirm('¿Desconectar tu cuenta de Mercado Pago? No vas a poder cobrar online hasta reconectarla.')) return
    setBusy(true)
    try {
      setAccount(await client().disconnectPaymentAccount(session))
      setNotice('La cuenta quedó desconectada en TUS. Podés revocar el acceso también desde Mercado Pago.')
    } catch {
      setNotice('No se pudo desconectar la cuenta. Reintentá.')
    } finally {
      setBusy(false)
    }
  }

  const connected = account?.status === 'connected'
  return (
    <section className={styles.card} aria-labelledby="pagos-mercado-pago">
      <h2 id="pagos-mercado-pago">Mercado Pago</h2>
      <p>
        Los clientes pagan con Mercado Pago y el dinero se acredita en tu cuenta; TUS retiene su comisión. Nunca te
        pedimos contraseñas, tokens ni CBU: la autorización se hace en Mercado Pago.
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {failed ? (
        <p role="alert">
          No pudimos consultar tu cuenta de cobro. <button onClick={() => void load()} type="button">Reintentar</button>
        </p>
      ) : !account ? (
        <p role="status">Consultando tu cuenta de cobro…</p>
      ) : (
        <>
          <p>
            <strong>{connected ? 'Conectado' : account.status === 'not_connected' ? 'No conectado' : (STATUS_COPY[account.status] ?? 'No conectado')}</strong>
          </p>
          {connected && account.externalAccountId ? <p>Cuenta {maskAccountId(account.externalAccountId)}</p> : null}
          {connected && account.liveMode === false ? <p>Modo de prueba (sandbox).</p> : null}
          {!connected ? <p>Podés seguir usando TUS, pero no vas a poder cobrar trabajos online hasta conectar Mercado Pago.</p> : null}
          {connected ? (
            <button disabled={busy} onClick={() => void disconnect()} type="button">
              Desconectar
            </button>
          ) : account.connectAvailable ? (
            <button disabled={busy} onClick={() => void connect()} type="button">
              {busy ? 'Conectando…' : account.status === 'expired' || account.status === 'error' ? 'Reconectar Mercado Pago' : 'Conectar Mercado Pago'}
            </button>
          ) : (
            <p role="status">La conexión con Mercado Pago todavía no está habilitada en TUS.</p>
          )}
        </>
      )}
    </section>
  )
}
