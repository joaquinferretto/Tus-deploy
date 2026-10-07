'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import type {
  AlojamientoPublicoDTO,
  FiltrosBusquedaAlojamientos,
  TipoAlojamientoDTO,
} from '@factory/contracts'
import { buscarAlojamientos, hoyAlojamientos, listarTiposAlojamiento, sumarDiasFecha } from './alojamientos-client'
import styles from './alojamientos.module.css'

const AlojamientosMap = dynamic(() => import('./alojamientos-map'), {
  ssr: false,
  loading: () => <div style={{ height: 550, background: '#f3f4f6', borderRadius: 16 }} />,
})

function formatPrice(amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function AlojamientosDirectory(): React.ReactNode {
  const [tipos, setTipos] = useState<TipoAlojamientoDTO[]>([])
  const [alojamientos, setAlojamientos] = useState<AlojamientoPublicoDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'split' | 'list' | 'map'>('split')
  const [aviso, setAviso] = useState<string | null>(null)

  const [filtros, setFiltros] = useState<FiltrosBusquedaAlojamientos>({
    q: '',
    tipoSlug: '',
    checkIn: '',
    checkOut: '',
    personas: 2,
  })

  useEffect(() => {
    listarTiposAlojamiento()
      .then(setTipos)
      .catch(() => {})
  }, [])

  const cargarAlojamientos = async () => {
    // A stay has both dates, in order: the API refuses anything else, so it is said here first.
    if (Boolean(filtros.checkIn) !== Boolean(filtros.checkOut)) {
      setAviso('Elegí la fecha de entrada y la de salida.')
      return
    }
    if (filtros.checkIn && filtros.checkOut && filtros.checkOut <= filtros.checkIn) {
      setAviso('La salida debe ser posterior a la entrada.')
      return
    }
    setAviso(null)
    setLoading(true)
    try {
      const items = await buscarAlojamientos(filtros)
      setAlojamientos(items)
    } catch (error) {
      setAlojamientos([])
      setAviso(error instanceof Error ? error.message : 'No pudimos buscar alojamientos. Probá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargarAlojamientos()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    cargarAlojamientos()
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alojamientos en TUS</h1>
        <p className={styles.subtitle}>
          Hoteles, cabañas, departamentos y habitaciones verificados para tu estadía o escapada.
        </p>
        <p style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '0.5rem 0 0', fontSize: '0.95rem' }}>
          <Link href={'/alojamientos/reservas' as Route} style={{ color: '#c2410c', fontWeight: 600 }}>Mis reservas</Link>
          <Link href={'/propietario/alojamientos' as Route} style={{ color: '#c2410c', fontWeight: 600 }}>Publicar mi alojamiento</Link>
        </p>
      </header>

      {/* Barra de Filtros */}
      <form onSubmit={handleSubmit} className={styles.filterBar}>
        {aviso ? (
          <p data-busqueda="aviso" role="alert" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            {aviso}
          </p>
        ) : null}
        <div className={styles.filterGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="busqueda-destino">Destino</label>
            <input
              type="search"
              id="busqueda-destino"
              className={styles.formInput}
              maxLength={80}
              placeholder="Barrio, zona o nombre"
              value={filtros.q || ''}
              onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Tipo de alojamiento</label>
            <select
              className={styles.formSelect}
              value={filtros.tipoSlug || ''}
              onChange={(e) => setFiltros({ ...filtros, tipoSlug: e.target.value })}
            >
              <option value="">Todos los tipos</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="busqueda-entrada">Entrada</label>
            <input
              type="date"
              id="busqueda-entrada"
              min={hoyAlojamientos()}
              className={styles.formInput}
              value={filtros.checkIn || ''}
              onChange={(e) => setFiltros({ ...filtros, checkIn: e.target.value })}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="busqueda-salida">Salida</label>
            <input
              type="date"
              id="busqueda-salida"
              min={filtros.checkIn ? sumarDiasFecha(filtros.checkIn, 1) : hoyAlojamientos()}
              className={styles.formInput}
              value={filtros.checkOut || ''}
              onChange={(e) => setFiltros({ ...filtros, checkOut: e.target.value })}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Huéspedes</label>
            <select
              className={styles.formSelect}
              value={filtros.personas || 2}
              onChange={(e) => setFiltros({ ...filtros, personas: Number(e.target.value) })}
            >
              <option value={1}>1 persona</option>
              <option value={2}>2 personas</option>
              <option value={3}>3 personas</option>
              <option value={4}>4 personas</option>
              <option value={5}>5+ personas</option>
            </select>
          </div>

          <button type="submit" className={styles.btnSearch}>
            Buscar
          </button>
        </div>
      </form>

      {/* Controles de vista */}
      <div className={styles.viewControls}>
        <span style={{ fontSize: '0.95rem', color: '#4b5563', fontWeight: 500 }}>
          {loading ? 'Buscando...' : `${alojamientos.length} alojamientos disponibles`}
        </span>
        <div className={styles.viewTabs}>
          <button
            type="button"
            className={`${styles.viewTab} ${viewMode === 'split' ? styles.viewTabActive : ''}`}
            onClick={() => setViewMode('split')}
          >
            Dividido
          </button>
          <button
            type="button"
            className={`${styles.viewTab} ${viewMode === 'list' ? styles.viewTabActive : ''}`}
            onClick={() => setViewMode('list')}
          >
            Lista
          </button>
          <button
            type="button"
            className={`${styles.viewTab} ${viewMode === 'map' ? styles.viewTabActive : ''}`}
            onClick={() => setViewMode('map')}
          >
            Mapa
          </button>
        </div>
      </div>

      {/* Layout principal */}
      <div
        className={`${styles.mainLayout} ${
          viewMode === 'split' ? styles.mainLayoutSplit : ''
        }`}
      >
        {/* Listado de tarjetas */}
        {(viewMode === 'split' || viewMode === 'list') && (
          <div className={styles.cardsGrid}>
            {alojamientos.map((a) => {
              const primaryImg =
                a.imagenes.find((img) => img.esPrincipal) || a.imagenes[0]

              return (
                <Link
                  key={a.id}
                  href={`/alojamientos/${a.slug || a.id}` as Route}
                  className={styles.card}
                  onMouseEnter={() => setSelectedId(a.id)}
                >
                  <div className={styles.cardImageWrapper}>
                    {primaryImg ? (
                      <img
                        src={primaryImg.url}
                        alt={primaryImg.alt || a.nombre}
                        className={styles.cardImage}
                      />
                    ) : (
                      <div className={styles.cardImagePlaceholder}>Sin fotos</div>
                    )}
                    <span className={styles.typeBadge}>{a.tipo.nombre}</span>
                  </div>

                  <div className={styles.cardContent}>
                    <div className={styles.cardHeader}>
                      <h3 className={styles.cardTitle}>{a.nombre}</h3>
                      {a.rating && (
                        <div className={styles.ratingTag}>
                          <span className={styles.starIcon}>★</span>
                          <span>{a.rating.average}</span>
                        </div>
                      )}
                    </div>

                    <div className={styles.locationText}>
                      {[a.barrioNombre, a.zonaNombre, a.direccion]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>

                    {a.comodidades.length > 0 && (
                      <div className={styles.amenitiesRow}>
                        {a.comodidades.slice(0, 3).map((c, i) => (
                          <span key={i} className={styles.amenityPill}>
                            {c}
                          </span>
                        ))}
                        {a.comodidades.length > 3 && (
                          <span className={styles.amenityPill}>
                            +{a.comodidades.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    <div className={styles.cardFooter}>
                      <div>
                        <div className={styles.priceLabel}>
                          {filtros.checkIn && filtros.checkOut
                            ? 'Total estadía'
                            : 'Desde'}
                        </div>
                        <div className={styles.priceValue}>
                          {a.precioDesde
                            ? formatPrice(a.precioDesde.amount)
                            : 'Consultar'}
                        </div>
                      </div>
                      <span className={styles.btnDetail}>Ver unidades</span>
                    </div>
                  </div>
                </Link>
              )
            })}

            {!loading && alojamientos.length === 0 && (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '1.1rem', color: '#6b7280' }}>
                  No se encontraron alojamientos para los criterios seleccionados.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Mapa */}
        {(viewMode === 'split' || viewMode === 'map') && (
          <AlojamientosMap
            alojamientos={alojamientos}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </div>
    </div>
  )
}
