'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { ETIQUETA_TIPO_DOCUMENTO, formatearDocumento } from '@factory/contracts'

import { AdminApiError, adminApi, adminErrorMessage, formatFecha, type AdminUsuarioDetalle } from '@/lib/tus-admin-api'
import { AdminConfirm, useConfirmacion } from './admin-confirm'
import { AdminPageHeader } from './admin-layout'
import styles from './admin-usuarios.module.css'

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

const dato = (value: string | null | undefined) => (value ? value : <span className={styles.muted}>Sin cargar</span>)

// Account sheet, by sections: account, identity, contact, residence, verification, roles,
// professional profile and activity. Document, phone and residence are private data shown to an
// authorized platform administrator. Secrets never travel to the panel: instead of editing a
// password or tokens there are safe actions. Admin authority is the server allowlist, so it is
// shown, not granted.
export function AdminUsuarioDetallePage({ id }: { id: string }): React.ReactNode {
  const [cuenta, setCuenta] = useState<AdminUsuarioDetalle | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ nombre: '', email: '', estado: 'active' as 'active' | 'suspended', motivo: '' })
  const [confirmacion, pedir, cerrar] = useConfirmacion()
  const [telefono, setTelefono] = useState('')

  const cargar = useCallback(
    () =>
      adminApi
        .usuario(id)
        .then((value) => {
          setCuenta(value)
          setForm({ nombre: value.nombre, email: value.email, estado: value.estado, motivo: '' })
          setError('')
        })
        .catch((cause) => setError(cause instanceof AdminApiError && cause.status === 404 ? 'No existe esa cuenta.' : adminErrorMessage(cause))),
    [id]
  )

  useEffect(() => {
    void cargar()
  }, [cargar])

  const ejecutar = async (accion: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setError('')
    setAviso('')
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
      detalle:
        'email' in cambios
          ? 'El email queda sin confirmar, se cierran todas sus sesiones y el titular deberá confirmarlo. El cambio queda auditado.'
          : 'Se cerrarán todas sus sesiones y no podrá ingresar hasta que lo reactives. Su historial se conserva.',
      confirmar: 'email' in cambios ? 'Cambiar email' : 'Suspender',
      onConfirm: aplicar,
    })
  }

  if (error && !cuenta)
    return (
      <p className={styles.alertError} role="alert">
        {error}
      </p>
    )
  if (!cuenta)
    return (
      <p className={styles.muted} role="status">
        Cargando cuenta…
      </p>
    )
  const bloqueada = cuenta.administradorPlataforma
  const perfil = cuenta.perfil
  const residencia = perfil?.residencia ?? null

  return (
    <>
      <AdminPageHeader subtitle={cuenta.email} title={cuenta.nombre || 'Cuenta'}>
        <a className={styles.buttonSecondary} href="/tus/admin/usuarios">
          Volver a usuarios
        </a>
      </AdminPageHeader>
      {aviso ? (
        <p className={styles.alertOk} role="status">
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p className={styles.alertError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.sheet}>
        <form aria-labelledby="usuario-cuenta" className={styles.sheetCard} onSubmit={guardar}>
          <h2 id="usuario-cuenta">Cuenta</h2>
          <div className={styles.badges}>
            <span className={cuenta.estado === 'active' ? styles.badgeOk : styles.badgeDanger}>{cuenta.estado === 'active' ? 'Activa' : 'Suspendida'}</span>
            <span className={cuenta.conContrasena ? styles.badgeNeutral : styles.badgeWarn}>{cuenta.conContrasena ? 'Con contraseña' : 'Sin contraseña (administrada)'}</span>
          </div>
          <label className={styles.field}>
            <span>Nombre visible</span>
            <input maxLength={120} minLength={2} onChange={(event) => setForm({ ...form, nombre: event.target.value })} required value={form.nombre} />
          </label>
          <label className={styles.field}>
            <span>Email</span>
            <input disabled={bloqueada} maxLength={254} onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} />
          </label>
          <label className={styles.field}>
            <span>Estado</span>
            <select onChange={(event) => setForm({ ...form, estado: event.target.value === 'suspended' ? 'suspended' : 'active' })} value={form.estado}>
              <option value="active">Activa</option>
              <option value="suspended">Suspendida</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>
              Motivo <span className={styles.hint}>(opcional, queda en la auditoría)</span>
            </span>
            <input maxLength={200} onChange={(event) => setForm({ ...form, motivo: event.target.value })} placeholder="Ej.: pedido del titular" value={form.motivo} />
          </label>
          {bloqueada ? <p className={styles.muted}>Es una cuenta de administración: su email y verificación se gestionan desde la configuración del servidor.</p> : null}
          <div className={styles.actions}>
            <button className={styles.buttonPrimary} disabled={busy} type="submit">
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>

        <section aria-labelledby="usuario-identidad" className={styles.sheetCard}>
          <h2 id="usuario-identidad">Identidad</h2>
          <div className={styles.badges}>
            <span className={perfil?.perfilCompleto ? styles.badgeOk : styles.badgeWarn}>{perfil?.perfilCompleto ? 'Perfil completo' : 'Perfil incompleto'}</span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Nombre</dt>
              <dd>{dato(perfil?.nombre)}</dd>
            </div>
            <div>
              <dt>Apellido</dt>
              <dd>{dato(perfil?.apellido)}</dd>
            </div>
            <div>
              <dt>Tipo de documento</dt>
              <dd>{dato(perfil?.documento ? ETIQUETA_TIPO_DOCUMENTO[perfil.documento.tipo] : null)}</dd>
            </div>
            <div>
              <dt>Número</dt>
              <dd>{dato(perfil?.documento ? formatearDocumento(perfil.documento.tipo, perfil.documento.numero) : null)}</dd>
            </div>
          </dl>
          <p className={styles.muted}>Los datos personales los carga el titular desde “Mi perfil”.</p>
        </section>

        <section aria-labelledby="usuario-contacto" className={styles.sheetCard}>
          <h2 id="usuario-contacto">Contacto</h2>
          <dl className={styles.facts}>
            <div>
              <dt>Email</dt>
              <dd>
                {cuenta.email} <span className={cuenta.verificado ? styles.badgeOk : styles.badgeWarn}>{cuenta.verificado ? 'Verificado' : 'Sin verificar'}</span>
              </dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>
                {cuenta.telefono.verificado ? (
                  <>
                    {cuenta.telefono.numero} <span className={styles.badgeOk}>Verificado</span>
                  </>
                ) : cuenta.telefono.pendiente ? (
                  <>
                    {cuenta.telefono.pendiente} <span className={styles.badgeWarn}>Pendiente</span>
                  </>
                ) : (
                  <span className={styles.muted}>Sin teléfono</span>
                )}
              </dd>
            </div>
          </dl>
          <form
            className={styles.formGrid}
            onSubmit={(event) => {
              event.preventDefault()
              if (!telefono.trim()) return
              void ejecutar(() => adminApi.telefonoUsuario(cuenta.id, { accion: 'pendiente', telefono: telefono.trim() }), 'Teléfono cargado como pendiente de verificación.').then(() => setTelefono(''))
            }}
          >
            <label className={`${styles.field} ${styles.wide}`}>
              <span>Número a verificar</span>
              <input inputMode="tel" maxLength={32} onChange={(event) => setTelefono(event.target.value)} placeholder="379 412-3456" type="tel" value={telefono} />
              <span className={styles.hint}>Queda pendiente hasta que la persona lo verifique por WhatsApp. Desde el panel nunca se marca como verificado.</span>
            </label>
            <div className={`${styles.actions} ${styles.wide}`}>
              <button className={styles.buttonSecondary} disabled={busy || !telefono.trim()} type="submit">
                Cargar como pendiente
              </button>
              {cuenta.telefono.verificado ? (
                <button
                  className={styles.buttonDanger}
                  disabled={busy}
                  onClick={() =>
                    pedir({
                      titulo: '¿Liberar el teléfono verificado?',
                      detalle: 'La cuenta queda sin teléfono de identidad y ese número podrá verificarse en otra cuenta. Usalo si el número cambió de dueño. Queda auditado.',
                      confirmar: 'Liberar teléfono',
                      onConfirm: () => ejecutar(() => adminApi.telefonoUsuario(cuenta.id, { accion: 'quitar' }), 'Teléfono liberado.'),
                    })
                  }
                  type="button"
                >
                  Liberar teléfono verificado
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section aria-labelledby="usuario-residencia" className={styles.sheetCard}>
          <h2 id="usuario-residencia">Residencia</h2>
          {residencia ? (
            <dl className={styles.facts}>
              <div>
                <dt>País</dt>
                <dd>{residencia.paisNombre}</dd>
              </div>
              <div>
                <dt>Provincia</dt>
                <dd>{residencia.provinciaNombre}</dd>
              </div>
              <div>
                <dt>Localidad</dt>
                <dd>{residencia.localidadNombre}</dd>
              </div>
              <div>
                <dt>Código postal</dt>
                <dd>{residencia.codigoPostal}</dd>
              </div>
              <div>
                <dt>Domicilio</dt>
                <dd>
                  {residencia.calle} {residencia.numero}
                  {residencia.pisoDepto ? `, ${residencia.pisoDepto}` : ''}
                </dd>
              </div>
            </dl>
          ) : (
            <p className={styles.muted}>La persona todavía no cargó su domicilio.</p>
          )}
        </section>

        <section aria-labelledby="usuario-verificacion" className={styles.sheetCard}>
          <h2 id="usuario-verificacion">Verificación</h2>
          <dl className={styles.facts}>
            <div>
              <dt>Email</dt>
              <dd>{cuenta.verificado ? `Confirmado${cuenta.verificadoEn ? ` el ${formatFecha(cuenta.verificadoEn)}` : ''}` : 'Sin confirmar'}</dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>{cuenta.telefono.verificado ? `Verificado${cuenta.telefono.verificadoEn ? ` el ${formatFecha(cuenta.telefono.verificadoEn)}` : ''}` : cuenta.telefono.pendiente ? 'Pendiente' : 'Sin teléfono'}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            {!bloqueada ? (
              cuenta.verificado ? (
                <button
                  className={styles.buttonSecondary}
                  disabled={busy}
                  onClick={() => pedir({ titulo: '¿Marcar el email como NO confirmado?', detalle: 'El titular deberá confirmarlo de nuevo para operar.', confirmar: 'Quitar confirmación', onConfirm: () => ejecutar(() => adminApi.actualizarUsuario(cuenta.id, { emailVerified: false }), 'Email marcado como no confirmado.') })}
                  type="button"
                >
                  Quitar confirmación de email
                </button>
              ) : (
                <button
                  className={styles.buttonSecondary}
                  disabled={busy}
                  onClick={() => pedir({ titulo: '¿Marcar el email como confirmado?', detalle: 'Hacelo solo si verificaste que el email pertenece al titular.', confirmar: 'Confirmar email', onConfirm: () => ejecutar(() => adminApi.actualizarUsuario(cuenta.id, { emailVerified: true }), 'Email marcado como confirmado.') })}
                  type="button"
                >
                  Marcar email como confirmado
                </button>
              )
            ) : null}
          </div>
        </section>

        <section aria-labelledby="usuario-roles" className={styles.sheetCard}>
          <h2 id="usuario-roles">Roles y capacidades</h2>
          <div className={styles.badges}>
            {cuenta.roles.map((rol) => (
              <span className={rol === 'admin' ? styles.badgeBrand : styles.badgeNeutral} key={rol}>
                {ROL[rol]}
              </span>
            ))}
          </div>
          <p className={styles.muted}>
            {cuenta.administradorPlataforma
              ? 'Administra la plataforma (lista de administradores del servidor; no se otorga desde el panel).'
              : 'No administra la plataforma. La administración se otorga en la configuración del servidor.'}
          </p>
          <p className={styles.muted}>{cuenta.prestador ? 'Puede ofrecer servicios: tiene un perfil de prestador.' : 'No ofrece servicios: no tiene perfil de prestador.'}</p>
        </section>

        <section aria-labelledby="usuario-profesional" className={styles.sheetCard}>
          <h2 id="usuario-profesional">Perfil profesional</h2>
          {cuenta.prestador ? (
            <>
              <dl className={styles.facts}>
                <div>
                  <dt>Nombre público</dt>
                  <dd>{cuenta.prestador.displayName}</dd>
                </div>
                <div>
                  <dt>Directorio</dt>
                  <dd>
                    <span className={cuenta.prestador.visible ? styles.badgeOk : styles.badgeNeutral}>{cuenta.prestador.visible ? 'Visible' : 'Oculto'}</span>
                  </dd>
                </div>
              </dl>
              <div className={styles.actions}>
                <a className={styles.buttonSecondary} href={`/tus/admin/prestadores/${encodeURIComponent(cuenta.prestador.id)}`}>
                  Abrir perfil de prestador
                </a>
              </div>
            </>
          ) : (
            <p className={styles.muted}>Sin perfil de prestador. Para darlo de alta usá “Nuevo prestador” en Prestadores con este email.</p>
          )}
        </section>

        <section aria-labelledby="usuario-actividad" className={`${styles.sheetCard} ${styles.sheetWide}`}>
          <h2 id="usuario-actividad">Actividad</h2>
          <dl className={styles.facts}>
            <div>
              <dt>Alta</dt>
              <dd>{formatFecha(cuenta.creadaEn)}</dd>
            </div>
            <div>
              <dt>Última modificación de la cuenta</dt>
              <dd>{formatFecha(cuenta.actualizadaEn)}</dd>
            </div>
            <div>
              <dt>Última actualización del perfil</dt>
              <dd>{perfil?.perfilActualizadoEn ? formatFecha(perfil.perfilActualizadoEn) : <span className={styles.muted}>Nunca</span>}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <button
              className={styles.buttonSecondary}
              disabled={busy}
              onClick={() => pedir({ titulo: '¿Cerrar todas las sesiones?', detalle: 'El titular deberá ingresar de nuevo en todos sus dispositivos.', confirmar: 'Cerrar sesiones', onConfirm: () => ejecutar(() => adminApi.accionUsuario(cuenta.id, 'revoke_sessions'), 'Sesiones cerradas.') })}
              type="button"
            >
              Cerrar todas las sesiones
            </button>
            <button
              className={styles.buttonSecondary}
              disabled={busy || cuenta.estado !== 'active'}
              onClick={() =>
                pedir({
                  titulo: '¿Forzar el cambio de contraseña?',
                  detalle: 'Se cierran sus sesiones y se le envía un email para elegir una contraseña nueva. Nunca ves ni definís su contraseña.',
                  confirmar: 'Enviar recuperación',
                  onConfirm: () => ejecutar(() => adminApi.accionUsuario(cuenta.id, 'password_reset'), 'Sesiones cerradas y email de recuperación enviado.'),
                })
              }
              type="button"
            >
              Forzar cambio de contraseña
            </button>
          </div>
        </section>
      </div>
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}
