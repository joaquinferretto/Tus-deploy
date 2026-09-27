'use client'

import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { createDirectoryClient } from '../directory/directory-client'
import { HeroSearch } from './hero-search'
import { PublicHeader } from './public-header'
import { ProviderResults } from './provider-results'
import { RecentRequests } from './recent-requests'
import { EMPTY_FILTERS } from './types'
import { useRecentRequests } from './use-requests'
import { useHomeProviders } from './use-providers'
import type { ProviderMapFilters } from './providers-source'
import styles from './home.module.css'

// Leaflet needs `window`: the map is loaded only in the browser; the rest of the home renders on
// the server and a light skeleton keeps the hero stable while the map loads.
const ProviderMap = dynamic(() => import('./provider-map'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className={styles.mapSkeleton} />,
})

export function HomePage({ logo }: { logo: React.ReactNode }): React.ReactNode {
  const [filters, setFilters] = useState<ProviderMapFilters>({ query: '', profession: '', zone: '' })
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [searchSignal, setSearchSignal] = useState(0)
  const directory = createDirectoryClient()
  const catalog = useQuery({ queryKey: ['home-directory-catalog'], queryFn: () => directory.catalog(), staleTime: 5 * 60_000 })
  const providers = useHomeProviders(filters)
  const requests = useRecentRequests(EMPTY_FILTERS)
  const providerData = providers.data ?? []
  const providerStatus = providers.isPending ? 'loading' : providers.isError ? 'error' : 'success'
  const requestData = requests.data ?? []
  const requestStatus = requests.isPending ? 'loading' : requests.isError ? 'error' : 'success'
  // Sin filtros, una lista vacía significa que todavía no hay prestadores publicados (no "con estos filtros").
  const filtered = Boolean(filters.query || filters.profession || filters.zone)

  function selectProvider(id: string) {
    setSelectedProviderId(id)
  }

  function changeFilters(next: ProviderMapFilters) {
    setFilters(next)
    setSelectedProviderId(null)
  }

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>
      <PublicHeader logo={logo} />
      <main id="contenido">
        <section aria-labelledby="home-titulo" className={styles.hero}>
          {/* The hero is only the map and the filters; the title stays for screen readers and SEO. */}
          <h1 className={styles.srOnly} id="home-titulo">
            Prestadores y zonas de atención cerca tuyo
          </h1>
          <div aria-label="Mapa de prestadores y zonas de atención" className={styles.mapLayer} role="region">
            <ProviderMap onSelect={selectProvider} searchSignal={searchSignal} selectedId={selectedProviderId} workers={providerData} />
          </div>
          <div className={styles.searchDock}>
            <HeroSearch
              catalog={catalog.data?.items ?? []}
              filters={filters}
              onChange={changeFilters}
              zones={catalog.data?.zones ?? []}
              onSubmit={() => { setSelectedProviderId(null); setSearchSignal((value) => value + 1) }}
            />
            <div className={styles.mapResults}>
              <span role="status" aria-live="polite">
                {providerStatus === 'loading' ? 'Buscando prestadores en el mapa…' : providerStatus === 'error' ? 'No pudimos cargar el mapa de prestadores.' : providerData.length === 0 ? (filtered ? 'No hay prestadores con estos filtros.' : 'Todavía no hay prestadores publicados en TUS.') : `${providerData.length} ${providerData.length === 1 ? 'prestador en el mapa' : 'prestadores en el mapa'}`}
              </span>
              {providerStatus === 'error' ? <button type="button" onClick={() => void providers.refetch()}>Reintentar</button> : null}
              {filtered ? <button type="button" onClick={() => changeFilters({ query: '', profession: '', zone: '' })}>Limpiar filtros</button> : null}
              <a href="#prestadores">Ver prestadores</a>
            </div>
          </div>
        </section>

        <ProviderResults filtered={filtered} onSelect={selectProvider} selectedId={selectedProviderId} status={providerStatus} workers={providerData} />

        <RecentRequests
          onHover={() => undefined}
          onSelect={setSelectedRequestId}
          requests={requestData}
          selectedId={selectedRequestId}
          status={requestStatus}
        />

        <section aria-labelledby="como-funciona-titulo" className={styles.section} id="como-funciona">
          <h2 className={styles.sectionTitle} id="como-funciona-titulo">
            Cómo funciona
          </h2>
          <ol className={styles.steps} style={{ marginTop: 20 }}>
            <li className={styles.step}>
              <span className={styles.stepNumber}>1</span>
              <h3 className={styles.stepTitle}>Contás qué necesitás</h3>
              <p className={styles.rowText}>Buscá un servicio o publicá tu solicitud con fotos opcionales.</p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNumber}>2</span>
              <h3 className={styles.stepTitle}>Elegís al profesional</h3>
              <p className={styles.rowText}>Elegís un profesional del directorio o aceptás a quien se ofrezca para tu solicitud. Siempre decidís vos.</p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNumber}>3</span>
              <h3 className={styles.stepTitle}>Pagás cuando está listo</h3>
              <p className={styles.rowText}>Pagás el presupuesto aceptado con Mercado Pago cuando el trabajo termina.</p>
            </li>
          </ol>
        </section>

        <section aria-labelledby="profesionales-titulo" className={styles.section} id="profesionales">
          <div className={styles.proBand}>
            <div>
              <h2 className={styles.proTitle} id="profesionales-titulo">
                ¿Sos profesional? Encontrá trabajos cerca tuyo.
              </h2>
              <p className={styles.rowText}>Verificá tu identidad, publicá tus servicios y cobrá con Mercado Pago.</p>
            </div>
            <a className={styles.buttonPrimary} href="/registro?intencion=prestador">
              Quiero ofrecer mis servicios
            </a>
          </div>
        </section>
      </main>
      <footer className={styles.footer} id="ayuda">
        <div className={styles.footerInner}>
          <span>© TUS · Servicios cerca tuyo</span>
          <nav aria-label="Ayuda" className={styles.footerLinks}>
            {/* Preguntas sobre cómo funciona TUS: el asistente responde con el conocimiento público. */}
            <a href="/asistente">Preguntas frecuentes</a>
            <a href="/sign-in">Iniciar sesión</a>
            <a href="/registro">Crear cuenta</a>
            <a href="/recovery">Recuperar acceso</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
