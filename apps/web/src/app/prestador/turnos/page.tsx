import type { Metadata } from 'next'

import { TusLogo } from '@/features/brand/tus-logo'
import { SitePage } from '@/features/home/site-page'
import { ProviderTurnos } from '@/features/provider/provider-turnos'
import styles from '@/features/directory/directory.module.css'

export const metadata: Metadata = {
  title: 'Turnos y Agenda | TUS',
  robots: { index: false, follow: false },
}

export default function Page(): React.ReactNode {
  return (
    <SitePage logo={<TusLogo variant="header" />}>
      <div className={styles.narrow}>
        <h1 className={styles.title}>Mis Turnos y Agenda</h1>
        <nav aria-label="Prestador" style={{ marginBottom: 16 }}>
          <a href="/prestador/solicitudes">Solicitudes</a> ·{' '}
          <a href="/prestador/turnos" style={{ fontWeight: 700, color: 'var(--tus-orange, #ff5a00)' }}>Turnos y Agenda</a> ·{' '}
          <a href="/trabajos">Mis trabajos</a> ·{' '}
          <a href="/prestador/pagos">Pagos</a> ·{' '}
          <a href="/prestador/ubicacion">Ubicación</a>
        </nav>
        <p className={styles.subtitle}>
          Gestioná tus citas agendadas, registrá turnos presenciales y bloqueá horarios no disponibles.
        </p>
        <div style={{ marginTop: 24 }}>
          <ProviderTurnos />
        </div>
      </div>
    </SitePage>
  )
}
