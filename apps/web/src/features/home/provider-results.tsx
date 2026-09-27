'use client'

import type { PrestadorPublico } from '@factory/contracts'

import { WorkerCard } from '../directory/worker-card'
import styles from './home.module.css'

export function ProviderResults({ workers, status, selectedId, onSelect }: { workers: PrestadorPublico[]; status: 'loading' | 'error' | 'success'; selectedId: string | null; onSelect: (id: string) => void }): React.ReactNode {
  return (
    <section aria-labelledby="prestadores-titulo" className={styles.section} id="prestadores">
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle} id="prestadores-titulo">Prestadores en tu zona</h2>
          <p className={styles.sectionSubtitle}>Elegí un profesional y revisá su perfil antes de solicitar.</p>
        </div>
        <a className={styles.seeAll} href="/trabajadores">Ver directorio completo →</a>
      </div>
      {status === 'loading' ? <p className={styles.state} role="status">Buscando prestadores…</p> : status === 'error' ? <p className={styles.state} role="alert">No pudimos cargar los prestadores en este momento.</p> : workers.length === 0 ? <p className={styles.state} role="status">No encontramos prestadores con esos filtros.</p> : <ul className={styles.providerGrid}>{workers.slice(0, 6).map((worker) => <li className={worker.id === selectedId ? styles.providerSelected : undefined} key={worker.id} onClick={() => onSelect(worker.id)}><WorkerCard worker={worker} /></li>)}</ul>}
    </section>
  )
}
