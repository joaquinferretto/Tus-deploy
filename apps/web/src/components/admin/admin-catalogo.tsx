'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'

import { ICON_KEYS, categoryMarkerSvg } from '@/features/home/category-icons'
import {
  adminApi,
  adminErrorMessage,
  catalogoErrorMessage,
  type AdminCatalogo,
  type AdminOficio,
  type EntidadCatalogo,
  type FiltroCatalogo,
  type ItemCatalogo,
} from '@/lib/tus-admin-api'
import { AdminConfirm, useConfirmacion, type ConfirmacionAdmin } from './admin-confirm'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
import styles from './admin.module.css'

// ABM of the administered catalog: categories, trades (with synonyms and icon) and locations
// (locality -> zone -> neighbourhood). Nothing is deleted: deactivating keeps history and hides the
// record from new selections. The API validates everything again and audits each change. Lists
// are paginated and filtered by the API (10 / 25 / 50 per page).

const PuntoMapa = dynamic(() => import('./admin-punto-mapa'), { ssr: false, loading: () => <p className={styles.muted}>Cargando mapa…</p> })

// Whole catalog, only for selectors (categories, localities, zones) and the map context.
function useReferencias() {
  const [data, setData] = useState<AdminCatalogo | null>(null)
  const load = useCallback(() => adminApi.catalogo().then(setData).catch(() => undefined), [])
  useEffect(() => { void load() }, [load])
  return { data, load }
}

type Filtros = Omit<FiltroCatalogo, 'page' | 'pageSize'>

// One entity page from the API. Changing a filter goes back to page 1; paging keeps the filters.
function useLista<E extends EntidadCatalogo>(entidad: E, inicial: Filtros) {
  const [filtros, setFiltrosState] = useState<Filtros>(inicial)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(25)
  const [result, setResult] = useState<{ items: ItemCatalogo[E][]; total: number; totalPages: number } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(
    () => adminApi.listaCatalogo(entidad, { ...filtros, q: filtros.q.trim(), page, pageSize })
      .then((value) => { setResult({ items: value.items, total: value.total, totalPages: value.totalPages }); setError('') })
      .catch((cause) => setError(adminErrorMessage(cause))),
    [entidad, filtros, page, pageSize]
  )
  useEffect(() => {
    const timer = setTimeout(() => void load(), 300)
    return () => clearTimeout(timer)
  }, [load])
  const setFiltros = (cambio: Partial<Filtros>) => { setFiltrosState((actual) => ({ ...actual, ...cambio })); setPage(1) }
  const setPageSize = (size: number) => { setPageSizeState(size); setPage(1) }
  const paginacion = result ? <AdminPagination onPage={setPage} onPageSize={setPageSize} page={page} pageSize={pageSize} totalPages={result.totalPages} /> : null
  return { filtros, setFiltros, result, error, load, paginacion }
}

function Estado({ activo }: { activo: boolean }) {
  return <span className={`${styles.badge} ${activo ? styles.badgeOk : styles.badgeOff}`}>{activo ? 'Activo' : 'Inactivo'}</span>
}

function FiltroEstado({ value, onChange }: { value: Filtros['estado']; onChange: (value: Filtros['estado']) => void }) {
  return (
    <select aria-label="Estado" onChange={(event) => onChange(event.target.value as Filtros['estado'])} value={value}>
      <option value="">Todos los estados</option>
      <option value="activo">Activos</option>
      <option value="inactivo">Inactivos</option>
    </select>
  )
}

function Icono({ clave }: { clave: string }) {
  // Our own SVG paths only (never catalog-provided markup), drawn as an image.
  const svg = categoryMarkerSvg(clave).replace('stroke="currentColor"', 'stroke="#e64f00"')
  // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI
  return <img alt="" aria-hidden="true" className={styles.iconBadge} height={28} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} width={28} />
}

// Activate at once; deactivate only after the confirmation modal.
function BotonEstado({ activo, busy, onCambiar, confirmacion, pedir }: {
  activo: boolean
  busy: boolean
  onCambiar: (activo: boolean) => Promise<unknown>
  confirmacion: Omit<ConfirmacionAdmin, 'onConfirm' | 'confirmar'>
  pedir: (value: ConfirmacionAdmin) => void
}) {
  if (!activo) return <button className={styles.buttonSecondary} disabled={busy} onClick={() => void onCambiar(true)} type="button">Activar</button>
  return <button className={styles.buttonSecondary} disabled={busy} onClick={() => pedir({ ...confirmacion, confirmar: 'Desactivar', onConfirm: () => onCambiar(false) })} type="button">Desactivar</button>
}

function useGuardar(onSaved: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const guardar = async (entidad: EntidadCatalogo, id: string | null, body: Record<string, unknown>, ok: string) => {
    setBusy(true)
    setMensaje(null)
    try {
      await adminApi.guardar(entidad, id, body)
      await onSaved()
      setMensaje({ tipo: 'ok', texto: ok })
      return true
    } catch (cause) {
      setMensaje({ tipo: 'error', texto: catalogoErrorMessage(cause) })
      return false
    } finally {
      setBusy(false)
    }
  }
  const aviso = mensaje ? <p className={mensaje.tipo === 'ok' ? styles.success : styles.error} role={mensaje.tipo === 'ok' ? 'status' : 'alert'}>{mensaje.texto}</p> : null
  return { busy, guardar, aviso }
}

// ---- Categorías -----------------------------------------------------------------------------

// Detail of a category: its services with provider counts; a service can be moved to another
// category from here (the history and the providers that offer it are kept).
function ServiciosDeCategoria({ categoria, categorias, onCambio }: { categoria: AdminCatalogo['categorias'][number]; categorias: AdminCatalogo['categorias']; onCambio: () => Promise<unknown> }) {
  const [items, setItems] = useState<AdminOficio[] | null>(null)
  const [error, setError] = useState('')
  const cargar = useCallback(() => adminApi.listaCatalogo('oficios', { q: '', estado: '', categoria: categoria.id, page: 1, pageSize: 50 })
    .then((value) => { setItems(value.items); setError('') })
    .catch((cause) => setError(adminErrorMessage(cause))), [categoria.id])
  useEffect(() => { void cargar() }, [cargar])
  const { busy, guardar, aviso } = useGuardar(async () => { await cargar(); await onCambio() })
  return (
    <section aria-label={`Servicios de ${categoria.nombre}`} className={styles.card}>
      <h2>Servicios de {categoria.nombre}</h2>
      {aviso}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!items && !error ? <p className={styles.muted} role="status">Cargando servicios…</p> : null}
      {items && items.length === 0 ? <p className={styles.muted}>Esta categoría todavía no tiene servicios. Creálos o movelos desde Servicios.</p> : null}
      {items && items.length > 0 ? (
        <table className={styles.table}>
          <thead><tr><th>Servicio</th><th>Prestadores</th><th>Estado</th><th>Mover a</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td data-label="Servicio"><strong>{item.nombre}</strong></td>
                <td data-label="Prestadores">{item.prestadores} <span className={styles.muted}>· {item.enMapa} en el mapa</span></td>
                <td data-label="Estado"><Estado activo={item.activo} /></td>
                <td data-label="Mover a">
                  <select aria-label={`Mover ${item.nombre} a otra categoría`} disabled={busy} onChange={(event) => void guardar('oficios', item.id, { categoriaId: event.target.value || null }, `${item.nombre} se movió de categoría.`)} value={item.categoriaId ?? ''}>
                    <option value="">Sin categoría</option>
                    {categorias.filter((otra) => otra.activo || otra.id === item.categoriaId).map((otra) => <option key={otra.id} value={otra.id}>{otra.nombre}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <a className={styles.buttonSecondary} href="/tus/admin/servicios">Crear o editar servicios</a>
    </section>
  )
}

export function AdminCategorias(): React.ReactNode {
  const lista = useLista('categorias', { q: '', estado: '' })
  const { busy, guardar, aviso } = useGuardar(lista.load)
  const [confirmacion, pedir, cerrar] = useConfirmacion()
  const [edit, setEdit] = useState<{ id: string | null; nombre: string; descripcion: string; orden: string } | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const referencias = useReferencias()

  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (!edit) return
    const ok = await guardar('categorias', edit.id, { nombre: edit.nombre, descripcion: edit.descripcion, orden: Number(edit.orden || 0) }, edit.id ? 'Categoría actualizada.' : 'Categoría creada.')
    if (ok) setEdit(null)
  }

  const items = lista.result?.items
  return (
    <>
      <AdminPageHeader subtitle="Agrupan los servicios (oficios)" title="Categorías">
        <button className={styles.buttonPrimary} onClick={() => setEdit({ id: null, nombre: '', descripcion: '', orden: '0' })} type="button">Nueva categoría</button>
      </AdminPageHeader>
      {aviso}
      {edit ? (
        <form className={`${styles.card} ${styles.form}`} onSubmit={(event) => void enviar(event)}>
          <h2>{edit.id ? 'Editar categoría' : 'Nueva categoría'}</h2>
          <label>Nombre<input maxLength={60} onChange={(event) => setEdit({ ...edit, nombre: event.target.value })} required value={edit.nombre} /></label>
          <label>Descripción<input maxLength={200} onChange={(event) => setEdit({ ...edit, descripcion: event.target.value })} value={edit.descripcion} /></label>
          <label>Orden<input max={999} min={0} onChange={(event) => setEdit({ ...edit, orden: event.target.value })} type="number" value={edit.orden} /></label>
          <div className={styles.chips}>
            <button className={styles.buttonPrimary} disabled={busy || edit.nombre.trim().length < 2} type="submit">{busy ? 'Guardando…' : 'Guardar'}</button>
            <button className={styles.buttonSecondary} onClick={() => setEdit(null)} type="button">Cancelar</button>
          </div>
        </form>
      ) : null}
      <div className={styles.filters}>
        <input aria-label="Buscar categoría" onChange={(event) => lista.setFiltros({ q: event.target.value })} placeholder="Buscar por nombre" type="search" value={lista.filtros.q} />
        <FiltroEstado onChange={(estado) => lista.setFiltros({ estado })} value={lista.filtros.estado} />
      </div>
      {lista.error ? <p className={styles.error} role="alert">{lista.error}</p> : null}
      {!items && !lista.error ? <p className={styles.muted} role="status">Cargando categorías…</p> : null}
      {items && items.length === 0 ? <AdminEmpty text={lista.filtros.q || lista.filtros.estado ? 'No hay categorías con esos filtros.' : 'Todavía no hay categorías.'} /> : null}
      {items && items.length > 0 ? (
        <table className={styles.table}>
          <thead><tr><th>Nombre</th><th>Descripción</th><th>Servicios</th><th>Estado</th><th>Orden</th><th /></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td data-label="Nombre"><strong>{item.nombre}</strong></td>
                <td className={styles.muted} data-label="Descripción">{item.descripcion ?? '—'}</td>
                <td data-label="Servicios">{item.oficios}</td>
                <td data-label="Estado"><Estado activo={item.activo} /></td>
                <td data-label="Orden">{item.orden}</td>
                <td>
                  <div className={styles.chips}>
                    <button aria-expanded={abierta === item.id} className={styles.buttonSecondary} onClick={() => setAbierta(abierta === item.id ? null : item.id)} type="button">{abierta === item.id ? 'Ocultar servicios' : 'Ver servicios'}</button>
                    <button className={styles.buttonSecondary} onClick={() => setEdit({ id: item.id, nombre: item.nombre, descripcion: item.descripcion ?? '', orden: String(item.orden) })} type="button">Editar</button>
                    <BotonEstado
                      activo={item.activo}
                      busy={busy}
                      confirmacion={{ titulo: `¿Desactivar ${item.nombre}?`, detalle: 'Sus servicios dejan de ofrecerse en nuevas solicitudes y búsquedas. El historial existente se conserva.' }}
                      onCambiar={(activo) => guardar('categorias', item.id, { activo }, activo ? 'Categoría activada.' : 'Categoría desactivada: sus servicios dejan de ofrecerse.')}
                      pedir={pedir}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {lista.paginacion}
      {abierta && referencias.data ? (() => {
        const categoria = referencias.data.categorias.find((item) => item.id === abierta)
        return categoria ? <ServiciosDeCategoria categoria={categoria} categorias={referencias.data.categorias} key={categoria.id} onCambio={async () => { await lista.load(); await referencias.load() }} /> : null
      })() : null}
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}

// ---- Servicios / oficios ----------------------------------------------------------------------

// Same normalization as the API (lower case, no accents, single spaces): the search compares that way.
export const normalizarPalabra = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()
const PALABRAS_MAXIMAS = 80

function EditorPalabras({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [texto, setTexto] = useState('')
  const [aviso, setAviso] = useState('')
  const agregar = () => {
    // Several at once are allowed: "cañería, pérdida de agua".
    const nuevas = texto.split(',').map(normalizarPalabra).filter(Boolean)
    if (nuevas.length === 0) return
    const invalidas = nuevas.filter((item) => item.length < 2 || item.length > 40)
    const repetidas = nuevas.filter((item) => value.includes(item))
    const validas = [...new Set(nuevas.filter((item) => item.length >= 2 && item.length <= 40 && !value.includes(item)))]
    const resultado = [...value, ...validas].slice(0, PALABRAS_MAXIMAS)
    onChange(resultado)
    setTexto('')
    setAviso(invalidas.length ? 'Cada palabra debe tener entre 2 y 40 caracteres.' : repetidas.length ? `Ya estaba: ${repetidas.join(', ')}.` : resultado.length < value.length + validas.length ? `Máximo ${PALABRAS_MAXIMAS} palabras.` : '')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); agregar() }
    if (event.key === 'Backspace' && !texto && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div>
      <span className={styles.cardLabel}>Palabras clave de búsqueda ({value.length})</span>
      <div className={styles.tagEditor}>
        {value.map((palabra) => (
          <span className={styles.tag} key={palabra}>
            {palabra}
            <button aria-label={`Quitar ${palabra}`} onClick={() => onChange(value.filter((item) => item !== palabra))} type="button">×</button>
          </span>
        ))}
        <input aria-label="Agregar palabra clave" maxLength={120} onBlur={agregar} onChange={(event) => setTexto(event.target.value)} onKeyDown={onKeyDown} placeholder="Escribí y presioná Enter" value={texto} />
      </div>
      {aviso ? <span className={styles.muted} role="status">{aviso}</span> : <span className={styles.muted}>Se guardan sin acentos ni mayúsculas, igual que las compara la búsqueda.</span>}
    </div>
  )
}

type OficioForm = { id: string | null; nombre: string; profesion: string; categoriaId: string; descripcion: string; icono: string; orden: string; sinonimos: string[] }

const aForm = (item: AdminOficio | null): OficioForm =>
  item
    ? { id: item.id, nombre: item.nombre, profesion: item.profesion, categoriaId: item.categoriaId ?? '', descripcion: item.descripcion ?? '', icono: item.icono, orden: String(item.orden), sinonimos: item.sinonimos }
    : { id: null, nombre: '', profesion: '', categoriaId: '', descripcion: '', icono: 'herramienta', orden: '0', sinonimos: [] }

export function AdminServicios(): React.ReactNode {
  const referencias = useReferencias()
  const lista = useLista('oficios', { q: '', estado: '', categoria: '' })
  const { busy, guardar, aviso } = useGuardar(async () => { await Promise.all([lista.load(), referencias.load()]) })
  const [confirmacion, pedir, cerrar] = useConfirmacion()
  const [edit, setEdit] = useState<OficioForm | null>(null)
  const categorias = referencias.data?.categorias ?? []

  async function enviar(event: FormEvent) {
    event.preventDefault()
    if (!edit) return
    const body = {
      nombre: edit.nombre,
      profesion: edit.profesion || edit.nombre,
      categoriaId: edit.categoriaId || null,
      descripcion: edit.descripcion,
      icono: edit.icono,
      orden: Number(edit.orden || 0),
      sinonimos: edit.sinonimos,
    }
    const ok = await guardar('oficios', edit.id, body, edit.id ? 'Servicio actualizado: la búsqueda y el asistente ya lo usan.' : 'Servicio creado: ya aparece en formularios, búsqueda y asistente.')
    if (ok) setEdit(null)
  }

  const categoria = (id: string | null) => categorias.find((item) => item.id === id)?.nombre ?? 'Sin categoría'
  const items = lista.result?.items

  return (
    <>
      <AdminPageHeader subtitle="Oficios que usan el mapa, el buscador, el asistente, las solicitudes y los perfiles" title="Servicios">
        <button className={styles.buttonPrimary} onClick={() => setEdit(aForm(null))} type="button">Nuevo servicio</button>
      </AdminPageHeader>
      {aviso}
      {edit ? (
        <form className={`${styles.card} ${styles.form}`} onSubmit={(event) => void enviar(event)}>
          <h2>{edit.id ? 'Editar servicio' : 'Nuevo servicio'}</h2>
          <label>Nombre<input maxLength={60} onChange={(event) => setEdit({ ...edit, nombre: event.target.value })} placeholder="Ej.: Cerrajería" required value={edit.nombre} /></label>
          <label>Nombre del profesional<input maxLength={60} onChange={(event) => setEdit({ ...edit, profesion: event.target.value })} placeholder="Ej.: Cerrajero/a" value={edit.profesion} /></label>
          <label>Categoría
            <select onChange={(event) => setEdit({ ...edit, categoriaId: event.target.value })} value={edit.categoriaId}>
              <option value="">Sin categoría</option>
              {categorias.filter((item) => item.activo || item.id === edit.categoriaId).map((item) => <option key={item.id} value={item.id}>{item.nombre}{item.activo ? '' : ' (inactiva)'}</option>)}
            </select>
          </label>
          <label>Descripción<input maxLength={200} onChange={(event) => setEdit({ ...edit, descripcion: event.target.value })} value={edit.descripcion} /></label>
          <fieldset className={styles.iconPicker}>
            <legend>Ícono en el mapa</legend>
            {ICON_KEYS.filter((key) => key !== 'otros').map((key) => (
              <label className={edit.icono === key ? styles.iconSelected : undefined} key={key} title={key}>
                <input checked={edit.icono === key} name="icono" onChange={() => setEdit({ ...edit, icono: key })} type="radio" value={key} />
                <Icono clave={key} />
              </label>
            ))}
          </fieldset>
          <EditorPalabras onChange={(sinonimos) => setEdit({ ...edit, sinonimos })} value={edit.sinonimos} />
          <label>Orden<input max={999} min={0} onChange={(event) => setEdit({ ...edit, orden: event.target.value })} type="number" value={edit.orden} /></label>
          <div className={styles.chips}>
            <button className={styles.buttonPrimary} disabled={busy || edit.nombre.trim().length < 2} type="submit">{busy ? 'Guardando…' : 'Guardar'}</button>
            <button className={styles.buttonSecondary} onClick={() => setEdit(null)} type="button">Cancelar</button>
          </div>
        </form>
      ) : null}
      <div className={styles.filters}>
        <input aria-label="Buscar servicio" onChange={(event) => lista.setFiltros({ q: event.target.value })} placeholder="Buscar por nombre o palabra clave" type="search" value={lista.filtros.q} />
        <select aria-label="Categoría" onChange={(event) => lista.setFiltros({ categoria: event.target.value })} value={lista.filtros.categoria}>
          <option value="">Todas las categorías</option>
          {categorias.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
        </select>
        <FiltroEstado onChange={(estado) => lista.setFiltros({ estado })} value={lista.filtros.estado} />
      </div>
      {lista.error ? <p className={styles.error} role="alert">{lista.error}</p> : null}
      {!items && !lista.error ? <p className={styles.muted} role="status">Cargando servicios…</p> : null}
      {items && items.length === 0 ? <AdminEmpty text={lista.filtros.q || lista.filtros.estado || lista.filtros.categoria ? 'No hay servicios con esos filtros.' : 'Todavía no hay servicios.'} /> : null}
      {items && items.length > 0 ? (
        <table className={styles.table}>
          <thead><tr><th>Servicio</th><th>Categoría</th><th>Palabras clave</th><th>Prestadores</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td data-label="Servicio"><span className={styles.chips} style={{ alignItems: 'center' }}><Icono clave={item.icono} /><strong>{item.nombre}</strong></span><div className={styles.muted}>{item.profesion}</div></td>
                <td data-label="Categoría">{categoria(item.categoriaId)}</td>
                <td data-label="Palabras clave"><div className={styles.keywords}>{item.sinonimos.slice(0, 8).map((word) => <span key={word}>{word}</span>)}{item.sinonimos.length > 8 ? <span>+{item.sinonimos.length - 8}</span> : null}</div></td>
                <td data-label="Prestadores" title="Prestadores aprobados con este servicio · visibles con zona en el mapa">{item.prestadores} <span className={styles.muted}>· {item.enMapa} en el mapa</span></td>
                <td data-label="Estado"><Estado activo={item.activo} /></td>
                <td>
                  <div className={styles.chips}>
                    <button className={styles.buttonSecondary} onClick={() => setEdit(aForm(item))} type="button">Editar</button>
                    <BotonEstado
                      activo={item.activo}
                      busy={busy}
                      confirmacion={{ titulo: `¿Desactivar ${item.nombre}?`, detalle: 'Ya no podrá usarse en nuevas solicitudes ni búsquedas. El historial existente se conservará.' }}
                      onCambiar={(activo) => guardar('oficios', item.id, { activo }, activo ? 'Servicio activado.' : 'Servicio desactivado: se conserva en los registros existentes.')}
                      pedir={pedir}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {lista.paginacion}
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}

// ---- Ubicaciones: localidades, zonas y barrios -----------------------------------------------------

type Punto = { lat: number; lng: number }
type BarrioForm = { id: string | null; nombre: string; localidadId: string; zonaId: string; puntos: Punto[]; punto: Punto | null; orden: string }
type ZonaForm = { id: string | null; nombre: string; localidadId: string; puntos: Punto[]; punto: Punto | null }

const puntosDePoligono = (poligono: { coordinates: [number, number][][] } | null): Punto[] => {
  if (!poligono) return []
  const ring = poligono.coordinates[0] ?? []
  const abierto = ring.length > 1 && ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1] ? ring.slice(0, -1) : ring
  return abierto.map(([lng, lat]) => ({ lat, lng }))
}

const centroDe = (puntos: Punto[]): Punto | null => (puntos.length ? { lat: Math.round((puntos.reduce((sum, item) => sum + item.lat, 0) / puntos.length) * 1e6) / 1e6, lng: Math.round((puntos.reduce((sum, item) => sum + item.lng, 0) / puntos.length) * 1e6) / 1e6 } : null)
// Label of the geography of a zone / neighbourhood in the lists.
const geografia = (item: { poligono: unknown; lat: number | null }) => (item.poligono ? 'Polígono' : item.lat !== null ? 'Punto de referencia' : 'Sin geografía')

const geoJson = (puntos: Punto[]) => ({ type: 'Polygon' as const, coordinates: [[...puntos.map(({ lat, lng }) => [lng, lat] as [number, number]), ...(puntos[0] ? [[puntos[0].lng, puntos[0].lat] as [number, number]] : [])]] })

export function AdminZonas(): React.ReactNode {
  const referencias = useReferencias()
  const zonas = useLista('zonas', { q: '', estado: '', localidad: '' })
  const barrios = useLista('barrios', { q: '', estado: '', localidad: '', zona: '' })
  const { busy, guardar, aviso } = useGuardar(async () => { await Promise.all([zonas.load(), barrios.load(), referencias.load()]) })
  const [confirmacion, pedir, cerrar] = useConfirmacion()
  const [localidad, setLocalidad] = useState<{ id: string | null; nombre: string; provincia: string; lat: string; lng: string } | null>(null)
  const [zona, setZona] = useState<ZonaForm | null>(null)
  const [barrio, setBarrio] = useState<BarrioForm | null>(null)
  const data = referencias.data

  const nombreLocalidad = (id: string) => data?.localidades.find((item) => item.id === id)?.nombre ?? '—'
  const nombreZona = (id: string | null) => (id ? (data?.zonas.find((item) => item.id === id)?.nombre ?? '—') : 'Sin zona')
  const primeraLocalidad = data?.localidades[0]?.id ?? ''
  const listaZonas = zonas.result?.items
  const listaBarrios = barrios.result?.items

  return (
    <>
      <AdminPageHeader subtitle="Localidades, zonas y barrios que usan el mapa, la búsqueda y los formularios" title="Zonas y barrios">
        <div className={styles.chips}>
          <button className={styles.buttonSecondary} onClick={() => setLocalidad({ id: null, nombre: '', provincia: '', lat: '', lng: '' })} type="button">Nueva localidad</button>
          <button className={styles.buttonSecondary} disabled={!primeraLocalidad} onClick={() => setZona({ id: null, nombre: '', localidadId: primeraLocalidad, puntos: [], punto: null })} type="button">Nueva zona</button>
          <button className={styles.buttonPrimary} disabled={!primeraLocalidad} onClick={() => setBarrio({ id: null, nombre: '', localidadId: primeraLocalidad, zonaId: '', puntos: [], punto: null, orden: '0' })} type="button">Nuevo barrio</button>
        </div>
      </AdminPageHeader>
      {aviso}

      {localidad ? (
        <form className={`${styles.card} ${styles.form}`} onSubmit={async (event) => { event.preventDefault(); if (await guardar('localidades', localidad.id, { nombre: localidad.nombre, provincia: localidad.provincia, lat: localidad.lat.trim() === '' ? null : Number(localidad.lat), lng: localidad.lng.trim() === '' ? null : Number(localidad.lng) }, 'Localidad guardada.')) setLocalidad(null) }}>
          <h2>{localidad.id ? 'Editar localidad' : 'Nueva localidad'}</h2>
          <label>Nombre<input maxLength={60} onChange={(event) => setLocalidad({ ...localidad, nombre: event.target.value })} placeholder="Ej.: Corrientes Capital" required value={localidad.nombre} /></label>
          <label>Provincia<input maxLength={60} onChange={(event) => setLocalidad({ ...localidad, provincia: event.target.value })} placeholder="Ej.: Corrientes" required value={localidad.provincia} /></label>
          <label>Latitud del centro (opcional)<input inputMode="decimal" onChange={(event) => setLocalidad({ ...localidad, lat: event.target.value })} placeholder="-27.4692" value={localidad.lat} /></label>
          <label>Longitud del centro (opcional)<input inputMode="decimal" onChange={(event) => setLocalidad({ ...localidad, lng: event.target.value })} placeholder="-58.8306" value={localidad.lng} /></label>
          <p className={styles.muted}>El centro ubica el mapa de las personas que viven en la localidad. La provincia se asocia por nombre al listado de provincias.</p>
          <div className={styles.chips}><button className={styles.buttonPrimary} disabled={busy} type="submit">Guardar</button><button className={styles.buttonSecondary} onClick={() => setLocalidad(null)} type="button">Cancelar</button></div>
        </form>
      ) : null}

      {zona ? (
        <form className={`${styles.card} ${styles.form}`} onSubmit={async (event) => { event.preventDefault(); if (await guardar('zonas', zona.id, { nombre: zona.nombre, localidadId: zona.localidadId, poligono: zona.puntos.length >= 3 ? geoJson(zona.puntos) : null, lat: zona.punto?.lat ?? null, lng: zona.punto?.lng ?? null }, 'Zona guardada: su geografía ya ubica a los prestadores en el mapa.')) setZona(null) }}>
          <h2>{zona.id ? 'Editar zona' : 'Nueva zona'}</h2>
          <label>Nombre<input maxLength={60} onChange={(event) => setZona({ ...zona, nombre: event.target.value })} placeholder="Ej.: Norte" required value={zona.nombre} /></label>
          <label>Localidad<select onChange={(event) => setZona({ ...zona, localidadId: event.target.value })} value={zona.localidadId}>{data?.localidades.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
          <div>
            <span className={styles.cardLabel}>Geografía (opcional): dibujá el polígono de la zona o, si no, marcá un punto de referencia</span>
            <PuntoMapa barrios={data?.barrios ?? []} onChange={(puntos) => setZona({ ...zona, puntos })} onPoint={(punto) => setZona({ ...zona, punto })} point={zona.punto} value={zona.puntos} />
          </div>
          <div className={styles.chips}><button className={styles.buttonPrimary} disabled={busy || (zona.puntos.length > 0 && zona.puntos.length < 3)} type="submit">Guardar</button><button className={styles.buttonSecondary} onClick={() => setZona(null)} type="button">Cancelar</button></div>
        </form>
      ) : null}

      {barrio ? (
        <form className={`${styles.card} ${styles.form}`} onSubmit={async (event) => { event.preventDefault(); const referencia = barrio.punto ?? centroDe(barrio.puntos); if (await guardar('barrios', barrio.id, { nombre: barrio.nombre, localidadId: barrio.localidadId, zonaId: barrio.zonaId || null, lat: referencia?.lat ?? null, lng: referencia?.lng ?? null, poligono: barrio.puntos.length >= 3 ? geoJson(barrio.puntos) : null, orden: Number(barrio.orden || 0) }, 'Barrio guardado: ya se reconoce en la búsqueda, el mapa y los formularios.')) setBarrio(null) }}>
          <h2>{barrio.id ? 'Editar barrio' : 'Nuevo barrio'}</h2>
          <label>Nombre<input maxLength={60} onChange={(event) => setBarrio({ ...barrio, nombre: event.target.value })} placeholder="Ej.: Ponce" required value={barrio.nombre} /></label>
          <label>Localidad<select onChange={(event) => setBarrio({ ...barrio, localidadId: event.target.value, zonaId: '' })} value={barrio.localidadId}>{data?.localidades.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
          <label>Zona<select onChange={(event) => setBarrio({ ...barrio, zonaId: event.target.value })} value={barrio.zonaId}><option value="">Sin zona</option>{data?.zonas.filter((item) => item.localidadId === barrio.localidadId).map((item) => <option key={item.id} value={item.id}>{item.nombre}{item.activo ? '' : ' (inactiva)'}</option>)}</select></label>
          <div>
            <span className={styles.cardLabel}>Geografía: polígono del barrio (opcional) y punto de referencia (si no lo marcás, se usa el centro del polígono)</span>
            <PuntoMapa barrios={(data?.barrios ?? []).filter((item) => item.id !== barrio.id)} onChange={(puntos) => setBarrio({ ...barrio, puntos })} onPoint={(punto) => setBarrio({ ...barrio, punto })} point={barrio.punto} value={barrio.puntos} />
            <span className={styles.muted}>{barrio.puntos.length >= 3 ? 'Polígono listo para guardar.' : barrio.puntos.length ? 'Faltan vértices para formar el polígono.' : barrio.punto ? 'Sin polígono: se usa el punto de referencia.' : 'Marcá al menos un punto de referencia o dibujá el polígono.'}</span>
          </div>
          <label>Orden<input max={999} min={0} onChange={(event) => setBarrio({ ...barrio, orden: event.target.value })} type="number" value={barrio.orden} /></label>
          <div className={styles.chips}><button className={styles.buttonPrimary} disabled={busy || (barrio.puntos.length > 0 && barrio.puntos.length < 3) || (!barrio.punto && barrio.puntos.length < 3) || barrio.nombre.trim().length < 2} type="submit">{busy ? 'Guardando…' : 'Guardar'}</button><button className={styles.buttonSecondary} onClick={() => setBarrio(null)} type="button">Cancelar</button></div>
        </form>
      ) : null}

      <section className={styles.section}>
        <h2>Localidades</h2>
        {!data ? <p className={styles.muted} role="status">Cargando localidades…</p> : data.localidades.length === 0 ? <AdminEmpty text="No hay localidades." /> : (
          <ul className={styles.list}>
            {data.localidades.map((item) => (
              <li className={styles.listItem} key={item.id}>
                <span><strong>{item.nombre}</strong> <span className={styles.muted}>· {item.provincia}</span> <Estado activo={item.activo} /></span>
                <span className={styles.chips}>
                  <button className={styles.buttonSecondary} onClick={() => setLocalidad({ id: item.id, nombre: item.nombre, provincia: item.provincia, lat: item.lat == null ? '' : String(item.lat), lng: item.lng == null ? '' : String(item.lng) })} type="button">Editar</button>
                  <BotonEstado
                    activo={item.activo}
                    busy={busy}
                    confirmacion={{ titulo: `¿Desactivar ${item.nombre}?`, detalle: 'Sus zonas y barrios dejan de ofrecerse en nuevos formularios y búsquedas. El historial existente se conserva.' }}
                    onCambiar={(activo) => guardar('localidades', item.id, { activo }, activo ? 'Localidad activada.' : 'Localidad desactivada.')}
                    pedir={pedir}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2>Zonas</h2>
        <div className={styles.filters}>
          <input aria-label="Buscar zona" onChange={(event) => zonas.setFiltros({ q: event.target.value })} placeholder="Buscar zona" type="search" value={zonas.filtros.q} />
          <select aria-label="Localidad de la zona" onChange={(event) => zonas.setFiltros({ localidad: event.target.value })} value={zonas.filtros.localidad}>
            <option value="">Todas las localidades</option>
            {data?.localidades.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
          <FiltroEstado onChange={(estado) => zonas.setFiltros({ estado })} value={zonas.filtros.estado} />
        </div>
        {zonas.error ? <p className={styles.error} role="alert">{zonas.error}</p> : null}
        {!listaZonas && !zonas.error ? <p className={styles.muted} role="status">Cargando zonas…</p> : null}
        {listaZonas && listaZonas.length === 0 ? <AdminEmpty text={zonas.filtros.q || zonas.filtros.estado || zonas.filtros.localidad ? 'No hay zonas con esos filtros.' : 'Todavía no definiste zonas. Creá una (por ejemplo Norte) y asignale barrios.'} /> : null}
        {listaZonas && listaZonas.length > 0 ? (
          <table className={styles.table}>
            <thead><tr><th>Zona</th><th>Localidad</th><th>Geografía</th><th>Barrios</th><th>Prestadores</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {listaZonas.map((item) => (
                <tr key={item.id}>
                  <td data-label="Zona"><strong>{item.nombre}</strong></td>
                  <td data-label="Localidad">{nombreLocalidad(item.localidadId)}</td>
                  <td data-label="Geografía">{geografia(item)}</td>
                  <td data-label="Barrios">{item.barrios}</td>
                  <td data-label="Prestadores" title="Prestadores aprobados y visibles que atienden algún barrio de la zona">{item.prestadores}</td>
                  <td data-label="Estado"><Estado activo={item.activo} /></td>
                  <td><div className={styles.chips}>
                    <button className={styles.buttonSecondary} onClick={() => setZona({ id: item.id, nombre: item.nombre, localidadId: item.localidadId, puntos: puntosDePoligono(item.poligono), punto: item.lat !== null && item.lng !== null ? { lat: item.lat, lng: item.lng } : null })} type="button">Editar</button>
                    <BotonEstado
                      activo={item.activo}
                      busy={busy}
                      confirmacion={{ titulo: `¿Desactivar la zona ${item.nombre}?`, detalle: 'Sus barrios dejan de ofrecerse en nuevas solicitudes, búsquedas y en el mapa. El historial existente se conservará.' }}
                      onCambiar={(activo) => guardar('zonas', item.id, { activo }, activo ? 'Zona activada.' : 'Zona desactivada: sus barrios dejan de ofrecerse.')}
                      pedir={pedir}
                    />
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {zonas.paginacion}
      </section>

      <section className={styles.section}>
        <h2>Barrios</h2>
        <div className={styles.filters}>
          <input aria-label="Buscar barrio" onChange={(event) => barrios.setFiltros({ q: event.target.value })} placeholder="Buscar barrio" type="search" value={barrios.filtros.q} />
          <select aria-label="Localidad del barrio" onChange={(event) => barrios.setFiltros({ localidad: event.target.value, zona: '' })} value={barrios.filtros.localidad}>
            <option value="">Todas las localidades</option>
            {data?.localidades.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
          <select aria-label="Zona del barrio" onChange={(event) => barrios.setFiltros({ zona: event.target.value })} value={barrios.filtros.zona}>
            <option value="">Todas las zonas</option>
            {data?.zonas.filter((item) => !barrios.filtros.localidad || item.localidadId === barrios.filtros.localidad).map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
          <FiltroEstado onChange={(estado) => barrios.setFiltros({ estado })} value={barrios.filtros.estado} />
        </div>
        {barrios.error ? <p className={styles.error} role="alert">{barrios.error}</p> : null}
        {!listaBarrios && !barrios.error ? <p className={styles.muted} role="status">Cargando barrios…</p> : null}
        {listaBarrios && listaBarrios.length === 0 ? <AdminEmpty text={barrios.filtros.q || barrios.filtros.estado || barrios.filtros.localidad || barrios.filtros.zona ? 'No hay barrios con esos filtros.' : 'No hay barrios.'} /> : null}
        {listaBarrios && listaBarrios.length > 0 ? (
          <table className={styles.table}>
            <thead><tr><th>Barrio</th><th>Zona</th><th>Geografía</th><th>Prestadores</th><th>Solicitudes</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {listaBarrios.map((item) => (
                <tr key={item.id}>
                  <td data-label="Barrio"><strong>{item.nombre}</strong><div className={styles.muted}>{nombreLocalidad(item.localidadId)}</div></td>
                  <td data-label="Zona">{nombreZona(item.zonaId)}</td>
                  <td data-label="Geografía">{geografia(item)}</td>
                  <td data-label="Prestadores" title="Prestadores aprobados y visibles que atienden el barrio">{item.prestadores}</td>
                  <td data-label="Solicitudes">{item.solicitudes}</td>
                  <td data-label="Estado"><Estado activo={item.activo} /></td>
                  <td><div className={styles.chips}>
                    <button className={styles.buttonSecondary} onClick={() => setBarrio({ id: item.id, nombre: item.nombre, localidadId: item.localidadId, zonaId: item.zonaId ?? '', puntos: puntosDePoligono(item.poligono), punto: item.lat !== null && item.lng !== null ? { lat: item.lat, lng: item.lng } : null, orden: String(item.orden) })} type="button">Editar</button>
                    <BotonEstado
                      activo={item.activo}
                      busy={busy}
                      confirmacion={{ titulo: `¿Desactivar ${item.nombre}?`, detalle: 'Ya no se ofrecerá en nuevas solicitudes, búsquedas ni en el mapa. Los perfiles y solicitudes existentes lo conservan.' }}
                      onCambiar={(activo) => guardar('barrios', item.id, { activo }, activo ? 'Barrio activado.' : 'Barrio desactivado: se conserva en los registros existentes.')}
                      pedir={pedir}
                    />
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {barrios.paginacion}
      </section>
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}
