'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { AdminApiError, adminApi, adminErrorMessage, formatFecha, type AdminUsuarioDetalle } from '@/lib/tus-admin-api'
import { AdminConfirm, useConfirmacion } from './admin-confirm'
import { AdminPageHeader } from './admin-layout'
import styles from './admin.module.css'

const ROL: Record<string, string> = { admin: 'Administrador', prestador: 'Prestador', cliente: 'Cliente' }

function errorEdicion(cause: unknown): string {
  if (cause instanceof AdminApiError) {
    if (cause.status === 409) return 'Ese email ya pertenece a otra cuenta.'
    if (cause.status === 403) return 'Esa cuenta es de administración o es tu propia cuenta: su email y verificación se gestionan desde la configuración y Seguridad.'
    if (cause.status === 422 && cause.code === 'INVALID_PHONE') return 'Revisá el número: con característica, por ejemplo 379 412-3456.'
    if (cause.status === 422) return 'Revisá los datos: nombre de 2 a 120 caracteres y un email válido.'
  }
  return adminErrorMessage(cause)
}

// Account detail: every business field the administration may change. Secrets never travel to
// the panel: instead of editing a password or tokens there are safe actions (close sessions,
// send a recovery email). Admin authority is the server allowlist, so it is shown, not granted.
export function AdminUsuarioDetallePage({ id }: { id: string }): React.ReactNode {
  const [cuenta, setCuenta] = useState<AdminUsuarioDetalle | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ nombre: '', email: '', estado: 'active' as 'active' | 'suspended', motivo: '' })
  const [confirmacion, pedir, cerrar] = useConfirmacion()
  const [telefono, setTelefono] = useState('')

  const cargar = useCallback(() => adminApi.usuario(id).then((value) => {
    setCuenta(value)
    setForm({ nombre: value.nombre, email: value.email, estado: value.estado, motivo: '' })
    setError('')
  }).catch((cause) => setError(cause instanceof AdminApiError && cause.status === 404 ? 'No existe esa cuenta.' : adminErrorMessage(cause))), [id])

  useEffect(() => { void cargar() }, [cargar])

  const ejecutar = async (accion: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setAviso('')
    try {
      await accion()
      await cargar()
      setAviso(ok)
    } catch (cause) {
      setError(errorEdicion(cause))
    } finally {
      setBusy(false)
    }
  }

  function guardar(event: FormEvent) {
    event.preventDefault()
    if (!cuenta) return
    const cambios = {
      ...(form.nombre.trim() !== cuenta.nombre ? { displayName: form.nombre.trim() } : {}),
      ...(form.email.trim().toLowerCase() !== cuenta.email.toLowerCase() ? { email: form.email.trim() } : {}),
      ...(form.estado !== cuenta.estado ? { status: form.estado } : {}),
      ...(form.motivo.trim() ? { reason: form.motivo.trim() } : {}),
    }
    if (!('displayName' in cambios) && !('email' in cambios) && !('status' in cambios)) return setAviso('No hay cambios para guardar.')
    const aplicar = () => ejecutar(() => adminApi.actualizarUsuario(cuenta.id, cambios), 'email' in cambios ? 'Cuenta actualizada. El nuevo email debe confirmarse y se cerraron sus sesiones.' : 'Cuenta actualizada.')
    const sensible = 'email' in cambios || cambios.status === 'suspended'
    if (!sensible) return void aplicar()
    pedir({
      titulo: 'email' in cambios ? `¿Cambiar el email a ${form.email.trim()}?` : `¿Suspender a ${cuenta.nombre || cuenta.email}?`,
      detalle: 'email' in cambios
        ? 'El email queda sin confirmar, se cierran todas sus sesiones y el titular deberá confirmarlo. El cambio queda auditado.'
        : 'Se cerrarán todas sus sesiones y no podrá ingresar hasta que lo reactives. Su historial se conserva.',
      confirmar: 'email' in cambios ? 'Cambiar email' : 'Suspender',
      onConfirm: aplicar,
    })
  }

  if (error && !cuenta) return <p className={styles.error} role="alert">{error}</p>
  if (!cuenta) return <p className={styles.muted} role="status">Cargando cuenta…</p>
  const bloqueada = cuenta.administradorPlataforma
  return (
    <>
      <AdminPageHeader subtitle={cuenta.email} title={cuenta.nombre || 'Cuenta'}>
        <a className={styles.buttonSecondary} href="/tus/admin/usuarios">Volver a usuarios</a>
      </AdminPageHeader>
      {aviso ? <p className={styles.success} role="status">{aviso}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.card} aria-labelledby="usuario-resumen">
        <h2 id="usuario-resumen">Resumen</h2>
        <p>Roles: {cuenta.roles.map((rol) => ROL[rol]).join(', ')}</p>
        <p>Estado: <span className={`${styles.badge} ${cuenta.estado === 'active' ? styles.badgeOk : styles.badgeWarn}`}>{cuenta.estado === 'active' ? 'Activa' : 'Suspendida'}</span></p>
        <p>Email confirmado: {cuenta.verificado ? `sí (${cuenta.verificadoEn ? formatFecha(cuenta.verificadoEn) : ''})` : 'no'}</p>
        <p>Teléfono: {cuenta.telefono.verificado ? `${cuenta.telefono.numero} · verificado${cuenta.telefono.verificadoEn ? ` (${formatFecha(cuenta.telefono.verificadoEn)})` : ''}` : cuenta.telefono.pendiente ? `${cuenta.telefono.pendiente} · pendiente de verificación` : 'sin teléfono'}</p>
        <p>Contraseña: {cuenta.conContrasena ? 'configurada (no se muestra ni se edita)' : 'sin contraseña (cuenta administrada)'}</p>
        <p className={styles.muted}>Alta {formatFecha(cuenta.creadaEn)} · Última modificación {formatFecha(cuenta.actualizadaEn)}</p>
        {cuenta.prestador ? (
          <p>Perfil de prestador: <a href={`/tus/admin/prestadores/${encodeURIComponent(cuenta.prestador.id)}`}>{cuenta.prestador.displayName}</a> ({cuenta.prestador.visible ? 'visible' : 'oculto'})</p>
        ) : <p className={styles.muted}>Sin perfil de prestador. Para darlo de alta usá “Nuevo prestador” en Prestadores con este email.</p>}
        {bloqueada ? <p className={styles.muted}>Es una cuenta de administración: su email y verificación se gestionan desde la configuración del servidor (no desde el panel).</p> : null}
      </section>

      <form aria-label="Datos de la cuenta" className={`${styles.card} ${styles.form}`} onSubmit={guardar}>
        <h2>Datos de la cuenta</h2>
        <label>Nombre<input maxLength={120} minLength={2} onChange={(event) => setForm({ ...form, nombre: event.target.value })} required value={form.nombre} /></label>
        <label>Email<input disabled={bloqueada} maxLength={254} onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} /></label>
        <label>Estado
          <select onChange={(event) => setForm({ ...form, estado: event.target.value === 'suspended' ? 'suspended' : 'active' })} value={form.estado}>
            <option value="active">Activa</option>
            <option value="suspended">Suspendida</option>
          </select>
        </label>
        <label>Motivo (opcional, queda en la auditoría)<input maxLength={200} onChange={(event) => setForm({ ...form, motivo: event.target.value })} placeholder="Ej.: pedido del titular" value={form.motivo} /></label>
        <div className={styles.chips}><button className={styles.buttonPrimary} disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar cambios'}</button></div>
      </form>

      <section className={styles.card} aria-labelledby="usuario-telefono">
        <h2 id="usuario-telefono">Teléfono de identidad</h2>
        <p className={styles.muted}>El número queda pendiente hasta que la persona lo verifique enviando el mensaje por WhatsApp desde ese teléfono. Desde el panel nunca se marca como verificado.</p>
        <form className={styles.form} onSubmit={(event) => {
          event.preventDefault()
          if (!telefono.trim()) return
          void ejecutar(() => adminApi.telefonoUsuario(cuenta.id, { accion: 'pendiente', telefono: telefono.trim() }), 'Teléfono cargado como pendiente de verificación.').then(() => setTelefono(''))
        }}>
          <label>Número a verificar<input inputMode="tel" maxLength={32} onChange={(event) => setTelefono(event.target.value)} placeholder="379 412-3456" type="tel" value={telefono} /></label>
          <div className={styles.chips}>
            <button className={styles.buttonPrimary} disabled={busy || !telefono.trim()} type="submit">Cargar como pendiente</button>
            {cuenta.telefono.verificado ? (
              <button className={styles.buttonSecondary} disabled={busy} onClick={() => pedir({ titulo: '¿Liberar el teléfono verificado?', detalle: 'La cuenta queda sin teléfono de identidad y ese número podrá verificarse en otra cuenta. Usalo si el número cambió de dueño. Queda auditado.', confirmar: 'Liberar teléfono', onConfirm: () => ejecutar(() => adminApi.telefonoUsuario(cuenta.id, { accion: 'quitar' }), 'Teléfono liberado.') })} type="button">Liberar teléfono verificado</button>
            ) : null}
          </div>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="usuario-acciones">
        <h2 id="usuario-acciones">Acciones seguras</h2>
        <div className={styles.chips}>
          {!bloqueada ? (
            cuenta.verificado
              ? <button className={styles.buttonSecondary} disabled={busy} onClick={() => pedir({ titulo: '¿Marcar el email como NO confirmado?', detalle: 'El titular deberá confirmarlo de nuevo para operar.', confirmar: 'Quitar confirmación', onConfirm: () => ejecutar(() => adminApi.actualizarUsuario(cuenta.id, { emailVerified: false }), 'Email marcado como no confirmado.') })} type="button">Quitar confirmación de email</button>
              : <button className={styles.buttonSecondary} disabled={busy} onClick={() => pedir({ titulo: '¿Marcar el email como confirmado?', detalle: 'Hacelo solo si verificaste que el email pertenece al titular.', confirmar: 'Confirmar email', onConfirm: () => ejecutar(() => adminApi.actualizarUsuario(cuenta.id, { emailVerified: true }), 'Email marcado como confirmado.') })} type="button">Marcar email como confirmado</button>
          ) : null}
          <button className={styles.buttonSecondary} disabled={busy} onClick={() => pedir({ titulo: '¿Cerrar todas las sesiones?', detalle: 'El titular deberá ingresar de nuevo en todos sus dispositivos.', confirmar: 'Cerrar sesiones', onConfirm: () => ejecutar(() => adminApi.accionUsuario(cuenta.id, 'revoke_sessions'), 'Sesiones cerradas.') })} type="button">Cerrar todas las sesiones</button>
          <button className={styles.buttonSecondary} disabled={busy || cuenta.estado !== 'active'} onClick={() => pedir({ titulo: '¿Forzar el cambio de contraseña?', detalle: 'Se cierran sus sesiones y se le envía un email para elegir una contraseña nueva. Nunca ves ni definís su contraseña.', confirmar: 'Enviar recuperación', onConfirm: () => ejecutar(() => adminApi.accionUsuario(cuenta.id, 'password_reset'), 'Sesiones cerradas y email de recuperación enviado.') })} type="button">Forzar cambio de contraseña</button>
        </div>
      </section>
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}
