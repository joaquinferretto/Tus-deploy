import { AssistantWidget } from './assistant-widget'
import { PublicHeader } from './public-header'
import { SiteFooter } from './site-footer'
import styles from './home.module.css'

// Public TUS page frame (same header, tokens and footer as the home) for the assistant, the
// worker directory and public profiles.
// `footer={false}` (UX-ANCHO-01): the private operating screens are a workspace, not a landing page.
export function SitePage({ logo, children, footer = true }: { logo: React.ReactNode; children: React.ReactNode; footer?: boolean }): React.ReactNode {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>
      <PublicHeader logo={logo} />
      <main className={styles.main} id="contenido">{children}</main>
      {footer ? <SiteFooter logo={logo} /> : null}
      {/* The assistant is on every public page; off the home its search opens the home map. */}
      <AssistantWidget />
    </div>
  )
}
