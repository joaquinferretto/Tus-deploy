import styles from './help.module.css'

// A discreet link from a functional page to its guide ("¿Cómo funcionan las solicitudes?"). The
// destinations are articles of the Help Center; a test checks that each one exists.
export function HelpLink({ href, children }: { href: `/ayuda/${string}`; children: React.ReactNode }): React.ReactNode {
  return <a className={styles.contextual} href={href}>{children}</a>
}
