'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { neighbourhoodNames, useCatalog } from '@/features/catalog/use-catalog'
import { ServicePicker } from '@/features/catalog/service-picker'
import { LocationEditor } from '@/features/provider/provider-location'
import { AdminApiError, DESTINO_WHATSAPP, PROBLEMA_CUENTA, textoCobroSena, adminApi, adminErrorMessage, formatFecha, type AdminPrestadorDetalle, type CambiosPrestador } from '@/lib/tus-admin-api'
import { AdminConfirm, useConfirmacion } from './admin-confirm'
import { AdminPageHeader } from './admin-layout'
import styles from './admin.module.css'

const CAMPOS: Record<string, string> = {
  displayName: 'Nombre público: de 2 a 60 caracteres, sin teléfonos ni emails.',
  profession: 'Elegí al menos un servicio vigente (hasta 20).',
  zone: 'La zona principal no está en el catálogo.',
  serviceZones: 'Elegí hasta 8 zonas válidas.',
  serviceMode: 'Elegí la modalidad de atención.',
  coverageRadiusKm: 'El radio va de 1 a 100 km.',
  description: 'La descripción admite hasta 600 caracteres, sin datos de contacto.',
  yearsOfExperience: 'Los años de experiencia van de 0 a 70.',
}

type Form = {
  displayName: string
  professions: string[]
  zone: string
  serviceZones: string[]
  serviceMode: 'local' | 'domicilio' | 'mixto'
  coverageRadiusKm: string
  description: string
  yearsOfExperience: string
  visible: boolean
  providerStatus: 'approved' | 'suspended'
}

const desdeDetalle = (detalle: AdminPrestadorDetalle): Form => ({
  displayName: detalle.perfil.displayName,
  professions: detalle.perfil.professions.length ? detalle.perfil.professions : [detalle.perfil.profession],
  zone: detalle.perfil.zone ?? '',
  serviceZones: detalle.perfil.serviceZones,
  serviceMode: detalle.perfil.serviceMode,
  coverageRadiusKm: detalle.perfil.coverageRadiusKm === null ? '' : String(detalle.perfil.coverageRadiusKm),
  description: detalle.perfil.description ?? '',
  yearsOfExperience: detalle.perfil.yearsOfExperience === null ? '' : String(detalle.perfil.yearsOfExperience),
  visible: detalle.perfil.visible,
  providerStatus: detalle.prestador?.estado === 'suspended' ? 'suspended' : 'approved',
})

// Provider detail: the administration can change every business attribute of the provider
// (public data, services by category, coverage, visibility, approval, map location) and jump to
// the owner account (name, email, status). Tenant, internal ids and secrets are never editable.
export function AdminPrestadorDetallePage({ id }: { id: string }): React.ReactNode {
  const catalogo = useCatalog()
  const [detalle, setDetalle] = useState<AdminPrestadorDetalle | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState('')
  const [campos, setCampos] = useState<string[]>([])
  const [aviso, setAviso] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmacion, pedir, cerrar] = useConfirmacion()

  const aplicar = (value: AdminPrestadorDetalle) => { setDetalle(value); setForm(desdeDetalle(value)) }
  const cargar = useCallback(() => adminApi.prestador(id).then((value) => { aplicar(value); setError('') })
    .catch((cause) => setError(cause instanceof AdminApiError && cause.status === 404 ? 'No existe ese prestador.' : adminErrorMessage(cause))), [id])
  useEffect(() => { void cargar() }, [cargar])

  const cargarUbicacion = useCallback(async () => (await adminApi.ubicacionPrestador(id)).location, [id])
  const guardarUbicacion = useCallback(async (input: { lat: number; lng: number; showExact: boolean }) => (await adminApi.guardarUbicacionPrestador(id, input)).location, [id])
  const quitarUbicacion = useCallback(async () => (await adminApi.quitarUbicacionPrestador(id)).location, [id])

  async function enviar(cambios: CambiosPrestador, ok: string) {
    setBusy(true); setError(''); setAviso(''); setCampos([])
    try {
      aplicar(await adminApi.editarPrestador(id, cambios))
      setAviso(ok)
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.status === 422) {
        setError('Revisá los campos marcados.')
        setCampos(cause.fields.length ? cause.fields : validarLocal(cambios))
      } else setError(adminErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function guardar(event: FormEvent) {
    event.preventDefault()
    if (!form || !detalle) return
    const cambios: CambiosPrestador = {
      displayName: form.displayName.trim(),
      profession: form.professions[0] ?? '',
      professions: form.professions,
      zone: form.zone || null,
      serviceZones: form.serviceZones,
      serviceMode: form.serviceMode,
      coverageRadiusKm: form.coverageRadiusKm.trim() === '' ? null : Number(form.coverageRadiusKm),
      description: form.description.trim() || null,
      yearsOfExperience: form.yearsOfExperience.trim() === '' ? null : Number(form.yearsOfExperience),
      visible: form.visible,
      ...(detalle.prestador && form.providerStatus !== (detalle.prestador.estado === 'suspended' ? 'suspended' : 'approved') ? { providerStatus: form.providerStatus } : {}),
    }
    const locales = validarLocal(cambios)
    if (locales.length) { setCampos(locales); setError('Revisá los campos marcados.'); return }
    if (cambios.providerStatus === 'suspended')
      return pedir({ titulo: `¿Suspender a ${detalle.perfil.displayName} como prestador?`, detalle: 'Sale del directorio y del mapa y no puede operar hasta que lo apruebes de nuevo. Su historial se conserva.', confirmar: 'Suspender', onConfirm: () => enviar(cambios, 'Prestador suspendido y perfil guardado.') })
    void enviar(cambios, 'Prestador actualizado.')
  }

  if (error && !detalle) return <p className={styles.error} role="alert">{error}</p>
  if (!detalle || !form) return <p className={styles.muted} role="status">Cargando prestador…</p>
  const zonas = neighbourhoodNames(catalogo.data)
  const campo = (key: string) => (campos.includes(key) ? <span className={styles.error} role="alert">{CAMPOS[key]}</span> : null)
  return (
    <>
      <AdminPageHeader subtitle={`Alta ${formatFecha(detalle.perfil.createdAt)} · Modificado ${formatFecha(detalle.perfil.updatedAt)}`} title={detalle.perfil.displayName}>
        <a className={styles.buttonSecondary} href="/tus/admin/prestadores">Volver a prestadores</a>
      </AdminPageHeader>
      {aviso ? <p className={styles.success} role="status">{aviso}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section aria-labelledby="prestador-cuenta" className={styles.card} data-cuenta-asociada={detalle.cuentaAsociada?.cuentaId ?? detalle.cuenta?.id ?? 'sin-cuenta'}>
        <h2 id="prestador-cuenta">Cuenta asociada</h2>
        <p className={styles.muted}>La persona real detrás de este perfil. Su identidad, su teléfono y su WhatsApp son los de la cuenta, no los del perfil profesional.</p>
        {detalle.cuentaAsociada ? (() => {
          const cuenta = detalle.cuentaAsociada
          const destino = DESTINO_WHATSAPP[cuenta.whatsapp.destino]
          const si = (valor: boolean, textoSi: string, textoNo: string) => <span className={`${styles.badge} ${valor ? styles.badgeOk : styles.badgeWarn}`}>{valor ? textoSi : textoNo}</span>
          return (
            <>
              <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.75rem', margin: '0.5rem 0' }}>
                <div><dt className={styles.muted}>Nombre real del titular</dt><dd style={{ margin: 0 }}>{cuenta.nombre}</dd></div>
                <div><dt className={styles.muted}>Email</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{cuenta.email} {si(cuenta.emailVerificado, 'Confirmado', 'Sin confirmar')}</dd></div>
                <div><dt className={styles.muted}>Documento</dt><dd style={{ margin: 0 }}>{cuenta.documento ? `${cuenta.documento.tipo} ${cuenta.documento.numero}` : 'Sin cargar'}</dd></div>
                <div><dt className={styles.muted}>Identidad</dt><dd style={{ margin: 0 }}>{cuenta.identidad ? cuenta.identidad : 'Sin verificación iniciada'}</dd></div>
                <div><dt className={styles.muted}>Teléfono</dt><dd style={{ margin: 0 }}>{cuenta.telefono.numero ?? cuenta.telefono.pendiente ?? 'Sin teléfono'} {cuenta.telefono.numero ? si(true, 'Verificado', '') : cuenta.telefono.pendiente ? si(false, '', 'Sin verificar') : null}</dd></div>
                <div data-whatsapp-destino={cuenta.whatsapp.destino}>
                  <dt className={styles.muted}>WhatsApp</dt>
                  <dd style={{ margin: 0 }}>
                    {si(cuenta.whatsapp.vinculado, 'Vinculado', 'No vinculado')}{' '}
                    <span className={`${styles.badge} ${destino.tono === 'ok' ? styles.badgeOk : destino.tono === 'warn' ? styles.badgeWarn : styles.badgeOff}`}>{destino.texto}</span>
                    <br />
                    <span className={styles.muted}>{destino.detalle}</span>
                  </dd>
                </div>
                <div><dt className={styles.muted}>Estado de la cuenta</dt><dd style={{ margin: 0 }}>{cuenta.estado === 'active' ? 'Activa' : 'Suspendida'}</dd></div>
                <div><dt className={styles.muted}>Diagnóstico</dt><dd className={styles.muted} style={{ margin: 0, overflowWrap: 'anywhere', fontSize: '0.85rem' }}>cuenta {cuenta.cuentaId}<br />usuario {cuenta.usuarioId}{detalle.tenantId ? <><br />tenant {detalle.tenantId}</> : null}</dd></div>
              </dl>
              {cuenta.cuentasEnTenant > 1 ? <p className={styles.muted}>El titular de este prestador tiene {cuenta.cuentasEnTenant} cuentas. La vinculada es la de arriba: es la única que TUS usa para avisarle.</p> : null}
              <a className={styles.buttonSecondary} href={`/tus/admin/usuarios/${encodeURIComponent(cuenta.cuentaId)}`}>Abrir la ficha de la cuenta (nombre, email, teléfono, WhatsApp, accesos)</a>
            </>
          )
        })() : (
          <p className={styles.error} data-cuenta-problema={detalle.cuentaProblema?.motivo ?? 'sin_vincular'} role="alert">
            {PROBLEMA_CUENTA[detalle.cuentaProblema?.motivo ?? 'sin_vincular']} Mientras tanto no recibe avisos ni solicitudes por WhatsApp.
            {detalle.cuentaProblema && detalle.cuentaProblema.cuentasEnTenant > 0 ? ` Su titular tiene ${detalle.cuentaProblema.cuentasEnTenant} ${detalle.cuentaProblema.cuentasEnTenant === 1 ? 'cuenta' : 'cuentas'} para revisar.` : ' No hay ninguna cuenta de ese titular.'}
          </p>
        )}
      </section>

      {detalle.cobroSena !== undefined ? (() => {
        const cobro = textoCobroSena(detalle.cobroSena)
        return (
          <section aria-labelledby="prestador-cobro" className={styles.card} data-cobro-sena={detalle.cobroSena ? (detalle.cobroSena.disponible ? detalle.cobroSena.modo ?? 'disponible' : detalle.cobroSena.motivo ?? 'no') : ''}>
            <h2 id="prestador-cobro">Cobro de señas</h2>
            <p><span className={`${styles.badge} ${cobro.tono === 'ok' ? styles.badgeOk : cobro.tono === 'warn' ? styles.badgeWarn : styles.badgeOff}`}>{cobro.texto}</span> {cobro.detalle}</p>
          </section>
        )
      })() : null}

      {detalle.tipoPrestador ? <TipoPrestador detalle={detalle} id={id} onGuardado={(value) => { aplicar(value); setAviso(value.cambio ? 'Tipo de prestador actualizado.' : 'No había nada para cambiar.') }} pedir={pedir} /> : null}

      <form aria-label="Perfil del prestador" className={`${styles.card} ${styles.form}`} onSubmit={guardar}>
        <h2>Perfil profesional</h2>
        {/* PRESTADOR-TIPO-01: the name of a person is derived from the holder of the account; only a
            business has a name to type. The API refuses it too. */}
        {detalle.tipoPrestador === 'persona_fisica' ? (
          <div data-nombre-derivado>
            <span>Nombre público</span>
            <p style={{ fontWeight: 600, margin: '4px 0', overflowWrap: 'anywhere' }}>{detalle.perfil.displayName}</p>
            <p className={styles.muted} style={{ margin: 0 }}>En personas físicas se utiliza el nombre completo del titular de la cuenta.</p>
          </div>
        ) : (
          <label>Nombre público<input maxLength={60} minLength={2} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required value={form.displayName} />{campo('displayName')}</label>
        )}
        <label>Descripción<textarea maxLength={600} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} value={form.description} />{campo('description')}</label>
        <label>Años de experiencia<input max={70} min={0} onChange={(event) => setForm({ ...form, yearsOfExperience: event.target.value })} type="number" value={form.yearsOfExperience} />{campo('yearsOfExperience')}</label>

        <h2>Servicios</h2>
        {catalogo.data ? (
          <ServicePicker categories={catalogo.data.categories ?? []} idPrefix="admin-servicio" onChange={(professions) => setForm({ ...form, professions })} services={catalogo.data.items} value={form.professions} />
        ) : <p className={styles.muted}>Cargando catálogo…</p>}
        {campo('profession')}

        <h2>Cobertura</h2>
        <label>Zona principal
          <select onChange={(event) => setForm({ ...form, zone: event.target.value })} value={form.zone}>
            <option value="">Sin zona principal</option>
            {[...new Set([...(form.zone ? [form.zone] : []), ...zonas])].map((zona) => <option key={zona} value={zona}>{zona}</option>)}
          </select>
          {campo('zone')}
        </label>
        <fieldset>
          <legend>Zonas donde presta servicio</legend>
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {[...new Set([...form.serviceZones, ...zonas])].map((zona) => (
              <label key={zona} style={{ alignItems: 'center', display: 'flex', flexDirection: 'row', gap: 6 }}>
                <input checked={form.serviceZones.includes(zona)} onChange={(event) => setForm({ ...form, serviceZones: event.target.checked ? [...new Set([...form.serviceZones, zona])] : form.serviceZones.filter((item) => item !== zona) })} type="checkbox" />
                <span>{zona}</span>
              </label>
            ))}
          </div>
          {campo('serviceZones')}
        </fieldset>
        <label>Modalidad
          <select onChange={(event) => setForm({ ...form, serviceMode: event.target.value as Form['serviceMode'] })} value={form.serviceMode}>
            <option value="domicilio">A domicilio</option>
            <option value="local">En su local</option>
            <option value="mixto">Mixta</option>
          </select>
        </label>
        <label>Radio de cobertura (km, opcional)<input max={100} min={1} onChange={(event) => setForm({ ...form, coverageRadiusKm: event.target.value })} type="number" value={form.coverageRadiusKm} />{campo('coverageRadiusKm')}</label>

        <h2>Estado</h2>
        <label style={{ alignItems: 'center', display: 'flex', flexDirection: 'row', gap: 8 }}>
          <input checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} type="checkbox" />
          <span>Perfil visible en el directorio y el mapa</span>
        </label>
        {detalle.prestador ? (
          <label>Aprobación del prestador
            <select onChange={(event) => setForm({ ...form, providerStatus: event.target.value === 'suspended' ? 'suspended' : 'approved' })} value={form.providerStatus}>
              <option value="approved">Aprobado (puede operar)</option>
              <option value="suspended">Suspendido (fuera del directorio)</option>
            </select>
          </label>
        ) : <p className={styles.muted}>Sin alta de prestador.</p>}
        <div className={styles.chips}>
          <button className={styles.buttonPrimary} disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar prestador'}</button>
          <button className={styles.buttonSecondary} disabled={busy} onClick={() => { setForm(desdeDetalle(detalle)); setCampos([]); setError('') }} type="button">Descartar cambios</button>
        </div>
      </form>

      <section aria-labelledby="prestador-ubicacion" className={styles.card}>
        <h2 id="prestador-ubicacion">Ubicación en el mapa</h2>
        <LocationEditor load={cargarUbicacion} owner={false} remove={quitarUbicacion} save={guardarUbicacion} />
      </section>
      <AdminConfirm onClose={cerrar} value={confirmacion} />
    </>
  )
}

function validarLocal(cambios: CambiosPrestador): string[] {
  const errores: string[] = []
  const nombre = cambios.displayName ?? ''
  if (cambios.displayName !== undefined && (nombre.length < 2 || nombre.length > 60)) errores.push('displayName')
  if (cambios.professions !== undefined && (cambios.professions.length === 0 || cambios.professions.length > 20)) errores.push('profession')
  if (cambios.serviceZones !== undefined && cambios.serviceZones.length > 8) errores.push('serviceZones')
  const radio = cambios.coverageRadiusKm
  if (radio !== undefined && radio !== null && (!Number.isInteger(radio) || radio < 1 || radio > 100)) errores.push('coverageRadiusKm')
  const anios = cambios.yearsOfExperience
  if (anios !== undefined && anios !== null && (!Number.isInteger(anios) || anios < 0 || anios > 70)) errores.push('yearsOfExperience')
  if ((cambios.description ?? '').length > 600) errores.push('description')
  return errores
}

// PRESTADOR-TIPO-01. Persona física <-> Empresa. Only how the provider is presented: the same
// account, provider, services, turnos and history. To "Persona física" the public name becomes the
// name of the holder of the account (the API takes it from the account; it is previewed here). To
// "Empresa" the public name can be kept or replaced by a trade name. The holder never changes.
const ETIQUETA_TIPO: Record<'persona_fisica' | 'empresa', string> = { persona_fisica: 'Persona física', empresa: 'Empresa' }
function TipoPrestador({ detalle, id, onGuardado, pedir }: { detalle: AdminPrestadorDetalle; id: string; onGuardado: (value: AdminPrestadorDetalle & { cambio: boolean }) => void; pedir: ReturnType<typeof useConfirmacion>[1] }): React.ReactNode {
  const actual = detalle.tipoPrestador ?? 'persona_fisica'
  const [tipo, setTipo] = useState<'persona_fisica' | 'empresa'>(actual)
  const [nombre, setNombre] = useState(detalle.perfil.displayName)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setTipo(actual); setNombre(detalle.perfil.displayName); setMotivo(''); setError('') }, [actual, detalle.perfil.displayName])
  const titular = detalle.titular?.nombreCompleto ?? null
  const nombreFinal = tipo === 'persona_fisica' ? titular : nombre.replace(/\s+/gu, ' ').trim() || detalle.perfil.displayName
  const sinCambios = tipo === actual && nombreFinal === detalle.perfil.displayName
  const enviar = async () => {
    setGuardando(true)
    setError('')
    try {
      onGuardado(await adminApi.cambiarTipoPrestador(id, { tipo, ...(tipo === 'empresa' ? { nombrePublico: nombre } : {}), ...(motivo.trim() ? { motivo: motivo.trim() } : {}) }))
    } catch (cause: unknown) {
      const code = cause instanceof AdminApiError ? cause.code : ''
      setError(code === 'HOLDER_NAME_REQUIRED' ? 'El titular de la cuenta no tiene nombre y apellido cargados. Completalos primero en Usuarios → Identidad.' : code === 'HOLDER_NAME_TOO_LONG' ? 'El nombre y apellido del titular superan los 60 caracteres del nombre público.' : code === 'INVALID_PUBLIC_NAME' ? 'El nombre público necesita entre 2 y 60 caracteres, sin teléfonos, emails ni enlaces.' : adminErrorMessage(cause))
    } finally {
      setGuardando(false)
    }
  }
  const guardar = () => {
    if (tipo === actual) return void enviar()
    pedir({
      titulo: `¿Pasar a ${ETIQUETA_TIPO[tipo]}?`,
      detalle: tipo === 'persona_fisica'
        ? `El prestador pasará a Persona física y su nombre público será ${titular}. Sus servicios, turnos e historial no se modificarán.`
        : 'El prestador pasará a Empresa. Sus servicios, turnos e historial no se modificarán.',
      confirmar: 'Sí, cambiar',
      onConfirm: enviar,
    })
  }
  return (
    <section aria-labelledby="prestador-tipo" className={styles.card} data-tipo-prestador={actual}>
      <h2 id="prestador-tipo">Tipo de prestador</h2>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.75rem', margin: '0.5rem 0' }}>
        <div><dt className={styles.muted}>Titular de la cuenta</dt><dd data-titular style={{ margin: 0, overflowWrap: 'anywhere' }}>{titular ?? <span className={styles.muted}>Sin nombre y apellido cargados</span>}</dd></div>
        <div><dt className={styles.muted}>Tipo</dt><dd style={{ margin: 0 }}>{ETIQUETA_TIPO[actual]}</dd></div>
        <div><dt className={styles.muted}>Nombre público</dt><dd data-nombre-publico style={{ margin: 0, overflowWrap: 'anywhere' }}>{detalle.perfil.displayName}</dd></div>
      </dl>
      {actual === 'persona_fisica' ? <p className={styles.muted} data-ayuda-persona style={{ margin: '0 0 0.5rem' }}>En personas físicas se utiliza el nombre completo del titular de la cuenta.</p> : null}
      <fieldset style={{ border: 0, display: 'flex', flexWrap: 'wrap', gap: 16, margin: 0, padding: 0 }}>
        <legend className={styles.muted}>Presentarlo como</legend>
        {(['persona_fisica', 'empresa'] as const).map((opcion) => (
          <label key={opcion} style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
            <input checked={tipo === opcion} data-tipo-opcion={opcion} name="tipo-prestador" onChange={() => { setTipo(opcion); setError('') }} type="radio" value={opcion} />
            {ETIQUETA_TIPO[opcion]}
          </label>
        ))}
      </fieldset>
      {tipo === 'empresa' ? (
        <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          Nombre público del prestador
          <input data-nombre-empresa maxLength={60} onChange={(event) => setNombre(event.target.value)} value={nombre} />
          <span className={styles.muted}>Podés cambiarlo por el nombre comercial de la empresa, o dejarlo como está. El titular de la cuenta no cambia.</span>
        </label>
      ) : (
        <p data-vista-previa style={{ marginBottom: 0 }}>
          {titular ? <>El nombre público pasará a: <strong>{titular}</strong></> : <span className={styles.error}>Para pasar a Persona física el titular necesita nombre y apellido. Completalos primero en Usuarios → Identidad.</span>}
        </p>
      )}
      <label style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        Motivo (opcional)
        <input data-motivo-tipo maxLength={300} onChange={(event) => setMotivo(event.target.value)} value={motivo} />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button className={styles.buttonPrimary} data-guardar-tipo disabled={guardando || sinCambios || (tipo === 'persona_fisica' && !titular)} onClick={guardar} type="button">{guardando ? 'Guardando…' : 'Guardar tipo'}</button>
      </div>
    </section>
  )
}
