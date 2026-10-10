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
  // GEO-BUSQUEDA-01: where to look. The position is asked only when "Cerca de mí" is chosen, kept
  // in memory for this search and never saved.
  const [scope, setScope] = useState<'' | 'cerca' | 'localidad' | 'provincia'>('')
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [scopeNotice, setScopeNotice] = useState('')
  const [localityId, setLocalityId] = useState('')
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
  const localities = catalog.data?.locations?.localities ?? []
  const locality = localities.find((item) => item.id === localityId) ?? localities[0] ?? null
  const filters = useMemo<DirectoryFilters>(
    () => ({
      q: debouncedQuery, oficio: profession, zona: zone, verificados: verified, hoy: today, orden: order,
      ...(scope === 'cerca' && point ? { ambito: 'cerca' as const, lat: point.lat, lng: point.lng } : {}),
      ...((scope === 'localidad' || scope === 'provincia') && locality ? { ambito: scope, localidadId: locality.id } : {}),
    }),
    [debouncedQuery, profession, zone, verified, today, order, scope, point, locality]
  )
  // "Cerca de mí": the browser asks for permission. Refused or unavailable: the search goes on in
  // the town, and the person is told why.
  const chooseScope = (next: 'cerca' | 'localidad' | 'provincia') => {
    setScopeNotice('')
    if (next !== 'cerca') return setScope(next)
    const sinUbicacion = (texto: string) => { setLocating(false); setPoint(null); setScope(locality ? 'localidad' : ''); setScopeNotice(texto) }
    if (typeof navigator === 'undefined' || !navigator.geolocation) return sinUbicacion('Este dispositivo no nos deja saber dónde estás. Buscamos en tu localidad.')
    setLocating(true)
    setScope('cerca')
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocating(false); setPoint({ lat: position.coords.latitude, lng: position.coords.longitude }) },
      () => sinUbicacion('No pudimos usar tu ubicación. Buscamos en tu localidad; podés cambiarlo cuando quieras.'),
      { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 10_000 }
    )
  }
  const key = JSON.stringify(filters)
  useEffect(() => setPage(1), [key])

  const results = useQuery({
    queryKey: ['trabajadores', key, page],
    queryFn: ({ signal }) => client.list({ ...filters, pagina: page }, signal),
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
    setScope('')
    setPoint(null)
    setScopeNotice('')
  }

  const loadingFirstPage = results.isPending && page === 1
  // Sin filtros, vacío significa que todavía no hay profesionales publicados.
  const filtered = Boolean(debouncedQuery.trim() || profession || zone || verified || today || scope)
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

      <fieldset className={styles.scope} data-donde-buscar={scope || 'sin-elegir'}>
        <legend>¿Dónde querés buscar?</legend>
        <label className={styles.scopeOption}>
          <input checked={scope === 'cerca'} name="donde-buscar" onChange={() => chooseScope('cerca')} type="radio" />
          <span>
            <strong>Cerca de mí</strong>
            <small>{locating ? 'Buscando tu ubicación…' : 'Prestadores dentro de 8 km de tu ubicación actual.'}</small>
          </span>
        </label>
        {locality ? (
          <>
            <label className={styles.scopeOption}>
              <input checked={scope === 'localidad'} name="donde-buscar" onChange={() => chooseScope('localidad')} type="radio" />
              <span>
                <strong>En mi localidad</strong>
                <small>{locality.name}</small>
              </span>
            </label>
            <label className={styles.scopeOption}>
              <input checked={scope === 'provincia'} name="donde-buscar" onChange={() => chooseScope('provincia')} type="radio" />
              <span>
                <strong>En toda mi provincia</strong>
                <small>{locality.province}</small>
              </span>
            </label>
          </>
        ) : null}
        {localities.length > 1 && (scope === 'localidad' || scope === 'provincia') ? (
          <label className={styles.check}>
            <span>Localidad</span>
            <select className={styles.select} onChange={(event) => setLocalityId(event.target.value)} value={locality?.id ?? ''}>
              {localities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {scopeNotice ? <p className={styles.scopeNotice} role="status">{scopeNotice}</p> : null}
      </fieldset>

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
            {filtered ? 'No encontramos profesionales con esos filtros.' : 'Todavía no hay profesionales publicados en TUS. Contale tu problema al asistente o publicá tu solicitud en el mapa para que se ofrezcan.'}
            <div className={styles.stateActions}>
              {filtered ? (
                <button className={homeStyles.buttonSecondary} onClick={clear} type="button">
                  Ver todos
                </button>
              ) : (
                <a className={homeStyles.buttonSecondary} href="/publicar">
                  Publicar mi solicitud
                </a>
              )}
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
