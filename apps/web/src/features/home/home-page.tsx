'use client'

import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { buscarAlojamientos, listarTiposAlojamiento } from '../alojamientos/alojamientos-client'
import { createDirectoryClient } from '../directory/directory-client'
import { WorkerCard } from '../directory/worker-card'
import { AssistantWidget } from './assistant-widget'
import { HeroSearch } from './hero-search'
import { HowItWorksSteps } from './how-it-works'
import { LodgingFilters } from './lodging-filters'
import { LodgingCard, LodgingResults } from './lodging-results'
import { MapFilters } from './map-filters'
import { MapSheet } from './map-sheet'
import { EMPTY_MAP_STATE, mapStateQuery, parseMapState, type MapKind } from './map-state'
import { MapTypeSelector } from './map-type-selector'
import { PublicHeader } from './public-header'
import { getProvidersSource } from './providers-source'
import { searchServices, type ServiceSearchDeps, type ServiceSearchOutcome } from './service-search'
import { SiteFooter } from './site-footer'
import { ProviderResults } from './provider-results'
import { RecentRequests } from './recent-requests'
import { EMPTY_FILTERS } from './types'
import { useMediaQuery } from './use-media-query'
import { useRecentRequests } from './use-requests'
import { useHomeProviders } from './use-providers'
import type { ProviderMapFilters } from './providers-source'
import styles from './home.module.css'
import { useCatalog } from '../catalog/use-catalog'

// Leaflet needs `window`: the map is loaded only in the browser; the rest of the home renders on
// the server and a light skeleton keeps the hero stable while the map loads.
const HomeMap = dynamic(() => import('./home-map'), { ssr: false, loading: () => <div aria-hidden="true" className={styles.mapSkeleton} /> })

const NO_FILTERS: ProviderMapFilters = { query: '', profession: '', zone: '', category: '' }

export function HomePage({ logo }: { logo: React.ReactNode }): React.ReactNode {
  // The map is the centre of the search: `kind` decides what it shows (professionals or lodgings)
  // and with it the filters, the markers, the cards and the list under the map.
  const [kind, setKind] = useState<MapKind>('profesionales')
  const [filters, setFilters] = useState<ProviderMapFilters>(NO_FILTERS)
  const [lodging, setLodging] = useState<{ type: string; guests: number | null }>({ type: '', guests: null })
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [selectedLodgingId, setSelectedLodgingId] = useState<string | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [searchSignal, setSearchSignal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [urlReady, setUrlReady] = useState(false)
  // Small screens show the selected item in a bottom sheet instead of a map popup.
  const compact = useMediaQuery('(max-width: 768px)')
  const queryClient = useQueryClient()
  const directory = createDirectoryClient()
  const catalog = useCatalog()
  const providers = useHomeProviders(filters)
  const requests = useRecentRequests(EMPTY_FILTERS)
  const lodgingsOn = kind === 'alojamientos'
  // Lodgings are only requested once the person chooses them; a superseded request is cancelled.
  const lodgingTypes = useQuery({ queryKey: ['lodging-types'], queryFn: () => listarTiposAlojamiento(), enabled: lodgingsOn, staleTime: 5 * 60_000 })
  const lodgings = useQuery({
    queryKey: ['home-lodgings', lodging.type, lodging.guests],
    queryFn: ({ signal }) => buscarAlojamientos({ ...(lodging.type ? { tipoSlug: lodging.type } : {}), ...(lodging.guests ? { personas: lodging.guests } : {}) }, { signal }),
    enabled: lodgingsOn,
    staleTime: 30_000,
  })
  const providerData = useMemo(() => providers.data ?? [], [providers.data])
  const providerStatus = providers.isPending ? 'loading' : providers.isError ? 'error' : 'success'
  const lodgingData = useMemo(() => lodgings.data ?? [], [lodgings.data])
  const lodgingStatus = lodgings.isPending ? 'loading' : lodgings.isError ? 'error' : 'success'
  const requestData = requests.data ?? []
  const requestStatus = requests.isPending ? 'loading' : requests.isError ? 'error' : 'success'
  // Sin filtros, una lista vacía significa que todavía no hay prestadores publicados (no "con estos filtros").
  const filtered = Boolean(filters.query || filters.profession || filters.zone || filters.category)
  const lodgingFiltered = Boolean(lodging.type || lodging.guests)
  const selectedProvider = useMemo(() => providerData.find((worker) => worker.id === selectedProviderId) ?? null, [providerData, selectedProviderId])
  const selectedLodging = useMemo(() => lodgingData.find((item) => item.id === selectedLodgingId) ?? null, [lodgingData, selectedLodgingId])

  function selectProvider(id: string | null) {
    setSelectedProviderId(id)
  }

  function changeFilters(next: ProviderMapFilters) {
    setFilters(next)
    setSelectedProviderId(null)
  }

  function changeKind(next: MapKind) {
    if (next === kind) return
    setKind(next)
    setSelectedProviderId(null)
    setSelectedLodgingId(null)
    setSummary(null)
  }

  // Same cache as the map (useHomeProviders): the markers update without reloading the page.
  const searchDeps: ServiceSearchDeps = {
    interpret: (text) => directory.interpret(text),
    providers: (next) =>
      queryClient.fetchQuery({
        queryKey: ['home-providers', next.category ?? '', next.profession, next.zone, next.query],
        queryFn: ({ signal }) => getProvidersSource().list(next, signal),
        staleTime: 30_000,
      }),
    catalog: catalog.data?.items ?? [],
  }

  // Applies a result of the service search (search bar) to the map.
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

  // The address is read once, when the catalog is known: a search started on another page arrives
  // as /?buscar=... (same search), and a shared map arrives as /?tipo=...&categoria=... (validated
  // against the catalog; unknown values are dropped).
  const catalogReady = Boolean(catalog.data)
  useEffect(() => {
    if (!catalogReady || urlReady) return
    const pending = new URLSearchParams(window.location.search).get('buscar')
    if (pending) {
      window.history.replaceState(null, '', window.location.pathname)
      void runSearch(pending).catch(() => setSummary('No pudimos buscar ahora. Probá de nuevo en unos minutos.'))
    } else {
      const state = parseMapState(window.location.search, {
        categories: (catalog.data?.categories ?? []).map((item) => item.id),
        services: catalog.data?.items ?? [],
        zones: catalog.data?.zones ?? [],
      })
      setKind(state.kind)
      if (state.kind === 'alojamientos') setLodging({ type: state.lodgingType, guests: state.guests })
      else if (state.category || state.service || state.zone) setFilters({ query: '', profession: state.service, zone: state.zone, category: state.category })
    }
    setUrlReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when the catalog is ready
  }, [catalogReady])

  // ... and from then on the address follows the map, without adding history entries.
  useEffect(() => {
    if (!urlReady) return
    const query = mapStateQuery({ ...EMPTY_MAP_STATE, kind, category: filters.category ?? '', service: filters.profession, zone: filters.zone, lodgingType: lodging.type, guests: lodging.guests })
    if (query !== window.location.search) window.history.replaceState(null, '', `${window.location.pathname}${query}${window.location.hash}`)
  }, [urlReady, kind, filters.category, filters.profession, filters.zone, lodging.type, lodging.guests])

  const searchFailed = () => setSummary('No pudimos buscar ahora. Probá de nuevo en unos minutos.')

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
            Profesionales y alojamientos cerca tuyo
          </h1>
          <div aria-label={lodgingsOn ? 'Mapa de alojamientos' : 'Mapa de prestadores y zonas de atención'} className={styles.mapLayer} role="region">
            {/* One map: the type only changes the layer drawn on it. */}
            <HomeMap
              catalog={catalog.data}
              kind={kind}
              lodgings={lodgingData}
              onSelectLodging={setSelectedLodgingId}
              onSelectProvider={selectProvider}
              popups={!compact}
              searchSignal={searchSignal}
              selectedLodgingId={selectedLodgingId}
              selectedProviderId={selectedProviderId}
              workers={providerData}
            />
          </div>
          <div className={styles.searchDock} data-map-overlay="search-dock">
            <MapTypeSelector kind={kind} onChange={changeKind} />
            {lodgingsOn ? (
              <>
                <LodgingFilters guests={lodging.guests} onChange={(next) => { setLodging(next); setSelectedLodgingId(null) }} type={lodging.type} types={lodgingTypes.data ?? []} />
                <span aria-live="polite" className={styles.srOnly} role="status">
                  {lodgingStatus === 'loading' ? 'Buscando alojamientos en el mapa…' : lodgingStatus === 'success' && lodgingData.length > 0 ? 'Mapa de alojamientos actualizado.' : ''}
                </span>
                {lodgingStatus === 'error' || (lodgingStatus === 'success' && lodgingData.length === 0) ? (
                  <div className={styles.mapResults}>
                    <span role="status">
                      {lodgingStatus === 'error' ? 'No pudimos cargar el mapa de alojamientos.' : lodgingFiltered ? 'No encontré alojamientos con esos filtros.' : 'Todavía no hay alojamientos publicados en TUS.'}
                    </span>
                    {lodgingStatus === 'error' ? <button type="button" onClick={() => void lodgings.refetch()}>Reintentar</button> : null}
                    {lodgingFiltered && lodgingStatus === 'success' ? <button type="button" onClick={() => setLodging({ type: '', guests: null })}>Ver todos</button> : null}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <HeroSearch busy={searching} onSearch={(text) => void runSearch(text).catch(searchFailed)} />
                <MapFilters
                  catalog={catalog.data}
                  category={filters.category ?? ''}
                  // "Todas" with no service is the way back to every professional: it also drops the
                  // zone a text search may have set (there is no separate "Ver todos" over the map).
                  onChange={(next) => { changeFilters({ query: '', zone: next.category || next.profession ? filters.zone : '', ...next }); setSummary(null) }}
                  service={filters.profession}
                />
                {/* No counter over the map: with results, the markers are the answer. A message appears
                    only when there is nothing to show (load error, or no professional for the search). */}
                <span aria-live="polite" className={styles.srOnly} role="status">
                  {providerStatus === 'loading' ? 'Buscando profesionales en el mapa…' : providerStatus === 'success' && providerData.length > 0 ? 'Mapa de profesionales actualizado.' : ''}
                </span>
                {providerStatus === 'error' || (providerStatus === 'success' && providerData.length === 0) ? (
                  <div className={styles.mapResults}>
                    <span role="status">
                      {providerStatus === 'error' ? 'No pudimos cargar el mapa de profesionales.' : filtered && summary ? summary : filtered ? 'No encontré profesionales para esa búsqueda.' : 'Todavía no hay profesionales publicados en TUS.'}
                    </span>
                    {providerStatus === 'error' ? <button type="button" onClick={() => void providers.refetch()}>Reintentar</button> : null}
                    {filtered && providerStatus === 'success' ? <a href="/publicar">Publicar solicitud</a> : null}
                    {filtered ? <button type="button" onClick={() => { changeFilters(NO_FILTERS); setSummary(null) }}>Ver todos</button> : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
          {compact && !lodgingsOn && selectedProvider ? (
            <MapSheet label="Profesional seleccionado" onClose={() => selectProvider(null)}>
              <WorkerCard compact worker={selectedProvider} />
            </MapSheet>
          ) : null}
          {compact && lodgingsOn && selectedLodging ? (
            <MapSheet label="Alojamiento seleccionado" onClose={() => setSelectedLodgingId(null)}>
              <LodgingCard lodging={selectedLodging} />
            </MapSheet>
          ) : null}
        </section>

        {lodgingsOn ? (
          <LodgingResults filtered={lodgingFiltered} lodgings={lodgingData} onSelect={setSelectedLodgingId} selectedId={selectedLodgingId} status={lodgingStatus} />
        ) : (
          <ProviderResults filtered={filtered} onSelect={selectProvider} selectedId={selectedProviderId} status={providerStatus} workers={providerData} />
        )}

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
          <div style={{ marginTop: 20 }}>
            <HowItWorksSteps />
          </div>
        </section>

        <section aria-labelledby="profesionales-titulo" className={styles.section} id="profesionales">
          <div className={styles.proBand}>
            <div>
              <h2 className={styles.proTitle} id="profesionales-titulo">
                ¿Sos profesional? Encontrá trabajos cerca tuyo.
              </h2>
              <p className={styles.rowText}>Creá tu perfil, publicá tus servicios y cobrá con Mercado Pago.</p>
            </div>
            <a className={styles.buttonPrimary} href="/registro?intencion=prestador">
              Quiero ofrecer mis servicios
            </a>
          </div>
        </section>
      </main>
      <SiteFooter logo={logo} />
      <AssistantWidget />
    </div>
  )
}
