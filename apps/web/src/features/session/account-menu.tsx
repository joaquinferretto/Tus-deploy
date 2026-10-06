'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { MODE_LABEL, canSwitchMode, createTusWebAuthClient, homeOfMode, modeOf, type TusAccountCapabilities, type TusMode } from '@/lib/tus-auth-client'

import styles from '../home/home.module.css'
import { refreshAccountView } from './use-account-view'

// The account menu, shared by every mode: the account, the switch between Cliente and Prestador
// (one click away, discreet) and the sign-out. The switch only exists for an account that really
// has both modes — the API decides — and the platform administration is outside of it.
// `inline`: the same entries laid out flat, for the mobile menu.

// Asks the API for the mode and, when it accepts, goes to the home of that mode with a full load:
// the session is read again and the right navigation is drawn from the start.
export async function cambiarModo(mode: TusMode): Promise<boolean> {
  const aceptado = await createTusWebAuthClient().setMode(mode)
  if (aceptado !== mode) {
    // The API refused (the provider side is not available any more): show what is true now.
    await refreshAccountView()
    return false
  }
  window.location.assign(homeOfMode(mode))
  return true
}

export function AccountMenu({ capabilities, inline = false, onSignOut }: { capabilities: TusAccountCapabilities; inline?: boolean; onSignOut: () => void }): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      boton.current?.focus()
    }
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  const admin = capabilities.platformAdmin
  const modo = admin ? null : modeOf(capabilities)
  const otro: TusMode | null = !admin && canSwitchMode(capabilities) ? (modo === 'PROVIDER' ? 'CLIENT' : 'PROVIDER') : null
  const suspendido = !admin && capabilities.providerStatus === 'suspended'

  async function cambiar(destino: TusMode) {
    setBusy(true)
    setAviso(null)
    const cambiado = await cambiarModo(destino)
    if (!cambiado) {
      setBusy(false)
      setAviso(destino === 'PROVIDER' ? 'El modo prestador no está disponible para tu cuenta en este momento.' : 'No pudimos cambiar de modo. Probá de nuevo.')
    }
  }

  const entradas = (
    <>
      {/* In the mobile menu "Mi perfil" is already one of the links above. */}
      {inline ? null : (
        <li>
          <Link data-cuenta="mi-cuenta" href="/mi-perfil" onClick={() => setOpen(false)}>Mi cuenta</Link>
        </li>
      )}
      {otro ? (
        <li>
          <button className={styles.navButton} data-cambiar-modo={otro} disabled={busy} onClick={() => void cambiar(otro)} type="button">
            {busy ? 'Cambiando…' : otro === 'CLIENT' ? 'Cambiar a modo cliente' : 'Cambiar a modo prestador'}
          </button>
        </li>
      ) : null}
      {suspendido ? (
        <li>
          <span data-prestador-suspendido role="note">Perfil de prestador suspendido</span>
        </li>
      ) : null}
      {aviso ? (
        <li>
          <span role="alert">{aviso}</span>
        </li>
      ) : null}
      <li>
        <button className={styles.navButton} data-cuenta="salir" onClick={onSignOut} type="button">Cerrar sesión</button>
      </li>
    </>
  )

  if (inline)
    return (
      <div data-menu-cuenta="movil">
        {modo ? <p className={styles.modeLine} data-modo-activo={modo}>Modo actual: <strong>{MODE_LABEL[modo]}</strong></p> : null}
        <ul className={styles.accountListInline}>{entradas}</ul>
      </div>
    )

  return (
    <div className={styles.helpMenu} data-menu-cuenta="escritorio" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }} ref={ref}>
      <button aria-controls="menu-cuenta" aria-expanded={open} className={`${styles.buttonSecondary} ${styles.accountButton}`} onClick={() => setOpen((value) => !value)} ref={boton} type="button">
        <span>Mi cuenta</span>
        {modo ? <span className={styles.modeChip} data-modo-activo={modo}>{MODE_LABEL[modo]}</span> : null}
      </button>
      {open ? (
        <ul className={`${styles.helpList} ${styles.accountList}`} id="menu-cuenta">
          {entradas}
        </ul>
      ) : null}
    </div>
  )
}
