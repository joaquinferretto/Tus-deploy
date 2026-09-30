'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { AdminApiError, adminApi, adminErrorMessage, formatFecha, type AdminUsuario } from '@/lib/tus-admin-api'
import { AdminConfirm, useConfirmacion } from './admin-confirm'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
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
  const [estado, setEstado] = useState('')
  const [items, setItems] = useState<AdminUsuario[] | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AdminUsuario | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmacion, pedir, cerrar] = useConfirmacion()

  const load = useCallback(() => adminApi.usuarios({ q: q.trim(), rol, estado, page, pageSize }).then((result) => {
    setItems(result.items); setTotalPages(result.totalPages); setError('')
  }).catch((cause) => setError(adminErrorMessage(cause))), [q, rol, estado, page, pageSize])

  useEffect(() => {
    const timer = setTimeout(() => void load(), 400)
    return () => clearTimeout(timer)
  }, [load])

  const resetPage = () => setPage(1)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setError(''); setNotice('')
    try {
      await adminApi.crearUsuario({ displayName: String(data.get('displayName') ?? '').trim(), email: String(data.get('email') ?? '').trim(), password: String(data.get('password') ?? ''), role: 'cliente' })
      setCreating(false); setNotice('Usuario creado. Debe verificar su email antes de ingresar.'); setPage(1); await load()
    } catch (cause) { setError(crearErrorMessage(cause)) } finally { setBusy(false) }
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    const status = data.get('status') === 'suspended' ? 'suspended' : 'active'
    const reason = String(data.get('reason') ?? '').trim()
    const body = { displayName: String(data.get('displayName') ?? '').trim(), status, ...(reason ? { reason } : {}) } as const
    const target = selected
    const aplicar = async () => {
      setBusy(true); setError(''); setNotice('')
      try {
        await adminApi.actualizarUsuario(target.id, body)
        setSelected(null); setNotice(status === 'suspended' && target.estado !== 'suspended' ? 'Usuario suspendido y sesiones revocadas.' : 'Usuario actualizado.'); await load()
      } catch (cause) { setError(adminErrorMessage(cause)) } finally { setBusy(false) }
    }
    // Suspending is sensitive: it ends every session of the account. Ask first.
    if (status === 'suspended' && target.estado !== 'suspended')
      pedir({ titulo: `¿Suspender a ${target.nombre || target.email}?`, detalle: 'Se cerrarán todas sus sesiones y no podrá volver a ingresar hasta que lo reactives. Su historial se conserva.', confirmar: 'Suspender', onConfirm: aplicar })
    else await aplicar()
  }

  return (
    <>
      <AdminPageHeader subtitle="Cuentas registradas en TUS" title="Usuarios">
        <button className={styles.buttonPrimary} onClick={() => { setCreating(true); setSelected(null) }} type="button">+ Nuevo usuario</button>
      </AdminPageHeader>
      {notice ? <p className={styles.success} role="status">{notice}</p> : null}
      {creating ? (
        <form className={`${styles.card} ${styles.form}`} onSubmit={(event) => void create(event)}>
          <h2>Nuevo usuario</h2>
          <label>Nombre<input maxLength={120} minLength={2} name="displayName" required /></label>
          <label>Email<input autoComplete="email" name="email" required type="email" /></label>
          <label>Contraseña inicial<input autoComplete="new-password" minLength={12} name="password" required type="password" /></label>
          <p className={styles.muted}>Se crea como cliente. Prestador y administrador requieren sus flujos específicos; el email debe verificarse.</p>
          <div className={styles.chips}><button className={styles.buttonPrimary} disabled={busy} type="submit">{busy ? 'Creando…' : 'Crear usuario'}</button><button className={styles.buttonSecondary} onClick={() => setCreating(false)} type="button">Cancelar</button></div>
        </form>
      ) : null}
      <div className={styles.toolbar}>
        <label className={styles.srOnlyLabel} htmlFor="admin-usuarios-q">Buscar</label>
        <input id="admin-usuarios-q" onChange={(event) => { setQ(event.target.value); resetPage() }} placeholder="Buscar por nombre o email" type="search" value={q} />
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={rol === value} key={value} onClick={() => { setRol(value); resetPage() }} type="button">{label}</button>
          ))}
        </div>
        <select aria-label="Estado" onChange={(event) => { setEstado(event.target.value); resetPage() }} value={estado}><option value="">Todos los estados</option><option value="active">Activos</option><option value="suspended">Suspendidos</option></select>
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
                <td>
                  <div className={styles.chips}>
                    <a className={styles.buttonPrimary} href={`/tus/admin/usuarios/${encodeURIComponent(item.id)}`}>Ficha</a>
                    <button className={styles.buttonSecondary} onClick={() => { setSelected(item); setCreating(false) }} type="button">Edición rápida</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {items ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} /> : null}
      {selected ? (
        <form aria-label="Editar usuario" className={`${styles.card} ${styles.form}`} onSubmit={(event) => void update(event)}>
          <div className={styles.toolbar} style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Información de la cuenta</h2>
            <button className={styles.buttonSecondary} onClick={() => setSelected(null)} type="button">Cerrar</button>
          </div>
          <label>Nombre<input defaultValue={selected.nombre} maxLength={120} minLength={2} name="displayName" required /></label>
          <label>Email<input disabled value={selected.email} /></label>
          <p>Roles: {selected.roles.map((role) => ROL[role]).join(', ')}</p>
          <p>Email confirmado: {selected.verificado ? 'sí' : 'no'}{selected.administrada ? ' · prestador cargado por un admin, sin contraseña' : ''}</p>
          <label>Estado<select defaultValue={selected.estado} name="status"><option value="active">Activo</option><option value="suspended">Suspendido</option></select></label>
          {selected.estado === 'active' ? <p className={styles.muted}>Suspender revoca sus sesiones e impide nuevos ingresos. El historial se conserva.</p> : null}
          <label>Motivo (opcional, queda en la auditoría)<input maxLength={200} name="reason" placeholder="Ej.: pedido del titular" /></label>
          <p className={styles.muted}>Alta: {formatFecha(selected.creadaEn)}</p>
          <div className={styles.chips}><button className={styles.buttonPrimary} disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar cambios'}</button><button className={styles.buttonSecondary} onClick={() => setSelected(null)} type="button">Cancelar</button></div>
        </form>
      ) : null}
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}

// Admin creation answers 409 when the email exists (unlike public sign-up, which never reveals it).
function crearErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 409) return 'Ya existe una cuenta con ese email. Buscala en el listado para editarla.'
    if (error.code === 'PASSWORD_BREACHED') return 'Esa contraseña aparece en filtraciones conocidas. Elegí otra.'
    if (error.status === 422) return 'Revisá los datos: nombre de 2 a 120 caracteres, email válido y contraseña de al menos 12 caracteres.'
  }
  return adminErrorMessage(error)
}
