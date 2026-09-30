import { AssistantWidget } from './assistant-widget'
import { PublicHeader } from './public-header'
import { SiteFooter } from './site-footer'
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
      <main className={styles.main} id="contenido">{children}</main>
      <SiteFooter logo={logo} />
      {/* The assistant is on every public page; off the home its search opens the home map. */}
      <AssistantWidget />
    </div>
  )
}
