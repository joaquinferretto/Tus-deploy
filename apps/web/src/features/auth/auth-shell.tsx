import Link from 'next/link'

import styles from './auth.module.css'

// Shared frame for sign-in and sign-up: form on the left, a light brand panel on the right
// (hidden on mobile). The panel is decorative, not a landing page inside the login.
export function AuthShell({
  logo,
  title,
  subtitle,
  children,
  visualTitle = 'Servicios de confianza, cerca tuyo.',
}: {
  logo: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
  visualTitle?: string
}): React.ReactNode {
  return (
    <div className={styles.shell}>
      {/* Logo al centro; "Volver al inicio" a la izquierda. */}
      <header className={styles.topBar}>
        <Link className={styles.topBarBack} href="/">
          ← Volver al inicio
        </Link>
        <Link aria-label="TUS, volver al inicio" className={styles.topBarBrand} href="/">
          {logo}
        </Link>
      </header>
      <main className={styles.formSide} id="contenido">
        <div className={styles.formWrap}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
          {children}
        </div>
      </main>
      <aside aria-hidden="true" className={styles.visualSide}>
        <div className={styles.visualGrid} />
        <span className={styles.pin} style={{ left: '22%', top: '24%' }} />
        <span className={styles.pin} style={{ left: '64%', top: '18%' }} />
        <span className={styles.pin} style={{ left: '48%', top: '42%' }} />
        <div className={styles.visualContent}>
          <p className={styles.visualTitle}>{visualTitle}</p>
          <ul className={styles.visualList}>
            <li>Profesionales con identidad verificada</li>
            <li>Presupuestos claros antes de empezar</li>
            <li>Pagos protegidos con Mercado Pago</li>
          </ul>
        </div>
      </aside>
    </div>
  )
}
