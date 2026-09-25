import Link from 'next/link'

import { PublicHeader } from './public-header'
import styles from './home.module.css'

// Public TUS page frame (same header, tokens and footer as the home) for the assistant, the
// worker directory and public profiles.
export function SitePage({ logo, children }: { logo: React.ReactNode; children: React.ReactNode }): React.ReactNode {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>
      <PublicHeader logo={logo} />
      <main id="contenido">{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© TUS · Servicios cerca tuyo</span>
          <nav aria-label="Enlaces" className={styles.footerLinks}>
            <Link href="/asistente">Buscar servicios</Link>
            <Link href="/trabajadores">Buscar trabajador</Link>
            <Link href="/mis-solicitudes">Mis solicitudes</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
