'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { createTusWebAuthClient } from '@/lib/tus-auth-client'
import styles from './home.module.css'

const NAV = [
  { href: '/#solicitudes', label: 'Buscar servicios' },
  { href: '/#como-funciona', label: 'Cómo funciona' },
  { href: '/#profesionales', label: 'Para profesionales' },
  { href: '/#ayuda', label: 'Ayuda' },
] as const

type AuthView = { status: 'unknown' } | { status: 'guest' } | { status: 'signed-in'; initial: string }

// The session lives in sessionStorage as a bearer credential; the header only shows "Ir a mi
// panel" after /auth/session confirms it with the server (restore), never from local data alone.
function useAuthView(): AuthView {
  const [view, setView] = useState<AuthView>({ status: 'unknown' })
  useEffect(() => {
    let cancelled = false
    let client: ReturnType<typeof createTusWebAuthClient>
    try {
      client = createTusWebAuthClient()
    } catch {
      // Misconfigured API URL: the public home still works for guests.
      setView({ status: 'guest' })
      return
    }
    void client
      .restore('/tus')
      .then((result) => {
        if (cancelled) return
        if (result.status === 'authenticated' && result.session) setView({ status: 'signed-in', initial: 'Yo' })
        else setView({ status: 'guest' })
      })
      .catch(() => {
        if (!cancelled) setView({ status: 'guest' })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return view
}

export function PublicHeader({ logo }: { logo: React.ReactNode }): React.ReactNode {
  const auth = useAuthView()
  const [open, setOpen] = useState(false)

  const actions =
    auth.status === 'signed-in' ? (
      <Link className={styles.buttonPrimary} href="/tus">
        <span className={styles.avatar} aria-hidden="true">
          {auth.initial}
        </span>
        Ir a mi panel
      </Link>
    ) : (
      <>
        <Link className={styles.buttonSecondary} href="/sign-in">
          Iniciar sesión
        </Link>
        <Link className={styles.buttonPrimary} href="/registro">
          Registrarse
        </Link>
      </>
    )

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link aria-label="TUS, inicio" className={styles.brandLink} href="/">
          {logo}
        </Link>
        <nav aria-label="Navegación principal" className={styles.nav}>
          {NAV.map((item) => (
            <a href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className={styles.headerActions}>
          {actions}
          <button
            aria-controls="menu-movil"
            aria-expanded={open}
            className={`${styles.buttonSecondary} ${styles.menuButton}`}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? 'Cerrar' : 'Menú'}
          </button>
        </div>
      </div>
      {open ? (
        <nav aria-label="Menú" className={styles.mobileMenu} id="menu-movil">
          {NAV.map((item) => (
            <a href={item.href} key={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          {auth.status === 'signed-in' ? (
            <Link className={styles.buttonPrimary} href="/tus">
              Ir a mi panel
            </Link>
          ) : (
            <>
              <Link className={styles.buttonSecondary} href="/sign-in">
                Iniciar sesión
              </Link>
              <Link className={styles.buttonPrimary} href="/registro">
                Registrarse
              </Link>
            </>
          )}
        </nav>
      ) : null}
    </header>
  )
}
