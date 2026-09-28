'use client'

import { useEffect, useState } from 'react'

import { adminApi, adminErrorMessage, formatFecha, type AdminUsuario } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import styles from './admin.module.css'

const FILTROS = [
  ['', 'Todos'],
  ['cliente', 'Clientes'],
  ['prestador', 'Prestadores'],
  ['admin', 'Administradores'],
] as const

const ROL: Record<string, string> = { admin: 'Admin', prestador: 'Prestador', cliente: 'Cliente' }

// Registered accounts. Only what the admin needs (no ids of other tables, no password data).
export function AdminUsuarios(): React.ReactNode {
  const [q, setQ] = useState('')
  const [rol, setRol] = useState('')
  const [items, setItems] = useState<AdminUsuario[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AdminUsuario | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      adminApi.usuarios(q.trim(), rol).then((result) => { setItems(result.items); setError('') }).catch((cause) => setError(adminErrorMessage(cause)))
    }, 250)
    return () => clearTimeout(timer)
  }, [q, rol])

  return (
    <>
      <AdminPageHeader subtitle="Cuentas registradas en TUS" title="Usuarios" />
      <div className={styles.toolbar}>
        <label className={styles.srOnlyLabel} htmlFor="admin-usuarios-q">Buscar</label>
        <input id="admin-usuarios-q" onChange={(event) => setQ(event.target.value)} placeholder="Buscar por nombre o email" type="search" value={q} />
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={rol === value} key={value} onClick={() => setRol(value)} type="button">{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando usuarios…</p> : null}
      {items && items.length === 0 ? <AdminEmpty text={q || rol ? 'No hay usuarios con esos filtros.' : 'Todavía no hay usuarios registrados.'} /> : null}
      {items && items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Verificado</th><th>Registro</th><th /></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td data-label="Nombre"><strong>{item.nombre || '—'}</strong></td>
                <td data-label="Email">{item.email}</td>
                <td data-label="Rol">{item.roles.filter((role) => role !== 'cliente' || item.roles.length === 1).map((role) => <span className={`${styles.badge} ${role === 'admin' ? styles.badgeBrand : styles.badgeOff}`} key={role} style={{ marginRight: 4 }}>{ROL[role]}</span>)}</td>
                <td data-label="Estado"><span className={`${styles.badge} ${item.estado === 'active' ? styles.badgeOk : styles.badgeWarn}`}>{item.estado === 'active' ? 'Activa' : 'Suspendida'}</span></td>
                <td data-label="Verificado">{item.administrada ? <span className={styles.muted}>Administrada (sin login)</span> : item.verificado ? 'Sí' : <span className={styles.muted}>Pendiente</span>}</td>
                <td data-label="Registro" className={styles.muted}>{formatFecha(item.creadaEn)}</td>
                <td><button className={styles.buttonSecondary} onClick={() => setSelected(item)} type="button">Ver</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {selected ? (
        <section aria-label="Detalle del usuario" className={`${styles.card} ${styles.section}`}>
          <div className={styles.toolbar} style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{selected.nombre || selected.email}</h2>
            <button className={styles.buttonSecondary} onClick={() => setSelected(null)} type="button">Cerrar</button>
          </div>
          <p>Email: {selected.email}</p>
          <p>Roles: {selected.roles.map((role) => ROL[role]).join(', ')}</p>
          <p>Email confirmado: {selected.verificado ? 'sí' : 'no'}{selected.administrada ? ' · prestador cargado por un admin, sin contraseña' : ''}</p>
          <p className={styles.muted}>Alta: {formatFecha(selected.creadaEn)}</p>
        </section>
      ) : null}
    </>
  )
}
