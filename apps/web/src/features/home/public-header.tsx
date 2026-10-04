'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { accountLinks, createTusWebAuthClient } from '@/lib/tus-auth-client'
import { withReturnTo } from '../auth/auth-validation'

import { useAccountView } from '../session/use-account-view'
import { HowItWorksDialog } from './how-it-works'
import styles from './home.module.css'

// The home (map + service search + assistant) is where services AND lodgings are searched (the
// map's type selector); the directory lists workers. "¿Cómo funciona?" is a dialog, not a
// destination. The logo always goes home.
const NAV = [
  { href: '/', label: 'Buscar servicios' },
  { href: '/trabajadores', label: 'Buscar trabajador' },
  { href: '/#profesionales', label: 'Para profesionales' },
] as const

// "Ayuda" is the Help Center: on desktop a compact menu with the guides people look for most, on
// mobile plain links inside the menu. The assistant (the chat) is one of its entries.
const AYUDA = [
  { href: '/ayuda', label: 'Centro de ayuda' },
  { href: '/ayuda/empezar', label: 'Empezar en TUS' },
  { href: '/ayuda/verificar-celular', label: 'Verificar celular' },
  { href: '/ayuda/vincular-whatsapp', label: 'Vincular WhatsApp' },
  { href: '/ayuda/solicitudes', label: 'Solicitudes' },
  { href: '/ayuda/turnos', label: 'Turnos' },
  { href: '/ayuda/pagos', label: 'Pagos y señas' },
  { href: '/asistente', label: 'Preguntarle al asistente' },
] as const
const MANUAL_PRESTADOR = { href: '/ayuda/prestadores', label: 'Manual del prestador' } as const

// "Solicitudes" goes to the REAL page of requests for whoever is looking: the provider's inbox,
// the client's own requests, or the form to publish one.
const solicitudesPara = (auth: ReturnType<typeof useAccountView>): string =>
  auth.status !== 'signed-in' ? '/publicar' : auth.capabilities.provider ? '/prestador/solicitudes' : auth.capabilities.platformAdmin ? '/tus/admin/solicitudes' : '/mis-solicitudes'

export function PublicHeader({ logo }: { logo: React.ReactNode }): React.ReactNode {
  // Session and REAL role come from the API; "Ir a mi panel" goes to that role's dashboard.
  const auth = useAccountView()
  const [open, setOpen] = useState(false)
  const [howOpen, setHowOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const helpRef = useRef<HTMLDivElement>(null)
  const helpButton = useRef<HTMLButtonElement>(null)
  const pathname = usePathname() ?? '/'
  // The help menu closes with Escape (the focus goes back to its button) and when the focus or a
  // click leaves it.
  useEffect(() => {
    if (!helpOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHelpOpen(false)
      helpButton.current?.focus()
    }
    const onPointer = (event: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) setHelpOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [helpOpen])
  const esPrestador = auth.status === 'signed-in' && auth.capabilities.provider === true
  const ayuda = esPrestador ? [AYUDA[0], MANUAL_PRESTADOR, ...AYUDA.slice(1)] : AYUDA
  const solicitudes = solicitudesPara(auth)
  // From the assistant or a worker profile, signing in comes back to the same screen.
  const back = pathname === '/' ? null : pathname
  const signInHref = withReturnTo('/sign-in', back) as Route
  const registerHref = withReturnTo('/registro', back) as Route
  const current = (href: string) =>
    href === '/'
      ? pathname === '/' ? 'page' : undefined
      : !href.startsWith('/#') && (pathname === href || pathname.startsWith(`${href}/`))
        ? 'page'
        : undefined

  async function signOut() {
    await createTusWebAuthClient().signOut().catch(() => undefined)
    window.location.assign('/')
  }

  // Account links follow the REAL capabilities (a platform administration account has no
  // "Mis trabajos"): the same list for the desktop header and the mobile menu.
  const links = auth.status === 'signed-in' ? accountLinks(auth.capabilities) : []

  const actions =
    auth.status === 'unknown' ? (
      <span aria-label="Comprobando sesión" className={styles.sessionLoading} role="status" />
    ) : auth.status === 'signed-in' ? (
      <>
        {links.filter((link) => !link.soloMenu).map((link) => (
          <Link className={link.primary ? styles.buttonPrimary : styles.buttonSecondary} href={link.href as Route} key={link.href}>
            {link.label}
          </Link>
        ))}
        <button className={styles.buttonGhost} onClick={() => void signOut()} type="button">Cerrar sesión</button>
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
        <nav aria-label="Navegación principal" className={styles.nav}>
          {NAV.map((item) => (
            <a aria-current={current(item.href)} href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
          <a aria-current={current(solicitudes)} href={solicitudes}>Solicitudes</a>
          <div className={styles.helpMenu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHelpOpen(false) }} ref={helpRef}>
            <button aria-controls="menu-ayuda" aria-expanded={helpOpen} className={styles.navButton} onClick={() => setHelpOpen((value) => !value)} ref={helpButton} type="button">
              Ayuda
            </button>
            {helpOpen ? (
              <ul className={styles.helpList} id="menu-ayuda">
                {ayuda.map((item) => (
                  <li key={item.href}>
                    <a aria-current={pathname === item.href ? 'page' : undefined} href={item.href} onClick={() => setHelpOpen(false)}>{item.label}</a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button aria-haspopup="dialog" className={styles.navButton} onClick={() => setHowOpen(true)} type="button">
            ¿Cómo funciona?
          </button>
        </nav>
        <Link aria-label="TUS, inicio" className={styles.brandLink} href="/">
          {logo}
        </Link>
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
          <a aria-current={current(solicitudes)} href={solicitudes} onClick={() => setOpen(false)}>Solicitudes</a>
          {/* Mobile: plain links, no nested menu to tap. */}
          <a aria-current={current('/ayuda')} href="/ayuda" onClick={() => setOpen(false)}>Ayuda</a>
          <a aria-current={current('/asistente')} href="/asistente" onClick={() => setOpen(false)}>Asistente</a>
          <button aria-haspopup="dialog" className={styles.navButton} onClick={() => { setOpen(false); setHowOpen(true) }} type="button">
            ¿Cómo funciona?
          </button>
          {auth.status === 'unknown' ? <span className={styles.sessionLoading} role="status">Comprobando sesión…</span> : auth.status === 'signed-in' ? (
            <>
              {links.map((link) => (
                <Link className={link.primary ? styles.buttonPrimary : styles.buttonSecondary} href={link.href as Route} key={link.href}>
                  {link.label}
                </Link>
              ))}
              <button className={styles.buttonGhost} onClick={() => void signOut()} type="button">Cerrar sesión</button>
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
      <HowItWorksDialog onClose={() => setHowOpen(false)} open={howOpen} />
    </header>
  )
}
