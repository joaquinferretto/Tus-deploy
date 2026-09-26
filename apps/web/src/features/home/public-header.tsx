'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { withReturnTo } from '../auth/auth-validation'

import { createTusWebAuthClient } from '@/lib/tus-auth-client'
import styles from './home.module.css'

// Two ways to find help: the assistant ("no sé a quién necesito") and the directory ("quiero un
// electricista"). Both end in the same TUS service request.
const NAV = [
  { href: '/asistente', label: 'Buscar servicios' },
  { href: '/trabajadores', label: 'Buscar trabajador' },
  { href: '/#como-funciona', label: 'Cómo funciona' },
  { href: '/#profesionales', label: 'Para profesionales' },
  { href: '/#ayuda', label: 'Ayuda' },
] as const

type AuthView =
  { status: 'unknown' } | { status: 'guest' } | { status: 'signed-in'; initial: string }

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
        if (result.status === 'authenticated' && result.session)
          setView({ status: 'signed-in', initial: 'Yo' })
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
  const pathname = usePathname() ?? '/'
  // From the assistant or a worker profile, signing in comes back to the same screen.
  const back = pathname === '/' ? null : pathname
  const signInHref = withReturnTo('/sign-in', back) as Route
  const registerHref = withReturnTo('/registro', back) as Route
  const current = (href: string) =>
    href !== '/' && !href.startsWith('/#') && (pathname === href || pathname.startsWith(`${href}/`))
      ? 'page'
      : undefined

  const actions =
    auth.status === 'signed-in' ? (
      <>
        <Link className={styles.buttonSecondary} href={'/mi-perfil' as Route}>
          Mi perfil
        </Link>
        <Link className={styles.buttonPrimary} href="/mi-perfil">
          <span className={styles.avatar} aria-hidden="true">
            {auth.initial}
          </span>
          Ir a mi panel
        </Link>
      </>
    ) : (
      <>
        <Link className={styles.buttonSecondary} href={signInHref}>
          Iniciar sesión
        </Link>
        <Link className={styles.buttonPrimary} href={registerHref}>
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
            <a aria-current={current(item.href)} href={item.href} key={item.href}>
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
            <a
              aria-current={current(item.href)}
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
          {auth.status === 'signed-in' ? (
            <>
              <Link className={styles.buttonSecondary} href={'/mi-perfil' as Route}>
                Mi perfil
              </Link>
              <Link className={styles.buttonPrimary} href="/mi-perfil">
                Ir a mi panel
              </Link>
            </>
          ) : (
            <>
              <Link className={styles.buttonSecondary} href={signInHref}>
                Iniciar sesión
              </Link>
              <Link className={styles.buttonPrimary} href={registerHref}>
                Registrarse
              </Link>
            </>
          )}
        </nav>
      ) : null}
    </header>
  )
}
