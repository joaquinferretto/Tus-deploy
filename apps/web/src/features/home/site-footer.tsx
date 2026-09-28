'use client'

import Link from 'next/link'

import { useAccountView } from '../session/use-account-view'
import styles from './home.module.css'

// Footer shared by the home and every public page. Only routes that exist (no terms/privacy page
// yet, so no broken links).
export function SiteFooter(): React.ReactNode {
  const account = useAccountView()
  return (
    <footer className={styles.footer} id="ayuda">
      <div className={styles.footerGrid}>
        <div className={styles.footerBrand}>
          <strong>TUS</strong>
          <span className={styles.footerTagline}>Servicios cerca tuyo</span>
          <p>Encontrá profesionales de confianza o publicá lo que necesitás.</p>
        </div>
        <nav aria-label="Servicios" className={styles.footerColumn}>
          <h2>Servicios</h2>
          <Link href="/">Buscar servicios</Link>
          <Link href="/trabajadores">Buscar trabajador</Link>
          <Link href="/publicar">Publicar solicitud</Link>
        </nav>
        <nav aria-label="TUS" className={styles.footerColumn}>
          <h2>TUS</h2>
          <Link href="/#como-funciona">Cómo funciona</Link>
          <Link href="/#profesionales">Para profesionales</Link>
          <Link href="/asistente">Ayuda</Link>
        </nav>
        {account.status === 'signed-in' ? (
          <nav aria-label="Cuenta" className={styles.footerColumn}>
            <h2>Cuenta</h2>
            <Link href="/mi-perfil">Mi perfil</Link>
            <Link href={account.panel.href}>{account.capabilities.platformAdmin ? 'Panel admin' : 'Mi panel'}</Link>
          </nav>
        ) : null}
      </div>
      <div className={styles.footerBottom}>
        <span>© 2026 TUS · Servicios cerca tuyo</span>
      </div>
    </footer>
  )
}
