'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { PrestadorPublico } from '@factory/contracts'

import homeStyles from '../home/home.module.css'
import { useDebouncedValue } from '../home/use-requests'
import { createDirectoryClient, type DirectoryFilters } from './directory-client'
import styles from './directory.module.css'
import { WorkerCard } from './worker-card'

const client = createDirectoryClient()

// "Buscar trabajador": the person already knows which trade they need. List first (no map-first
// screen); professions and barrios come from the API catalog, results from real profiles.
export function WorkerDirectory(): React.ReactNode {
  const [query, setQuery] = useState('')
  const [profession, setProfession] = useState('')
  const [zone, setZone] = useState('')
  const [verified, setVerified] = useState(false)
  const [today, setToday] = useState(false)
  const [order, setOrder] = useState<NonNullable<DirectoryFilters['orden']>>('relevancia')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<PrestadorPublico[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const debouncedQuery = useDebouncedValue(query, 350)

  // Deep link: /trabajadores?oficio=electricidad
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oficio = params.get('oficio')
    if (oficio) setProfession(oficio)
    const q = params.get('q')
    if (q) setQuery(q.slice(0, 80))
  }, [])

  const catalog = useQuery({ queryKey: ['oficios'], queryFn: () => client.catalog(), staleTime: 5 * 60_000 })
  const filters = useMemo<DirectoryFilters>(
    () => ({ q: debouncedQuery, oficio: profession, zona: zone, verificados: verified, hoy: today, orden: order }),
    [debouncedQuery, profession, zone, verified, today, order]
  )
  const key = JSON.stringify(filters)
  useEffect(() => setPage(1), [key])

  const results = useQuery({
    queryKey: ['trabajadores', key, page],
    queryFn: () => client.list({ ...filters, pagina: page }),
    staleTime: 30_000,
  })

  // Accumulate pages for "Cargar más".
  useEffect(() => {
    if (!results.data) return
    setItems((current) => (page === 1 ? results.data.items : [...current, ...results.data.items.filter((item) => !current.some((existing) => existing.id === item.id))]))
  }, [results.data, page])

  const clear = () => {
    setQuery('')
    setProfession('')
    setZone('')
    setVerified(false)
    setToday(false)
    setOrder('relevancia')
  }

  const loadingFirstPage = results.isPending && page === 1
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Encontrá al profesional que necesitás</h1>
      <p className={styles.subtitle}>Explorá profesionales disponibles por oficio y encontrá el indicado para tu trabajo.</p>

      <form className={styles.searchRow} onSubmit={(event) => event.preventDefault()} role="search">
        <div className={styles.searchField}>
          <label htmlFor="buscar-trabajador">¿Qué profesional buscás?</label>
          <input
            autoComplete="off"
            id="buscar-trabajador"
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ej. electricista, plomero, aire acondicionado"
            type="search"
            value={query}
          />
        </div>
      </form>

      <div aria-label="Oficios" className={styles.chips} role="group">
        <button aria-pressed={profession === ''} className={styles.chip} onClick={() => setProfession('')} type="button">
          Todos
        </button>
        {(catalog.data?.items ?? []).map((item) => (
          <button aria-pressed={profession === item.id} className={styles.chip} key={item.id} onClick={() => setProfession(item.id)} type="button">
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        <button
          aria-controls="filtros-trabajador"
          aria-expanded={filtersOpen}
          className={`${homeStyles.buttonSecondary} ${styles.filtersToggle}`}
          onClick={() => setFiltersOpen((value) => !value)}
          type="button"
        >
          {filtersOpen ? 'Ocultar filtros' : 'Filtros'}
        </button>
        <div className={styles.filterGroup} data-open={filtersOpen} id="filtros-trabajador">
          <label className={styles.check}>
            <span>Barrio</span>
            <select className={styles.select} onChange={(event) => setZone(event.target.value)} value={zone}>
              <option value="">Todos los barrios</option>
              {(catalog.data?.zones ?? []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.check}>
            <input checked={verified} onChange={(event) => setVerified(event.target.checked)} type="checkbox" />
            Solo verificados
          </label>
          <label className={styles.check}>
            <input checked={today} onChange={(event) => setToday(event.target.checked)} type="checkbox" />
            Atienden hoy
          </label>
          <label className={styles.check}>
            <span>Ordenar</span>
            <select className={styles.select} onChange={(event) => setOrder(event.target.value as NonNullable<DirectoryFilters['orden']>)} value={order}>
              <option value="relevancia">Recomendados</option>
              <option value="trabajos">Más trabajos realizados</option>
              <option value="cercania">Más cerca del barrio elegido</option>
            </select>
          </label>
        </div>
      </div>

      <section aria-busy={loadingFirstPage} aria-label="Resultados">
        {loadingFirstPage ? (
          <>
            <p className={styles.resultCount} role="status">
              Buscando profesionales…
            </p>
            <div className={styles.grid}>
              {[0, 1, 2].map((index) => (
                <div className={styles.skeleton} key={index} />
              ))}
            </div>
          </>
        ) : results.isError && page === 1 ? (
          <div className={styles.state} role="alert">
            No pudimos cargar los profesionales en este momento. Probá de nuevo en unos minutos.
            <div className={styles.stateActions}>
              <button className={homeStyles.buttonSecondary} onClick={() => void results.refetch()} type="button">
                Reintentar
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.state} role="status">
            No encontramos profesionales con esos filtros.
            <div className={styles.stateActions}>
              <button className={homeStyles.buttonSecondary} onClick={clear} type="button">
                Ver todos
              </button>
              <a className={homeStyles.buttonPrimary} href="/asistente">
                Contale tu problema al asistente
              </a>
            </div>
          </div>
        ) : (
          <>
            <p className={styles.resultCount} role="status">
              {results.data?.total ?? items.length} {(results.data?.total ?? items.length) === 1 ? 'profesional' : 'profesionales'}
            </p>
            <ul className={styles.grid}>
              {items.map((worker) => (
                <li key={worker.id}>
                  <WorkerCard worker={worker} />
                </li>
              ))}
            </ul>
            {results.data?.hasMore ? (
              <div className={styles.moreRow}>
                <button className={homeStyles.buttonSecondary} disabled={results.isFetching} onClick={() => setPage((value) => value + 1)} type="button">
                  {results.isFetching ? 'Cargando…' : 'Cargar más'}
                </button>
              </div>
            ) : null}
            {results.isError && page > 1 ? (
              <p className={styles.resultCount} role="alert">
                No pudimos cargar más resultados.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
