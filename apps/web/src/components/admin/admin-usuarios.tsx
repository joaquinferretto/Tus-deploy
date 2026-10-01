'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { ETIQUETA_TIPO_DOCUMENTO, formatearDocumento, type FiltrosUsuariosAdmin, type LocalidadDTO, type PaisDTO, type ProvinciaDTO } from '@factory/contracts'

import { createGeographyClient } from '@/features/profile/profile-client'
import { AdminApiError, adminApi, adminErrorMessage, formatFecha, type AdminUsuario } from '@/lib/tus-admin-api'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
import styles from './admin-usuarios.module.css'

const ROL: Record<string, string> = { admin: 'Admin', prestador: 'Prestador', cliente: 'Cliente' }
// Filter of the list only (the form below never offers a role: it creates clients).
const FILTRO_ROL = [['', 'Todos'], ['cliente', 'Clientes'], ['prestador', 'Prestadores'], ['admin', 'Administradores']] as const

interface Filtros {
  q: string
  rol: NonNullable<FiltrosUsuariosAdmin['rol']>
  estado: NonNullable<FiltrosUsuariosAdmin['estado']>
  telefono: NonNullable<FiltrosUsuariosAdmin['telefono']>
  perfil: NonNullable<FiltrosUsuariosAdmin['perfil']>
  paisId: string
  provinciaId: string
  localidadId: string
}

const SIN_FILTROS: Filtros = { q: '', rol: '', estado: '', telefono: '', perfil: '', paisId: '', provinciaId: '', localidadId: '' }

// Registered accounts. The API searches, filters and paginates: this screen only holds the page
// it is showing. Document, phone and residence are private data shown here to an authorized
// platform administrator only.
export function AdminUsuarios(): React.ReactNode {
  const geografia = useMemo(() => createGeographyClient(), [])
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS)
  const [items, setItems] = useState<AdminUsuario[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalPages, setTotalPages] = useState(1)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [paises, setPaises] = useState<PaisDTO[]>([])
  const [provincias, setProvincias] = useState<ProvinciaDTO[]>([])
  const [localidades, setLocalidades] = useState<LocalidadDTO[]>([])

  const load = useCallback(
    () =>
      adminApi
        .usuarios({ ...filtros, q: filtros.q.trim(), page, pageSize })
        .then((result) => {
          setItems(result.items)
          setTotal(result.total)
          setTotalPages(result.totalPages)
          setError('')
        })
        .catch((cause) => setError(adminErrorMessage(cause))),
    [filtros, page, pageSize]
  )

  // Typing waits a moment before asking the API; every other filter applies with the same delay.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 350)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    void geografia.countries().then(setPaises).catch(() => setPaises([]))
  }, [geografia])
  useEffect(() => {
    if (!filtros.paisId) return setProvincias([])
    void geografia.provinces(filtros.paisId).then(setProvincias).catch(() => setProvincias([]))
  }, [geografia, filtros.paisId])
  useEffect(() => {
    if (!filtros.provinciaId) return setLocalidades([])
    void geografia.localities(filtros.provinciaId).then(setLocalidades).catch(() => setLocalidades([]))
  }, [geografia, filtros.provinciaId])

  const cambiar = (patch: Partial<Filtros>) => {
    setFiltros((actual) => ({ ...actual, ...patch }))
    setPage(1)
  }
  const activos = Object.values(filtros).filter(Boolean).length

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await adminApi.crearUsuario({ displayName: String(data.get('displayName') ?? '').trim(), email: String(data.get('email') ?? '').trim(), password: String(data.get('password') ?? ''), role: 'cliente' })
      setCreating(false)
      setNotice('Usuario creado. Debe verificar su email antes de ingresar.')
      setPage(1)
      await load()
    } catch (cause) {
      setError(crearErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AdminPageHeader subtitle="Cuentas registradas en TUS" title="Usuarios">
        <button className={styles.buttonPrimary} onClick={() => setCreating(true)} type="button">
          + Nuevo usuario
        </button>
      </AdminPageHeader>
      {notice ? (
        <p className={styles.alertOk} role="status">
          {notice}
        </p>
      ) : null}

      {creating ? (
        <form className={styles.panel} onSubmit={(event) => void create(event)}>
          <h2>Nuevo usuario</h2>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Nombre</span>
              <input maxLength={120} minLength={2} name="displayName" required />
            </label>
            <label className={styles.field}>
              <span>Email</span>
              <input autoComplete="email" name="email" required type="email" />
            </label>
            <label className={styles.field}>
              <span>Contraseña inicial</span>
              <input autoComplete="new-password" minLength={12} name="password" required type="password" />
            </label>
          </div>
          <p className={styles.muted}>Se crea como cliente. Prestador y administrador requieren sus flujos específicos; el email debe verificarse.</p>
          <div className={styles.actions}>
            <button className={styles.buttonPrimary} disabled={busy} type="submit">
              {busy ? 'Creando…' : 'Crear usuario'}
            </button>
            <button className={styles.buttonSecondary} onClick={() => setCreating(false)} type="button">
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      <section aria-label="Buscar y filtrar usuarios" className={styles.panel}>
        <label className={styles.field}>
          <span>Buscar</span>
          <input
            id="admin-usuarios-q"
            onChange={(event) => cambiar({ q: event.target.value })}
            placeholder="Nombre, email, DNI o teléfono"
            type="search"
            value={filtros.q}
          />
        </label>
        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Rol</span>
            <select onChange={(event) => cambiar({ rol: event.target.value as Filtros['rol'] })} value={filtros.rol}>
              {FILTRO_ROL.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Estado</span>
            <select onChange={(event) => cambiar({ estado: event.target.value as Filtros['estado'] })} value={filtros.estado}>
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="suspended">Suspendidos</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Teléfono</span>
            <select onChange={(event) => cambiar({ telefono: event.target.value as Filtros['telefono'] })} value={filtros.telefono}>
              <option value="">Todos</option>
              <option value="verificado">Teléfono verificado</option>
              <option value="pendiente">Teléfono pendiente</option>
              <option value="sin">Sin teléfono</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Perfil</span>
            <select onChange={(event) => cambiar({ perfil: event.target.value as Filtros['perfil'] })} value={filtros.perfil}>
              <option value="">Todos</option>
              <option value="completo">Completo</option>
              <option value="incompleto">Incompleto</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>País</span>
            <select onChange={(event) => cambiar({ paisId: event.target.value, provinciaId: '', localidadId: '' })} value={filtros.paisId}>
              <option value="">Todos</option>
              {paises.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Provincia</span>
            <select disabled={!filtros.paisId} onChange={(event) => cambiar({ provinciaId: event.target.value, localidadId: '' })} value={filtros.provinciaId}>
              <option value="">{filtros.paisId ? 'Todas' : 'Elegí un país'}</option>
              {provincias.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Localidad</span>
            <select disabled={!filtros.provinciaId} onChange={(event) => cambiar({ localidadId: event.target.value })} value={filtros.localidadId}>
              <option value="">{filtros.provinciaId ? 'Todas' : 'Elegí una provincia'}</option>
              {localidades.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.resultBar}>
          <span aria-live="polite" role="status">
            {items === null ? 'Buscando…' : `${total} ${total === 1 ? 'usuario' : 'usuarios'}`}
          </span>
          {activos > 0 ? (
            <button className={styles.linkButton} onClick={() => cambiar(SIN_FILTROS)} type="button">
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className={styles.alertError} role="alert">
          {error}
        </p>
      ) : null}
      {items && items.length === 0 ? <AdminEmpty text={activos > 0 ? 'No hay usuarios con esos filtros.' : 'Todavía no hay usuarios registrados.'} /> : null}
      {items && items.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Documento</th>
                <th>Teléfono</th>
                <th>Localidad</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Alta</th>
                <th>
                  <span className={styles.srOnly}>Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="Usuario">
                    <strong>{item.nombre || '—'}</strong>
                    <span className={styles.sub}>{item.email}</span>
                    {item.administrada ? <span className={styles.sub}>Administrada (sin login)</span> : !item.verificado ? <span className={styles.badgeWarn}>Email sin verificar</span> : null}
                  </td>
                  <td data-label="Documento">
                    {item.documento ? (
                      <>
                        {formatearDocumento(item.documento.tipo, item.documento.numero)}
                        <span className={styles.sub}>{ETIQUETA_TIPO_DOCUMENTO[item.documento.tipo]}</span>
                      </>
                    ) : (
                      <span className={styles.muted}>Sin cargar</span>
                    )}
                  </td>
                  <td data-label="Teléfono">
                    {item.telefono.verificado ? (
                      <>
                        {item.telefono.numero} <span className={styles.badgeOk}>Verificado</span>
                      </>
                    ) : item.telefono.pendiente ? (
                      <>
                        {item.telefono.pendiente} <span className={styles.badgeWarn}>Pendiente</span>
                      </>
                    ) : (
                      <span className={styles.muted}>Sin teléfono</span>
                    )}
                  </td>
                  <td data-label="Localidad">
                    {item.ubicacion ? (
                      <>
                        {item.ubicacion.localidad}
                        <span className={styles.sub}>{item.ubicacion.provincia}</span>
                      </>
                    ) : (
                      <span className={styles.muted}>Sin cargar</span>
                    )}
                  </td>
                  <td data-label="Rol">
                    <span className={styles.badges}>
                      {item.roles
                        .filter((role) => role !== 'cliente' || item.roles.length === 1)
                        .map((role) => (
                          <span className={role === 'admin' ? styles.badgeBrand : styles.badgeNeutral} key={role}>
                            {ROL[role]}
                          </span>
                        ))}
                    </span>
                  </td>
                  <td data-label="Estado">
                    <span className={styles.badges}>
                      <span className={item.estado === 'active' ? styles.badgeOk : styles.badgeDanger}>{item.estado === 'active' ? 'Activa' : 'Suspendida'}</span>
                      <span className={item.perfilCompleto ? styles.badgeOk : styles.badgeWarn}>{item.perfilCompleto ? 'Perfil completo' : 'Perfil incompleto'}</span>
                    </span>
                  </td>
                  <td className={styles.muted} data-label="Alta">
                    {formatFecha(item.creadaEn)}
                  </td>
                  <td>
                    <a className={styles.buttonSecondary} href={`/tus/admin/usuarios/${encodeURIComponent(item.id)}`}>
                      Ver ficha
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {items ? (
        <AdminPagination
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
        />
      ) : null}
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
