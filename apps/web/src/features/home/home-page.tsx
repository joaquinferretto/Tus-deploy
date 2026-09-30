'use client'

import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { createDirectoryClient } from '../directory/directory-client'
import { AssistantWidget } from './assistant-widget'
import { HeroSearch } from './hero-search'
import { MapFilters } from './map-filters'
import { PublicHeader } from './public-header'
import { getProvidersSource } from './providers-source'
import { searchCategory, searchServices, type ServiceSearchDeps, type ServiceSearchOutcome } from './service-search'
import { SiteFooter } from './site-footer'
import { ProviderResults } from './provider-results'
import { RecentRequests } from './recent-requests'
import { EMPTY_FILTERS } from './types'
import { useRecentRequests } from './use-requests'
import { useHomeProviders } from './use-providers'
import type { ProviderMapFilters } from './providers-source'
import styles from './home.module.css'
import { useCatalog } from '../catalog/use-catalog'

// Leaflet needs `window`: the map is loaded only in the browser; the rest of the home renders on
// the server and a light skeleton keeps the hero stable while the map loads.
const ProviderMap = dynamic(() => import('./provider-map'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className={styles.mapSkeleton} />,
})

export function HomePage({ logo }: { logo: React.ReactNode }): React.ReactNode {
  const [filters, setFilters] = useState<ProviderMapFilters>({ query: '', profession: '', zone: '', category: '' })
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [searchSignal, setSearchSignal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const directory = createDirectoryClient()
  const catalog = useCatalog()
  const providers = useHomeProviders(filters)
  const requests = useRecentRequests(EMPTY_FILTERS)
  const providerData = providers.data ?? []
  const providerStatus = providers.isPending ? 'loading' : providers.isError ? 'error' : 'success'
  const requestData = requests.data ?? []
  const requestStatus = requests.isPending ? 'loading' : requests.isError ? 'error' : 'success'
  // Sin filtros, una lista vacía significa que todavía no hay prestadores publicados (no "con estos filtros").
  const filtered = Boolean(filters.query || filters.profession || filters.zone || filters.category)

  function selectProvider(id: string | null) {
    setSelectedProviderId(id)
  }

  function changeFilters(next: ProviderMapFilters) {
    setFilters(next)
    setSelectedProviderId(null)
  }

  // Same cache as the map (useHomeProviders): the markers update without reloading the page.
  const searchDeps: ServiceSearchDeps = {
    interpret: (text) => directory.interpret(text),
    providers: (next) =>
      queryClient.fetchQuery({
        queryKey: ['home-providers', next.category ?? '', next.profession, next.zone, next.query],
        queryFn: () => getProvidersSource().list(next),
        staleTime: 30_000,
      }),
    catalog: catalog.data?.items ?? [],
  }

  // Applies a result of the shared service search (search bar or assistant) to the map.
  function apply(outcome: ServiceSearchOutcome): ServiceSearchOutcome {
    if (outcome.kind === 'category' || outcome.kind === 'text') {
      changeFilters(outcome.filters)
      setSearchSignal((value) => value + 1)
      const count = outcome.providers.length
      setSummary(
        outcome.kind === 'category'
          ? count === 0
            ? `No encontré profesionales de ${outcome.label.toLowerCase()}${outcome.zone ? ` en ${outcome.zone}` : ''} por ahora.`
            : `${count} ${count === 1 ? 'profesional' : 'profesionales'} de ${outcome.label.toLowerCase()}${outcome.zone ? ` en ${outcome.zone}` : ''}`
          : null
      )
    }
    return outcome
  }

  async function runSearch(text: string): Promise<ServiceSearchOutcome> {
    setSearching(true)
    try {
      return apply(await searchServices(text, searchDeps))
    } finally {
      setSearching(false)
    }
  }

  // "Ver en el mapa" from the assistant on another page arrives as /?buscar=...: same search.
  const catalogReady = Boolean(catalog.data)
  useEffect(() => {
    if (!catalogReady) return
    const pending = new URLSearchParams(window.location.search).get('buscar')
    if (!pending) return
    window.history.replaceState(null, '', window.location.pathname)
    void runSearch(pending).catch(() => setSummary('No pudimos buscar ahora. Probá de nuevo en unos minutos.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when the catalog is ready
  }, [catalogReady])

  async function runCategory(id: string, zone: string | null): Promise<ServiceSearchOutcome> {
    return apply(await searchCategory(id, zone, searchDeps))
  }

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>
      <PublicHeader logo={logo} />
      <main className={styles.main} id="contenido">
        <section aria-labelledby="home-titulo" className={styles.hero}>
          {/* The hero is only the map and the filters; the title stays for screen readers and SEO. */}
          <h1 className={styles.srOnly} id="home-titulo">
            Prestadores y zonas de atención cerca tuyo
          </h1>
          <div aria-label="Mapa de prestadores y zonas de atención" className={styles.mapLayer} role="region">
            <ProviderMap catalog={catalog.data} onSelect={selectProvider} searchSignal={searchSignal} selectedId={selectedProviderId} workers={providerData} />
          </div>
          <div className={styles.searchDock} data-map-overlay="search-dock">
            <HeroSearch busy={searching} onSearch={(text) => void runSearch(text).catch(() => setSummary('No pudimos buscar ahora. Probá de nuevo en unos minutos.'))} />
            <MapFilters
              catalog={catalog.data}
              category={filters.category ?? ''}
              onChange={(next) => { changeFilters({ query: '', zone: filters.zone, ...next }); setSummary(null) }}
              service={filters.profession}
            />
            <div className={styles.mapResults}>
              <span role="status" aria-live="polite">
                {providerStatus === 'loading' ? 'Buscando profesionales en el mapa…' : providerStatus === 'error' ? 'No pudimos cargar el mapa de profesionales.' : filtered && summary ? summary : providerData.length === 0 ? (filtered ? 'No encontré profesionales para esa búsqueda.' : 'Todavía no hay profesionales publicados en TUS.') : `${providerData.length} ${providerData.length === 1 ? 'profesional en el mapa' : 'profesionales en el mapa'}`}
              </span>
              {providerStatus === 'error' ? <button type="button" onClick={() => void providers.refetch()}>Reintentar</button> : null}
              {filtered && providerStatus === 'success' && providerData.length === 0 ? <a href="/publicar">Publicar solicitud</a> : null}
              {filtered ? <button type="button" onClick={() => { changeFilters({ query: '', profession: '', zone: '', category: '' }); setSummary(null) }}>Ver todos</button> : null}
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
      <SiteFooter />
      <AssistantWidget chooseCategory={runCategory} search={runSearch} />
    </div>
  )
}
