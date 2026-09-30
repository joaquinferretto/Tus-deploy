'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { neighbourhoodNames, useCatalog } from '@/features/catalog/use-catalog'
import { ServicePicker } from '@/features/catalog/service-picker'
import { LocationEditor } from '@/features/provider/provider-location'
import { AdminApiError, adminApi, adminErrorMessage, formatFecha, type AdminPrestadorDetalle, type CambiosPrestador } from '@/lib/tus-admin-api'
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

      <section aria-labelledby="prestador-cuenta" className={styles.card}>
        <h2 id="prestador-cuenta">Cuenta</h2>
        {detalle.cuenta ? (
          <>
            <p>{detalle.cuenta.nombre} · {detalle.cuenta.email}</p>
            <p>Estado de la cuenta: {detalle.cuenta.estado === 'active' ? 'activa' : 'suspendida'} · Email {detalle.cuenta.verificado ? 'confirmado' : 'sin confirmar'}</p>
            <a className={styles.buttonSecondary} href={`/tus/admin/usuarios/${encodeURIComponent(detalle.cuenta.id)}`}>Editar nombre, email, estado y accesos de la cuenta</a>
          </>
        ) : <p className={styles.muted}>No encontramos la cuenta titular.</p>}
      </section>

      <form aria-label="Perfil del prestador" className={`${styles.card} ${styles.form}`} onSubmit={guardar}>
        <h2>Datos del perfil</h2>
        <label>Nombre público<input maxLength={60} minLength={2} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required value={form.displayName} />{campo('displayName')}</label>
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
