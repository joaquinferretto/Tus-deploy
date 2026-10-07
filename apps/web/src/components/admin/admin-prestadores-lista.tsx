'use client'

import { useCallback, useEffect, useState } from 'react'

import { DESTINO_WHATSAPP, PROBLEMA_CUENTA, adminApi, adminErrorMessage, formatFecha, type AdminPrestador } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { PrestadoresAdmin } from './prestadores-admin'
import { AdminPagination } from './admin-pagination'
import { AdminConfirm, useConfirmacion } from './admin-confirm'
import styles from './admin.module.css'

const FILTROS = [
  ['todos', 'Todos'],
  ['publicados', 'Publicados'],
  ['ocultos', 'Ocultos'],
  ['identidad', 'Identidad pendiente'],
] as const

type Filtro = (typeof FILTROS)[number][0]

// Every provider profile and the REAL reason it is (not) on the map. The only state action the
// directory supports is publishing / hiding the profile; approval and identity have their own flows.
export function AdminPrestadoresLista(): React.ReactNode {
  const [items, setItems] = useState<AdminPrestador[] | null>(null)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [oficio, setOficio] = useState('')
  const [zona, setZona] = useState('')
  const [catalogo, setCatalogo] = useState<{ oficios: { id: string; nombre: string }[]; barrios: { nombre: string }[] }>({ oficios: [], barrios: [] })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)
  const [confirmacion, pedir, cerrar] = useConfirmacion()

  const load = useCallback(() => adminApi.prestadores({
    q: q.trim(), oficio, zona,
    visibilidad: filtro === 'publicados' ? 'visible' : filtro === 'ocultos' ? 'oculto' : '',
    verificacion: filtro === 'identidad' ? 'pendiente' : '', page, pageSize,
  }).then((result) => { setItems(result.items); setTotalPages(result.totalPages); setError('') }).catch((cause) => setError(adminErrorMessage(cause))), [q, oficio, zona, filtro, page, pageSize])
  useEffect(() => { const timer = setTimeout(() => void load(), 400); return () => clearTimeout(timer) }, [load])
  useEffect(() => { void adminApi.catalogo().then((result) => setCatalogo({ oficios: result.oficios.map(({ id, nombre }) => ({ id, nombre })), barrios: result.barrios.map(({ nombre }) => ({ nombre })) })).catch(() => undefined) }, [])

  async function toggle(item: AdminPrestador) {
    setBusy(item.id)
    try {
      await adminApi.visibilidad(item.id, !item.visible)
      await load()
    } catch (cause) {
      setError(adminErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const visibles = items ?? []

  return (
    <>
      <AdminPageHeader subtitle="Perfiles del directorio y por qué aparecen o no en el mapa" title="Prestadores">
        <button className={styles.buttonPrimary} onClick={() => setAdding((value) => !value)} type="button">
          {adding ? 'Cerrar' : 'Agregar prestador'}
        </button>
      </AdminPageHeader>
      {adding ? (
        <section className={`${styles.card} ${styles.section}`} style={{ marginTop: 0, marginBottom: 16 }}>
          <PrestadoresAdmin onSaved={() => void load()} />
        </section>
      ) : null}
      <div className={styles.toolbar}>
        <input aria-label="Buscar prestadores" onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Buscar por nombre" type="search" value={q} />
        <select aria-label="Servicio" onChange={(event) => { setOficio(event.target.value); setPage(1) }} value={oficio}><option value="">Todos los servicios</option>{catalogo.oficios.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}</select>
        <select aria-label="Zona" onChange={(event) => { setZona(event.target.value); setPage(1) }} value={zona}><option value="">Todas las zonas</option>{catalogo.barrios.map((item) => <option key={item.nombre} value={item.nombre}>{item.nombre}</option>)}</select>
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={filtro === value} key={value} onClick={() => { setFiltro(value); setPage(1) }} type="button">{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando prestadores…</p> : null}
      {items && items.length === 0 ? (
        <AdminEmpty action={<button className={styles.buttonPrimary} onClick={() => setAdding(true)} type="button">Agregar prestador</button>} text="No hay prestadores publicados todavía. Por eso el mapa está vacío." />
      ) : null}
      {items && items.length > 0 && visibles.length === 0 ? <AdminEmpty text="No hay prestadores con ese filtro." /> : null}
      {visibles.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr><th>Nombre público</th><th>Cuenta</th><th>Teléfono</th><th>WhatsApp</th><th>Oficio</th><th>Zona</th><th>Mapa</th><th>Identidad</th><th>Mercado Pago</th><th>Reputación</th><th>Alta</th><th /></tr>
          </thead>
          <tbody>
            {visibles.map((item) => (
              <tr key={item.id}>
                <td data-label="Nombre público"><strong>{item.nombre}</strong></td>
                <td data-label="Cuenta" data-prestador-cuenta={item.cuenta ? item.cuenta.cuentaId : 'sin-cuenta'}>
                  {item.cuenta ? (
                    <>
                      <a href={`/tus/admin/usuarios/${encodeURIComponent(item.cuenta.cuentaId)}`}>{item.cuenta.nombre}</a>
                      <br />
                      <span className={styles.muted} style={{ overflowWrap: 'anywhere' }}>{item.cuenta.email}</span>
                      {item.cuenta.estado !== 'active' ? <> <span className={`${styles.badge} ${styles.badgeOff}`}>Suspendida</span></> : null}
                    </>
                  ) : item.cuenta === null ? <span className={`${styles.badge} ${styles.badgeOff}`} data-cuenta-problema={item.cuentaProblema?.motivo ?? 'sin_vincular'} title={PROBLEMA_CUENTA[item.cuentaProblema?.motivo ?? 'sin_vincular']}>{item.cuentaProblema?.motivo === 'ambiguo' ? 'Vínculo ambiguo' : item.cuentaProblema?.motivo === 'cuenta_invalida' ? 'Cuenta inválida' : 'Sin cuenta vinculada'}</span> : '—'}
                </td>
                <td data-label="Teléfono">
                  {item.cuenta?.telefono.numero ? (
                    <>
                      {item.cuenta.telefono.numero}
                      <br />
                      <span className={`${styles.badge} ${styles.badgeOk}`}>Verificado</span>
                    </>
                  ) : item.cuenta?.telefono.pendiente ? (
                    <>
                      {item.cuenta.telefono.pendiente}
                      <br />
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>Sin verificar</span>
                    </>
                  ) : <span className={styles.muted}>Sin teléfono</span>}
                </td>
                <td data-label="WhatsApp" data-whatsapp-destino={item.whatsappDestino ?? ''}>
                  {item.whatsappDestino ? <span className={`${styles.badge} ${DESTINO_WHATSAPP[item.whatsappDestino].tono === 'ok' ? styles.badgeOk : DESTINO_WHATSAPP[item.whatsappDestino].tono === 'warn' ? styles.badgeWarn : styles.badgeOff}`} title={DESTINO_WHATSAPP[item.whatsappDestino].detalle}>{DESTINO_WHATSAPP[item.whatsappDestino].texto}</span> : '—'}
                </td>
                <td data-label="Oficio">{item.oficioLabel}</td>
                <td data-label="Zona">{item.zona ?? '—'}{item.zonasCobertura.length > 1 ? <span className={styles.muted}> +{item.zonasCobertura.length - 1}</span> : null}</td>
                <td data-label="Mapa">
                  {item.enMapa ? <span className={`${styles.badge} ${styles.badgeOk}`}>En el mapa</span> : (
                    <>
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>Fuera del mapa</span>
                      <div className={styles.muted}>{item.motivos.join(' · ')}</div>
                    </>
                  )}
                </td>
                <td data-label="Identidad">{item.verificado ? <span className={`${styles.badge} ${styles.badgeOk}`}>Verificada</span> : <span className={`${styles.badge} ${styles.badgeOff}`}>Pendiente</span>}</td>
                <td data-label="Mercado Pago">{item.mercadoPago === 'connected' ? <span className={`${styles.badge} ${styles.badgeOk}`}>Sí</span> : <span className={`${styles.badge} ${styles.badgeOff}`}>{item.mercadoPago === 'not_connected' ? 'No' : 'No (reconectar)'}</span>}</td>
                <td data-label="Reputación">{item.rating ? `★ ${item.rating.average.toFixed(1).replace('.', ',')} (${item.rating.count})` : <span className={styles.muted}>Sin calificaciones</span>}<div className={styles.muted}>{item.trabajosCompletados} completados</div></td>
                <td className={styles.muted} data-label="Alta">{formatFecha(item.creadoEn)}</td>
                <td>
                  <div className={styles.chips}>
                    <a className={styles.buttonPrimary} href={`/tus/admin/prestadores/${encodeURIComponent(item.id)}`}>Editar</a>
                    <a className={styles.buttonSecondary} href={`/trabajadores/${encodeURIComponent(item.id)}`}>Ver</a>
                    <button className={styles.buttonSecondary} disabled={busy === item.id} onClick={() => item.visible ? pedir({ titulo: `¿Ocultar a ${item.nombre}?`, detalle: 'Deja de aparecer en el mapa, el buscador y el asistente. Sus trabajos y solicitudes existentes se conservan; podés volver a publicarlo.', confirmar: 'Ocultar', onConfirm: () => toggle(item) }) : void toggle(item)} type="button">
                      {item.visible ? 'Ocultar' : 'Publicar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {items ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} /> : null}
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}
