'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { accountLinks, createTusWebAuthClient } from '@/lib/tus-auth-client'
import { withReturnTo } from '../auth/auth-validation'

import { useAccountView } from '../session/use-account-view'
import styles from './home.module.css'

// The home (map + service search + assistant) is where services are searched; the directory lists
// workers; "Ayuda" is the assistant that answers questions about TUS. The logo always goes home.
const NAV = [
  { href: '/', label: 'Buscar servicios' },
  { href: '/alojamientos', label: 'Alojamientos' },
  { href: '/trabajadores', label: 'Buscar trabajador' },
  { href: '/#como-funciona', label: 'Cómo funciona' },
  { href: '/#profesionales', label: 'Para profesionales' },
  { href: '/asistente', label: 'Ayuda' },
] as const

export function PublicHeader({ logo }: { logo: React.ReactNode }): React.ReactNode {
  // Session and REAL role come from the API; "Ir a mi panel" goes to that role's dashboard.
  const auth = useAccountView()
  const [open, setOpen] = useState(false)
  const pathname = usePathname() ?? '/'
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
    </header>
  )
}
