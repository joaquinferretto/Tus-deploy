'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'

import { HeroSearch } from './hero-search'
import { PublicHeader } from './public-header'
import { RecentRequests } from './recent-requests'
import { EMPTY_FILTERS, type RequestFilters } from './types'
import { useRecentRequests } from './use-requests'
import styles from './home.module.css'

// Leaflet needs `window`: the map is loaded only in the browser; the rest of the home renders on
// the server and a light skeleton keeps the hero stable while the map loads.
const RequestMap = dynamic(() => import('./request-map'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className={styles.mapSkeleton} />,
})

export function HomePage({ logo }: { logo: React.ReactNode }): React.ReactNode {
  const [filters, setFilters] = useState<RequestFilters>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [searchSignal, setSearchSignal] = useState(0)
  const requests = useRecentRequests(filters)
  const data = requests.data ?? []
  const status = requests.isPending ? 'loading' : requests.isError ? 'error' : 'success'

  function select(id: string) {
    setSelectedId(id)
  }

  function changeFilters(next: RequestFilters) {
    setFilters(next)
    setSelectedId(null)
    setHighlightedId(null)
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
            Servicios cerca tuyo: personas de tu zona buscando ayuda profesional
          </h1>
          <div aria-label="Mapa de solicitudes en tu zona" className={styles.mapLayer} role="region">
            <RequestMap highlightedId={highlightedId} onSelect={select} requests={data} selectedId={selectedId} searchSignal={searchSignal} />
          </div>
          <div className={styles.searchDock}>
            <HeroSearch
              filters={filters}
              onChange={changeFilters}
              onSubmit={() => { setSelectedId(null); setSearchSignal((value) => value + 1) }}
            />
            <div className={styles.mapResults}>
              <span role="status" aria-live="polite">
                {status === 'loading' ? 'Buscando solicitudes en el mapa…' : status === 'error' ? 'No pudimos cargar el mapa de solicitudes.' : data.length === 0 ? 'No hay solicitudes con estos filtros.' : `${data.length} ${data.length === 1 ? 'solicitud en el mapa' : 'solicitudes en el mapa'}`}
              </span>
              {status === 'error' ? <button type="button" onClick={() => void requests.refetch()}>Reintentar</button> : null}
              {filters.query || filters.category || filters.zone ? <button type="button" onClick={() => changeFilters(EMPTY_FILTERS)}>Limpiar filtros</button> : null}
              <a href="#solicitudes">Ver lista</a>
            </div>
          </div>
        </section>

        <RecentRequests
          onHover={setHighlightedId}
          onSelect={select}
          requests={data}
          selectedId={selectedId}
          status={status}
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
              <p className={styles.rowText}>Recibís presupuestos de profesionales verificados de tu zona.</p>
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
            <a href="/sign-in">Iniciar sesión</a>
            <a href="/registro">Crear cuenta</a>
            <a href="/recovery">Recuperar acceso</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
