'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { ETIQUETA_TIPO_DOCUMENTO, TIPOS_DOCUMENTO, formatearDocumento, validarIdentidadPersonal, type ErroresIdentidad } from '@factory/contracts'

import { AdminApiError, adminApi, adminErrorMessage, formatFecha, type AdminUsuarioDetalle, type VerificacionIdentidadAdmin } from '@/lib/tus-admin-api'
import { AdminConfirm, useConfirmacion } from './admin-confirm'
import { AdminPageHeader } from './admin-layout'
import styles from './admin-usuarios.module.css'

// ADMIN-IDENTIDAD-MANUAL-01. The verification of the identity of the provider behind this account.
// The state is the API's (the same records payments read). Every action asks for its confirmation
// and an administrative note; nothing is decided with one accidental click.
type AccionIdentidad = 'verificar' | 'rechazar' | 'revocar' | 'pendiente'
const TITULO_ESTADO: Record<VerificacionIdentidadAdmin['estado'], string> = { pendiente: 'Pendiente', verificada: 'Identidad verificada', rechazada: 'Rechazada' }
const CONFIRMACION: Record<AccionIdentidad, { texto: string; boton: string }> = {
  verificar: { texto: 'Vas a marcar esta identidad como verificada manualmente. Esta acción habilita funciones sensibles como el cobro de señas y ganancias del prestador.', boton: 'Sí, verificar identidad' },
  rechazar: { texto: 'Vas a rechazar la identidad de este prestador. No va a poder cobrar señas hasta que se verifique.', boton: 'Sí, rechazar' },
  revocar: { texto: 'Vas a revocar la verificación de esta identidad. Los cobros nuevos del prestador vuelven a bloquearse. Los pagos, ganancias y liquidaciones que ya existen no cambian.', boton: 'Sí, revocar verificación' },
  pendiente: { texto: 'Vas a volver esta identidad a pendiente para que pueda verificarse más adelante.', boton: 'Sí, volver a pendiente' },
}
function errorIdentidad(cause: unknown): string {
  if (cause instanceof AdminApiError) {
    if (cause.code === 'DOCUMENT_NUMBER_REQUIRED') return 'Cargá primero el DNI de la cuenta en "Identidad" y después verificá.'
    if (cause.code === 'IDENTITY_ALREADY_VERIFIED') return 'Ese documento ya está verificado para otro prestador.'
    if (cause.code === 'REASON_REQUIRED') return 'Escribí la nota administrativa (al menos 5 caracteres).'
    if (cause.code === 'INVALID_STATE' || cause.code === 'CONCURRENT_MODIFICATION') return 'El estado cambió mientras tanto. Recargá la página.'
    if (cause.status === 403) return 'No podés decidir sobre tu propia identidad, o tu sesión de administración no tiene este permiso.'
  }
  return adminErrorMessage(cause)
}

function VerificacionIdentidad({ cuentaId }: { cuentaId: string }): React.ReactNode {
  const [estado, setEstado] = useState<VerificacionIdentidadAdmin | null>(null)
  const [accion, setAccion] = useState<AccionIdentidad | null>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  useEffect(() => {
    let vigente = true
    adminApi.verificacionIdentidad(cuentaId).then((respuesta) => { if (vigente) setEstado(respuesta.verificacion) }).catch((cause: unknown) => { if (vigente) setError(errorIdentidad(cause)) })
    return () => { vigente = false }
  }, [cuentaId])
  const abrir = (siguiente: AccionIdentidad) => { setAccion(siguiente); setMotivo(''); setError(''); setAviso('') }
  const confirmar = async () => {
    if (!accion) return
    setGuardando(true)
    setError('')
    try {
      const respuesta = await adminApi.decidirIdentidad(cuentaId, accion, motivo.trim())
      setEstado(respuesta.verificacion)
      setAviso(accion === 'verificar' ? 'Identidad verificada. El cobro de señas del prestador ya no depende de este paso.' : accion === 'revocar' ? 'Verificación revocada.' : accion === 'rechazar' ? 'Identidad rechazada.' : 'Identidad en pendiente.')
      setAccion(null)
    } catch (cause: unknown) {
      setError(errorIdentidad(cause))
    } finally {
      setGuardando(false)
    }
  }
  return (
    <section aria-labelledby="usuario-verificacion" className={styles.sheetCard} data-verificacion-identidad={estado?.estado ?? 'cargando'}>
      <h2 id="usuario-verificacion">Estado de verificación</h2>
      {estado ? (
        <>
          <p>
            <strong>{TITULO_ESTADO[estado.estado]}</strong>
            {estado.estado === 'verificada' ? ` · ${estado.verificadaEn ? formatFecha(estado.verificadaEn) : '—'}${estado.metodo === 'manual' ? ' · verificación manual' : ''}${estado.decididaPor ? ` · por ${estado.decididaPor}` : ''}` : ''}
            {estado.estado === 'rechazada' && estado.rechazadaEn ? ` · ${formatFecha(estado.rechazadaEn)}` : ''}
            {estado.documento ? ` · DNI ${estado.documento}` : ''}
          </p>
          {estado.nota ? <p className={styles.muted}>{estado.estado === 'rechazada' ? 'Motivo' : 'Nota'}: {estado.nota}</p> : null}
          {accion ? (
            <div data-confirmar-identidad={accion} role="group" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, display: 'grid', gap: 8, padding: 12 }}>
              <span>{CONFIRMACION[accion].texto}</span>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Motivo / nota administrativa (obligatoria)</span>
                <textarea data-motivo-identidad maxLength={500} onChange={(event) => setMotivo(event.target.value)} placeholder="Verificación manual para piloto interno" rows={2} value={motivo} />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className={styles.buttonPrimary} data-confirmar disabled={guardando || motivo.trim().length < 5} onClick={() => void confirmar()} type="button">
                  {guardando ? 'Guardando…' : CONFIRMACION[accion].boton}
                </button>
                <button className={styles.buttonSecondary} disabled={guardando} onClick={() => setAccion(null)} type="button">
                  Volver
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {estado.estado === 'pendiente' ? (
                <>
                  <button className={styles.buttonPrimary} data-accion-identidad="verificar" onClick={() => abrir('verificar')} type="button">Verificar identidad</button>
                  <button className={styles.buttonSecondary} data-accion-identidad="rechazar" onClick={() => abrir('rechazar')} type="button">Rechazar</button>
                </>
              ) : null}
              {estado.estado === 'verificada' ? <button className={styles.buttonSecondary} data-accion-identidad="revocar" onClick={() => abrir('revocar')} type="button">Revocar verificación</button> : null}
              {estado.estado === 'rechazada' ? (
                <>
                  <button className={styles.buttonPrimary} data-accion-identidad="verificar" onClick={() => abrir('verificar')} type="button">Verificar identidad</button>
                  <button className={styles.buttonSecondary} data-accion-identidad="pendiente" onClick={() => abrir('pendiente')} type="button">Volver a pendiente</button>
                </>
              ) : null}
            </div>
          )}
        </>
      ) : error ? null : (
        <p className={styles.muted}>Consultando…</p>
      )}
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
      {aviso ? <p className={styles.muted} role="status">{aviso}</p> : null}
      <p className={styles.muted}>Es la verificación individual de este prestador. Queda registrada con quién la hizo, cuándo y el motivo.</p>
    </section>
  )
}

// ADMIN-CONTRASENA-TEMPORAL-01. "Restablecer contraseña" for an account the ADMINISTRATION created
// (a client loaded to manage its turnos): the administrator sets a temporary password, or has one
// generated, with a mandatory note. It never sees the current password. A generated one is shown
// ONCE, here, to hand it over; the person must choose its own at its first sign-in. An account a
// person registered by itself is not offered this: its owner uses the recovery email above.
function ContrasenaTemporal({ cuenta, onHecho }: { cuenta: AdminUsuarioDetalle; onHecho: () => void }): React.ReactNode {
  const [abierto, setAbierto] = useState(false)
  const [contrasena, setContrasena] = useState('')
  const [repetir, setRepetir] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [generada, setGenerada] = useState<string | null>(null)
  const [aviso, setAviso] = useState('')
  if (cuenta.origen !== 'admin')
    return <p className={styles.muted} data-contrasena-temporal="no-disponible">Esta cuenta la registró su titular: su contraseña solo la cambia él, con el email de recuperación.</p>
  const enviar = async (generar: boolean) => {
    setError('')
    if (motivo.trim().length < 5) return setError('Escribí el motivo administrativo (al menos 5 caracteres).')
    if (!generar && contrasena.length < 12) return setError('La contraseña temporal necesita al menos 12 caracteres.')
    if (!generar && contrasena !== repetir) return setError('Las dos contraseñas no coinciden.')
    setGuardando(true)
    try {
      const respuesta = await adminApi.contrasenaTemporal(cuenta.id, generar ? { generar: true, motivo: motivo.trim() } : { contrasena, repetir, motivo: motivo.trim() })
      setGenerada(respuesta.contrasenaTemporal ?? null)
      setAviso('Contraseña temporal establecida. Se cerraron sus sesiones y va a tener que elegir la suya al ingresar.')
      setContrasena(''); setRepetir(''); setMotivo(''); setAbierto(false)
      onHecho()
    } catch (cause: unknown) {
      const code = cause instanceof AdminApiError ? cause.code : ''
      setError(code === 'PASSWORD_BREACHED' ? 'Esa contraseña apareció en filtraciones conocidas. Elegí otra.' : code === 'WEAK_PASSWORD' ? 'La contraseña no cumple la política (12 a 256 caracteres).' : code === 'PASSWORD_MISMATCH' ? 'Las dos contraseñas no coinciden.' : code === 'REASON_REQUIRED' ? 'Escribí el motivo administrativo (al menos 5 caracteres).' : code === 'NOT_ADMIN_CREATED' ? 'Esta cuenta la registró su titular: no se le puede fijar una contraseña desde Admin.' : adminErrorMessage(cause))
    } finally {
      setGuardando(false)
    }
  }
  return (
    <div data-contrasena-temporal={cuenta.debeCambiarContrasena ? 'pendiente-de-cambio' : 'disponible'} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      <h3 style={{ margin: 0 }}>Restablecer contraseña</h3>
      <p className={styles.muted} style={{ margin: 0 }}>
        Cuenta creada por la administración.{cuenta.debeCambiarContrasena ? ' Tiene una contraseña temporal: todavía no eligió la suya.' : ''}
        {!cuenta.verificado && !cuenta.telefono.verificado ? ' Para poder ingresar también necesita el email o el teléfono verificado.' : ''}
      </p>
      {aviso ? <p role="status">{aviso}</p> : null}
      {generada ? (
        <p data-contrasena-generada role="status" style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, overflowWrap: 'anywhere', padding: 12 }}>
          Contraseña temporal: <strong>{generada}</strong>
          <br />
          Se muestra una sola vez. Entregásela al titular: no se puede volver a consultar.{' '}
          <button className={styles.buttonSecondary} onClick={() => setGenerada(null)} type="button">Ya la copié</button>
        </p>
      ) : null}
      {abierto ? (
        <div role="group" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, display: 'grid', gap: 8, padding: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>Nueva contraseña temporal<input autoComplete="new-password" data-temporal onChange={(event) => setContrasena(event.target.value)} type="password" value={contrasena} /></label>
          <label style={{ display: 'grid', gap: 4 }}>Repetir contraseña<input autoComplete="new-password" data-temporal-repetir onChange={(event) => setRepetir(event.target.value)} type="password" value={repetir} /></label>
          <label style={{ display: 'grid', gap: 4 }}>Motivo administrativo (obligatorio)<textarea data-temporal-motivo maxLength={300} onChange={(event) => setMotivo(event.target.value)} rows={2} value={motivo} /></label>
          {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className={styles.buttonPrimary} data-temporal-guardar disabled={guardando} onClick={() => void enviar(false)} type="button">{guardando ? 'Guardando…' : 'Establecer contraseña temporal'}</button>
            <button className={styles.buttonSecondary} data-temporal-generar disabled={guardando} onClick={() => void enviar(true)} type="button">Generar contraseña temporal</button>
            <button className={styles.buttonSecondary} disabled={guardando} onClick={() => { setAbierto(false); setError('') }} type="button">Cancelar</button>
          </div>
        </div>
      ) : (
        <div>
          <button className={styles.buttonSecondary} data-temporal-abrir onClick={() => { setAbierto(true); setAviso(''); setGenerada(null) }} type="button">Restablecer contraseña</button>
        </div>
      )}
    </div>
  )
}

const ROL: Record<string, string> = { admin: 'Administrador', prestador: 'Prestador', cliente: 'Cliente' }

function errorEdicion(cause: unknown): string {
  if (cause instanceof AdminApiError) {
    if (cause.status === 409 && cause.code === 'PHONE_IN_USE') return 'Ese número ya es el teléfono verificado de otra cuenta.'
    if (cause.status === 409 && cause.code === 'WHATSAPP_IN_USE') return 'El WhatsApp de ese número ya está vinculado a otra cuenta. No se cambió nada.'
    if (cause.status === 422 && cause.code === 'PHONE_NOT_VERIFIED') return 'Para vincular WhatsApp la cuenta necesita un teléfono verificado.'
    if (cause.status === 422 && cause.code === 'NO_PHONE') return 'La cuenta no tiene un número cargado.'
    if (cause.status === 503 && cause.code === 'UNAVAILABLE') return 'La vinculación de WhatsApp no está disponible en este momento.'
    if (cause.status === 422 && cause.code === 'NO_PHONE') return 'Esta cuenta todavía no tiene un teléfono cargado.'
    if (cause.status === 409) return 'Ese email ya pertenece a otra cuenta.'
    if (cause.status === 403) return 'Esa cuenta es de administración o es tu propia cuenta: su email y verificación se gestionan desde la configuración y Seguridad.'
    if (cause.status === 422 && cause.code === 'INVALID_PHONE') return 'Revisá el número: con característica, por ejemplo 379 412-3456.'
    if (cause.status === 422 && cause.code === 'ALREADY_VERIFIED') return 'Ese número ya es el teléfono verificado de esta cuenta.'
    if (cause.status === 422 && (cause.code === 'INVALID_ACTION' || cause.code === 'INVALID_CHANGE')) return 'La operación no fue aceptada por el servidor. Recargá la página e intentá de nuevo.'
    if (cause.status === 422) return 'Revisá los datos: nombre de 2 a 120 caracteres y un email válido.'
  }
  return adminErrorMessage(cause)
}

interface IdentidadForm {
  nombre: string
  apellido: string
  tipoDocumento: string
  numeroDocumento: string
  motivo: string
}
type ErroresIdentidadForm = ErroresIdentidad & { motivo?: string }

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
  // null: the identity is shown read-only; an object: it is being edited.
  const [identidad, setIdentidad] = useState<IdentidadForm | null>(null)
  const [erroresIdentidad, setErroresIdentidad] = useState<ErroresIdentidadForm>({})

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

  // ---- identity (names + document): read-only until "Editar identidad"; validated here with the
  // same function the API uses (the API is the authority and validates again).
  const documentoActual = cuenta?.perfil?.documento ?? null
  const cambiaDocumento = identidad !== null && documentoActual !== null && (identidad.tipoDocumento !== documentoActual.tipo || identidad.numeroDocumento.replace(/[\s.]/gu, '').toUpperCase() !== documentoActual.numero)

  function editarIdentidad() {
    const actual = cuenta?.perfil
    setErroresIdentidad({})
    setAviso('')
    setIdentidad({ nombre: actual?.nombre ?? '', apellido: actual?.apellido ?? '', tipoDocumento: actual?.documento?.tipo ?? '', numeroDocumento: actual?.documento?.numero ?? '', motivo: '' })
  }

  function guardarIdentidad(event: FormEvent) {
    event.preventDefault()
    if (!cuenta || !identidad) return
    const validado = validarIdentidadPersonal({ ...identidad })
    const errores: ErroresIdentidadForm = validado.ok ? {} : { ...validado.errores }
    if (cambiaDocumento && identidad.motivo.trim().length < 3) errores.motivo = 'Contá el motivo del cambio (al menos 3 caracteres).'
    setErroresIdentidad(errores)
    if (!validado.ok || Object.keys(errores).length > 0) return
    const enviar = async () => {
      setBusy(true)
      setError('')
      setAviso('')
      try {
        await adminApi.identidadUsuario(cuenta.id, { ...validado.valor, ...(cambiaDocumento ? { motivo: identidad.motivo.trim() } : {}) })
        await cargar()
        setIdentidad(null)
        setAviso('Identidad actualizada.')
      } catch (cause) {
        // The API is the authority: its field errors are shown next to each field.
        if (cause instanceof AdminApiError && cause.code === 'INVALID_IDENTITY') {
          const etiquetas: ErroresIdentidadForm = { nombre: 'Ingresá el nombre: solo letras, de 2 a 60 caracteres.', apellido: 'Ingresá el apellido: solo letras, de 2 a 60 caracteres.', tipoDocumento: 'Elegí el tipo de documento.', numeroDocumento: 'El número de documento no es válido para ese tipo.' }
          setErroresIdentidad(Object.fromEntries(cause.fields.filter((campo): campo is keyof ErroresIdentidadForm => campo in etiquetas).map((campo) => [campo, etiquetas[campo]])))
        } else if (cause instanceof AdminApiError && cause.code === 'DOCUMENT_ALREADY_REGISTERED') setErroresIdentidad({ numeroDocumento: 'Ese documento ya está asociado a otra cuenta.' })
        else if (cause instanceof AdminApiError && cause.code === 'REASON_REQUIRED') setErroresIdentidad({ motivo: 'Contá el motivo del cambio (al menos 3 caracteres).' })
        else setError(errorEdicion(cause))
      } finally {
        setBusy(false)
      }
    }
    if (!cambiaDocumento) return void enviar()
    pedir({
      titulo: '¿Cambiar el documento de esta cuenta?',
      detalle: 'Este dato se utiliza para identificar al usuario dentro de TUS. El cambio quedará auditado.',
      confirmar: 'Cambiar documento',
      onConfirm: enviar,
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

        <VerificacionIdentidad cuentaId={cuenta.id} />
        <section aria-labelledby="usuario-identidad" className={styles.sheetCard}>
          <h2 id="usuario-identidad">Identidad</h2>
          <div className={styles.badges}>
            <span className={perfil?.perfilCompleto ? styles.badgeOk : styles.badgeWarn}>{perfil?.perfilCompleto ? 'Perfil completo' : 'Perfil incompleto'}</span>
          </div>
          {identidad === null ? (
            <>
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
              <p className={styles.muted}>El titular también puede cargar estos datos desde “Mi perfil”.</p>
              <div className={styles.actions}>
                <button className={styles.buttonSecondary} disabled={busy} onClick={editarIdentidad} type="button">
                  Editar identidad
                </button>
              </div>
            </>
          ) : (
            <form className={styles.formGrid} noValidate onSubmit={guardarIdentidad}>
              <label className={styles.field}>
                <span>Nombre</span>
                <input aria-invalid={Boolean(erroresIdentidad.nombre)} autoComplete="off" maxLength={60} onChange={(event) => setIdentidad({ ...identidad, nombre: event.target.value })} value={identidad.nombre} />
                {erroresIdentidad.nombre ? <span className={styles.fieldError} role="alert">{erroresIdentidad.nombre}</span> : null}
              </label>
              <label className={styles.field}>
                <span>Apellido</span>
                <input aria-invalid={Boolean(erroresIdentidad.apellido)} autoComplete="off" maxLength={60} onChange={(event) => setIdentidad({ ...identidad, apellido: event.target.value })} value={identidad.apellido} />
                {erroresIdentidad.apellido ? <span className={styles.fieldError} role="alert">{erroresIdentidad.apellido}</span> : null}
              </label>
              <label className={styles.field}>
                <span>Tipo de documento</span>
                <select aria-invalid={Boolean(erroresIdentidad.tipoDocumento)} onChange={(event) => setIdentidad({ ...identidad, tipoDocumento: event.target.value })} value={identidad.tipoDocumento}>
                  <option value="">Elegir…</option>
                  {TIPOS_DOCUMENTO.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {ETIQUETA_TIPO_DOCUMENTO[tipo]}
                    </option>
                  ))}
                </select>
                {erroresIdentidad.tipoDocumento ? <span className={styles.fieldError} role="alert">{erroresIdentidad.tipoDocumento}</span> : null}
              </label>
              <label className={styles.field}>
                <span>Número de documento</span>
                <input aria-invalid={Boolean(erroresIdentidad.numeroDocumento)} autoComplete="off" inputMode={identidad.tipoDocumento === 'PASAPORTE' ? 'text' : 'numeric'} maxLength={16} onChange={(event) => setIdentidad({ ...identidad, numeroDocumento: event.target.value })} value={identidad.numeroDocumento} />
                {erroresIdentidad.numeroDocumento ? <span className={styles.fieldError} role="alert">{erroresIdentidad.numeroDocumento}</span> : null}
              </label>
              {cambiaDocumento ? (
                <label className={`${styles.field} ${styles.wide}`}>
                  <span>Motivo del cambio de documento</span>
                  <input aria-invalid={Boolean(erroresIdentidad.motivo)} maxLength={300} onChange={(event) => setIdentidad({ ...identidad, motivo: event.target.value })} value={identidad.motivo} />
                  {erroresIdentidad.motivo ? <span className={styles.fieldError} role="alert">{erroresIdentidad.motivo}</span> : <span className={styles.hint}>Obligatorio. Queda registrado en la auditoría.</span>}
                </label>
              ) : null}
              <div className={`${styles.actions} ${styles.wide}`}>
                <button className={styles.buttonPrimary} disabled={busy} type="submit">
                  {busy ? 'Guardando…' : 'Guardar cambios'}
                </button>
                <button className={styles.buttonSecondary} disabled={busy} onClick={() => { setIdentidad(null); setErroresIdentidad({}) }} type="button">
                  Cancelar
                </button>
              </div>
            </form>
          )}
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
            {cuenta.telefono.verificado ? (
              <div>
                <dt>WhatsApp</dt>
                <dd>
                  <span className={cuenta.telefono.whatsappVinculado ? styles.badgeOk : styles.badgeWarn}>{cuenta.telefono.whatsappVinculado ? 'Vinculado' : 'No vinculado'}</span>
                </dd>
              </div>
            ) : null}
          </dl>
          {/* Only the actions that make sense for the real state. The administration certifies the
              contact: no code, no message from the owner of the number. The API decides and
              answers the new state; nothing is written from here. */}
          {(() => {
            const tel = cuenta.telefono
            const estado = tel.verificado ? (tel.whatsappVinculado ? 'vinculado' : 'verificado') : tel.pendiente ? 'pendiente' : 'sin_telefono'
            const contacto = (body: Parameters<typeof adminApi.contactoUsuario>[1], ok: string) => ejecutar(() => adminApi.contactoUsuario(cuenta.id, body), ok)
            const quitar = (
              <button
                className={styles.buttonDanger}
                data-contacto="quitar"
                disabled={busy}
                onClick={() =>
                  pedir({
                    titulo: '¿Quitar el número de esta cuenta?',
                    detalle: 'La cuenta queda sin teléfono: se desvincula su WhatsApp, se cancela lo que estaba pendiente de verificar y el número queda libre para otra cuenta. La cuenta y su historial no cambian. Queda auditado.',
                    confirmar: 'Quitar número',
                    onConfirm: () => contacto({ accion: 'quitar' }, 'Se quitó el número de la cuenta.'),
                  })
                }
                type="button"
              >
                Quitar número
              </button>
            )
            const guardar = (accion: 'pendiente' | 'guardar_verificar' | 'guardar_verificar_vincular') => {
              const numero = telefono.trim()
              if (!numero) return
              const hecho = { pendiente: 'Número cargado como pendiente de verificación.', guardar_verificar: 'Número guardado y verificado.', guardar_verificar_vincular: 'Número guardado, verificado y WhatsApp vinculado.' }[accion]
              const enviar = () => contacto({ accion, telefono: numero }, hecho).then(() => setTelefono(''))
              if (accion === 'pendiente') return void enviar()
              pedir({
                titulo: accion === 'guardar_verificar' ? '¿Guardar y verificar este número?' : '¿Guardar, verificar y vincular WhatsApp?',
                detalle: `Confirmás administrativamente que ${numero} pertenece a esta cuenta${accion === 'guardar_verificar_vincular' ? ' y que su WhatsApp es el de la cuenta: TUS le va a escribir a ese número' : ''}.${tel.verificado ? ' Reemplaza al teléfono actual, cuyo WhatsApp deja de estar vinculado.' : ''} Queda auditado.`,
                confirmar: accion === 'guardar_verificar' ? 'Guardar y verificar' : 'Guardar, verificar y vincular',
                onConfirm: enviar,
              })
            }
            const formulario = (
              <form className={styles.formGrid} data-contacto-formulario onSubmit={(event) => { event.preventDefault(); guardar('guardar_verificar_vincular') }}>
                <label className={`${styles.field} ${styles.wide}`}>
                  <span>{estado === 'sin_telefono' ? 'Número' : 'Nuevo número'}</span>
                  <input autoComplete="off" data-contacto="numero" inputMode="tel" maxLength={32} onChange={(event) => setTelefono(event.target.value)} placeholder="379 412-3456" type="tel" value={telefono} />
                  <span className={styles.hint}>Con característica. Vos certificás que el número es de esta cuenta: no se le pide ningún código a la persona.</span>
                </label>
                <div className={`${styles.actions} ${styles.wide}`}>
                  <button className={styles.buttonPrimary} data-contacto="guardar_verificar_vincular" disabled={busy || !telefono.trim()} type="submit">
                    Guardar, verificar y vincular WhatsApp
                  </button>
                  <button className={styles.buttonSecondary} data-contacto="guardar_verificar" disabled={busy || !telefono.trim()} onClick={() => guardar('guardar_verificar')} type="button">
                    Guardar y verificar
                  </button>
                  <button className={styles.buttonSecondary} data-contacto="pendiente" disabled={busy || !telefono.trim()} onClick={() => guardar('pendiente')} type="button">
                    Guardar como pendiente
                  </button>
                </div>
              </form>
            )
            return (
              <div data-contacto-estado={estado}>
                <div className={styles.actions}>
                  {estado === 'pendiente' ? (
                    <>
                      <button
                        className={styles.buttonPrimary}
                        data-contacto="verificar_vincular"
                        disabled={busy}
                        onClick={() =>
                          pedir({
                            titulo: '¿Verificar este teléfono y vincular su WhatsApp?',
                            detalle: 'Confirmás administrativamente que el número pertenece a esta cuenta y que su WhatsApp es el de la cuenta: TUS le va a escribir a ese número. Queda auditado.',
                            confirmar: 'Verificar y vincular',
                            onConfirm: () => contacto({ accion: 'verificar_vincular' }, 'Teléfono verificado y WhatsApp vinculado.'),
                          })
                        }
                        type="button"
                      >
                        Verificar y vincular WhatsApp
                      </button>
                      <button
                        className={styles.buttonSecondary}
                        data-contacto="verificar"
                        disabled={busy}
                        onClick={() =>
                          pedir({
                            titulo: '¿Marcar este teléfono como verificado?',
                            detalle: 'Esta acción confirma administrativamente que el número pertenece a esta cuenta. No vincula WhatsApp. Queda auditado.',
                            confirmar: 'Verificar teléfono',
                            onConfirm: () => contacto({ accion: 'verificar' }, 'Teléfono marcado como verificado.'),
                          })
                        }
                        type="button"
                      >
                        Verificar
                      </button>
                      {quitar}
                    </>
                  ) : estado === 'verificado' ? (
                    <>
                      <button
                        className={styles.buttonPrimary}
                        data-contacto="vincular_whatsapp"
                        disabled={busy}
                        onClick={() =>
                          pedir({
                            titulo: '¿Vincular el WhatsApp de este teléfono?',
                            detalle: 'El WhatsApp del teléfono verificado pasa a ser el de esta cuenta: TUS le va a escribir a ese número. No hace falta que la persona escriba primero. Queda auditado.',
                            confirmar: 'Vincular WhatsApp',
                            onConfirm: () => contacto({ accion: 'vincular_whatsapp' }, 'WhatsApp vinculado.'),
                          })
                        }
                        type="button"
                      >
                        Vincular WhatsApp
                      </button>
                      <button
                        className={styles.buttonDanger}
                        data-contacto="desverificar"
                        disabled={busy}
                        onClick={() =>
                          pedir({
                            titulo: '¿Quitar la verificación de este teléfono?',
                            detalle: 'El número dejará de considerarse verificado y vuelve a quedar pendiente. Queda auditado.',
                            confirmar: 'Quitar verificación',
                            onConfirm: () => contacto({ accion: 'desverificar' }, 'Se quitó la verificación del teléfono.'),
                          })
                        }
                        type="button"
                      >
                        Quitar verificación
                      </button>
                      {quitar}
                    </>
                  ) : estado === 'vinculado' ? (
                    <>
                      <button
                        className={styles.buttonDanger}
                        data-contacto="desvincular_whatsapp"
                        disabled={busy}
                        onClick={() =>
                          pedir({
                            titulo: '¿Desvincular el WhatsApp de esta cuenta?',
                            detalle: 'TUS deja de escribirle a ese WhatsApp por esta cuenta. El teléfono sigue verificado; el email, la identidad, las sesiones y las conversaciones no cambian. Queda auditado.',
                            confirmar: 'Desvincular WhatsApp',
                            onConfirm: () => contacto({ accion: 'desvincular_whatsapp' }, 'WhatsApp desvinculado.'),
                          })
                        }
                        type="button"
                      >
                        Desvincular WhatsApp
                      </button>
                      {quitar}
                    </>
                  ) : (
                    <p className={styles.muted}>Esta cuenta todavía no tiene un teléfono cargado.</p>
                  )}
                </div>
                {/* With a number already there, replacing it stays folded until it is needed. */}
                {estado === 'sin_telefono' ? formulario : (
                  <details data-contacto="reemplazar">
                    <summary>Reemplazar número</summary>
                    {formulario}
                  </details>
                )}
              </div>
            )
          })()}
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
          <ContrasenaTemporal cuenta={cuenta} onHecho={() => void cargar()} />
        </section>
      </div>
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}
