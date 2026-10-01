'use client'

import Image from 'next/image'
import Link from 'next/link'

import type { Route } from 'next'

import { accountLinks } from '@/lib/tus-auth-client'

import { useAccountView } from '../session/use-account-view'
import styles from './home.module.css'

// Footer shared by the home and every public page. Only routes that exist (no terms/privacy page
// yet, so no broken links).
export function SiteFooter({ logo }: { logo?: React.ReactNode } = {}): React.ReactNode {
  const account = useAccountView()
  return (
    <footer className={styles.footer} id="ayuda">
      <div className={styles.footerGrid}>
        <div className={styles.footerLeft}>
          <nav aria-label="Servicios" className={styles.footerColumn}>
            <h2>Servicios</h2>
            <Link href="/">Buscar servicios</Link>
            <Link href="/trabajadores">Buscar trabajador</Link>
            <Link href="/publicar">Publicar solicitud</Link>
          </nav>
        </div>
        <div className={styles.footerBrand}>
          <Link aria-label="TUS, inicio" className={styles.footerLogoLink} href="/">
            {logo ?? (
              <Image
                alt="TUS"
                height={36}
                src="/brand/logo-tus.png"
                style={{ height: 36, width: 'auto' }}
                width={80}
              />
            )}
          </Link>
          <span className={styles.footerTagline}>Servicios cerca tuyo</span>
          <p>Encontrá profesionales de confianza o publicá lo que necesitás.</p>
        </div>
        <div className={styles.footerRight}>
          <nav aria-label="TUS" className={styles.footerColumn}>
            <h2>TUS</h2>
            <Link href="/#como-funciona">Cómo funciona</Link>
            <Link href="/#profesionales">Para profesionales</Link>
            <Link href="/asistente">Ayuda</Link>
          </nav>
          {account.status === 'signed-in' ? (
            <nav aria-label="Cuenta" className={styles.footerColumn}>
              <h2>Cuenta</h2>
              {accountLinks(account.capabilities).map((link) => (
                <Link href={link.href as Route} key={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </div>
      <div className={styles.footerBottom}>
        <span>© 2026 TUS · Servicios cerca tuyo</span>
      </div>
    </footer>
  )
}
