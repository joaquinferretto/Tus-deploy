'use client'

import { useEffect, useState } from 'react'

import { phoneApi, type EstadoTelefonoCuentaWeb } from '../../lib/tus-phone-client'
import { useAccountView } from '../session/use-account-view'
import styles from './help.module.css'

// The ONLY personalised part of a guide: whether the phone of the signed-in account is verified
// and its WhatsApp linked. It is read from the authenticated API in the browser of that person,
// after the page loaded: it is never part of the document, of the public HTML or of any cache.
// Signed out (or if the API does not answer) nothing private is shown: only the action.
export function HelpAccountStatus({ guia }: { guia: 'verificar-celular' | 'vincular-whatsapp' }): React.ReactNode {
  const cuenta = useAccountView()
  const [estado, setEstado] = useState<EstadoTelefonoCuentaWeb | null>(null)

  useEffect(() => {
    if (cuenta.status !== 'signed-in') return
    let cancelado = false
    void phoneApi.miTelefono().then((valor) => { if (!cancelado) setEstado(valor) }).catch(() => undefined)
    return () => { cancelado = true }
  }, [cuenta.status])

  if (cuenta.status !== 'signed-in' || !estado) return null
  const verificado = Boolean(estado.verified)
  const vinculado = verificado && Boolean(estado.whatsappLinked)

  if (guia === 'verificar-celular')
    return (
      <p className={verificado ? styles.statusOk : styles.status} role="status">
        {verificado ? '✓ Tu teléfono ya está verificado.' : 'Tu teléfono todavía no está verificado.'}{' '}
        {verificado ? null : <a href="/mi-perfil">Verificar ahora</a>}
      </p>
    )
  return (
    <p className={vinculado ? styles.statusOk : styles.status} role="status">
      {vinculado ? '✓ Tu WhatsApp ya está vinculado a tu cuenta.' : verificado ? 'Tu teléfono está verificado, pero tu WhatsApp todavía no está vinculado.' : 'Primero tenés que verificar tu teléfono.'}{' '}
      {vinculado ? null : <a href={verificado ? '/mi-perfil?accion=vincular-whatsapp' : '/mi-perfil'}>{verificado ? 'Vincular ahora' : 'Verificar ahora'}</a>}
    </p>
  )
}
