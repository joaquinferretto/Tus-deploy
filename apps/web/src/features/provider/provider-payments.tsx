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
import { ProviderEarningsPanel } from './provider-earnings'
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
  return (
    <>
      <PaymentAccountPanel session={auth.session} />
      <ProviderEarningsPanel session={auth.session} />
    </>
  )
}

// Shared by the Mercado Pago and the earnings panels: starts the OAuth link in Mercado Pago.
export async function startMercadoPagoConnection(session: TusWebSession): Promise<string | null> {
  try {
    const { authorizationUrl } = await client().connectPaymentAccount(session)
    if (!isMercadoPagoAuthorizationUrl(authorizationUrl)) return 'TUS devolvió una dirección de autorización no válida.'
    window.location.assign(authorizationUrl)
    return null
  } catch (error) {
    return error instanceof TusRequestError && error.status === 503
      ? 'La vinculación con Mercado Pago todavía no está habilitada en TUS.'
      : 'No se pudo iniciar la vinculación con Mercado Pago. Reintentá.'
  }
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
    if (result === 'connected') setNotice('Mercado Pago vinculado.')
    if (result === 'error')
      setNotice(CALLBACK_ERRORS[params.get('reason') ?? ''] ?? 'No se pudo vincular Mercado Pago.')
    void load()
  }, [load])

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

  async function disconnect() {
    if (busy || !window.confirm('¿Desvincular tu Mercado Pago? Vas a seguir cobrando por TUS, pero no vas a poder retirar tu saldo hasta volver a vincularlo.')) return
    setBusy(true)
    try {
      setAccount(await client().disconnectPaymentAccount(session))
      setNotice('Mercado Pago quedó desvinculado de TUS. Podés revocar el acceso también desde Mercado Pago.')
    } catch {
      setNotice('No se pudo desvincular la cuenta. Reintentá.')
    } finally {
      setBusy(false)
    }
  }

  const connected = account?.status === 'connected'
  return (
    <section className={styles.card} aria-labelledby="pagos-mercado-pago">
      <h2 id="pagos-mercado-pago">Mercado Pago</h2>
      <p>
        Tus clientes te pagan por TUS aunque no tengas Mercado Pago vinculado: tu parte queda en tu saldo. Vinculá
        Mercado Pago para retirar tus ganancias. Es un paso: te llevamos a Mercado Pago, autorizás a TUS y volvés.
        Nunca te pedimos contraseñas, tokens ni claves.
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
            <strong data-mercado-pago={connected ? 'vinculado' : account.status === 'expired' || account.status === 'error' ? 'requiere_reconexion' : 'no_vinculado'}>{STATUS_COPY[account.status] ?? 'Mercado Pago sin vincular'}</strong>
          </p>
          {connected && account.liveMode === false ? <p>Modo de prueba (sandbox).</p> : null}
          {!connected ? <p>Podés trabajar y cobrar igual. Solo vas a necesitar Mercado Pago vinculado para retirar tu saldo.</p> : null}
          {connected ? (
            <button disabled={busy} onClick={() => void disconnect()} type="button">
              Desvincular
            </button>
          ) : account.connectAvailable ? (
            <button disabled={busy} onClick={() => void connect()} type="button">
              {busy ? 'Abriendo Mercado Pago…' : account.status === 'not_connected' ? 'Vincular Mercado Pago para retirar tus ganancias' : 'Volver a vincular Mercado Pago'}
            </button>
          ) : (
            <p role="status">La vinculación con Mercado Pago todavía no está habilitada en TUS.</p>
          )}
        </>
      )}
    </section>
  )
}
