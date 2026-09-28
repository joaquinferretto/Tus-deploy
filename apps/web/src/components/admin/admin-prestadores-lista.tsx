'use client'

import { useEffect, useState } from 'react'

import { adminApi, adminErrorMessage, formatFecha, type AdminPrestador } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { PrestadoresAdmin } from './prestadores-admin'
import styles from './admin.module.css'

const FILTROS = [
  ['todos', 'Todos'],
  ['mapa', 'En el mapa'],
  ['fuera', 'Fuera del mapa'],
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

  const load = () => adminApi.prestadores().then((result) => { setItems(result.items); setError('') }).catch((cause) => setError(adminErrorMessage(cause)))
  useEffect(() => { void load() }, [])

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

  const visibles = (items ?? []).filter((item) =>
    filtro === 'mapa' ? item.enMapa : filtro === 'fuera' ? !item.enMapa : filtro === 'ocultos' ? !item.visible : filtro === 'identidad' ? !item.verificado : true
  )

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
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={filtro === value} key={value} onClick={() => setFiltro(value)} type="button">{label}</button>
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
            <tr><th>Nombre</th><th>Oficio</th><th>Zona</th><th>Mapa</th><th>Identidad</th><th>Alta</th><th /></tr>
          </thead>
          <tbody>
            {visibles.map((item) => (
              <tr key={item.id}>
                <td data-label="Nombre"><strong>{item.nombre}</strong></td>
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
                <td className={styles.muted} data-label="Alta">{formatFecha(item.creadoEn)}</td>
                <td>
                  <div className={styles.chips}>
                    <a className={styles.buttonSecondary} href={`/trabajadores/${encodeURIComponent(item.id)}`}>Ver</a>
                    <button className={styles.buttonSecondary} disabled={busy === item.id} onClick={() => void toggle(item)} type="button">
                      {item.visible ? 'Ocultar' : 'Publicar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  )
}
