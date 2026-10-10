'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { CategoriaPublica, OficioPublico } from '@factory/contracts'

import { FieldError, FormError, TextField } from '../auth/auth-fields'
import authStyles from '../auth/auth.module.css'
import { DirectoryRequestError, createDirectoryClient } from '../directory/directory-client'
import styles from '../directory/directory.module.css'
import { useTusSession } from '../session/use-tus-session'
import { ServicePicker } from '../catalog/service-picker'
import { ProfilePhoto } from './profile-photo'

const client = createDirectoryClient()
const RETURN_TO = '/prestador/perfil-publico'

const FIELD_MESSAGES: Record<string, string> = {
  displayName: 'Usá tu nombre o el de tu negocio (2 a 60 caracteres, sin teléfonos ni emails).',
  profession: 'Elegí al menos un servicio válido (hasta 20).',
  zone: 'Elegí un barrio válido.',
  serviceZones: 'Elegí hasta 8 zonas válidas.',
  serviceMode: 'Elegí cómo atendés.',
  coverageRadiusKm: 'Ingresá un radio entre 1 y 100 km.',
  description: 'Hasta 600 caracteres, sin teléfonos, emails ni links.',
  yearsOfExperience: 'Ingresá los años como número entero (0 a 70).',
}

// The provider chooses what the directory shows. Verification, completed jobs and hours are
// computed by TUS and cannot be edited here.
export function ProviderPublicProfile(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [catalog, setCatalog] = useState<{ items: OficioPublico[]; zones: string[]; categories?: CategoriaPublica[] }>({ items: [], zones: [] })
  const [values, setValues] = useState({ displayName: '', professions: [] as string[], zone: '', serviceZones: [] as string[], serviceMode: 'domicilio' as 'local' | 'domicilio' | 'mixto', coverageRadiusKm: '', description: '', years: '', visible: true })
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'not_provider' | 'error'>('loading')
  const [fields, setFields] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [publicId, setPublicId] = useState<string | null>(null)
  // PRESTADOR-TIPO-01: the name of a person is the full name of the holder of the account.
  const [derivedName, setDerivedName] = useState<string | null>(null)
  const [photo, setPhoto] = useState<{ url: string | null; initials: string }>({ url: null, initials: '' })

  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
    if (session.status !== 'authenticated') return
    void Promise.all([client.catalog(), client.myProfile(session.session)])
      .then(([loadedCatalog, mine]) => {
        setCatalog(loadedCatalog)
        const derived = mine.publicName?.type === 'persona_fisica' ? mine.publicName.derived : null
        setDerivedName(derived)
        if (derived) setValues((current) => ({ ...current, displayName: derived }))
        if (mine.profile) {
          setPublicId(mine.profile.id)
          setPhoto({ url: mine.profile.photoUrl ?? null, initials: mine.profile.initials })
          setValues({
            displayName: derived ?? mine.profile.displayName,
            professions: mine.profile.professions?.map((item) => item.id) ?? [mine.profile.profession.id],
            zone: mine.profile.serviceZones[0] ?? '',
            serviceZones: mine.profile.serviceZones,
            serviceMode: mine.profile.coverage.mode,
            coverageRadiusKm: mine.profile.coverage.radiusKm === null ? '' : String(mine.profile.coverage.radiusKm),
            description: mine.profile.description ?? '',
            years: mine.profile.yearsOfExperience === null ? '' : String(mine.profile.yearsOfExperience),
            visible: mine.profile.visible,
          })
        }
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [session])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (session.status !== 'authenticated') return
    setStatus('saving')
    setFields([])
    setMessage('')
    try {
      const years = values.years.trim() === '' ? null : Number(values.years)
      const coverageRadiusKm = values.coverageRadiusKm.trim() === '' ? null : Number(values.coverageRadiusKm)
      const result = await client.saveProfile(session.session, {
        displayName: values.displayName.trim(),
        profession: values.professions[0] ?? '',
        professions: values.professions,
        zone: values.zone,
        serviceZones: values.serviceZones,
        serviceMode: values.serviceMode,
        coverageRadiusKm,
        description: values.description.trim(),
        yearsOfExperience: years,
        visible: values.visible,
      })
      setPublicId(result.profile.id)
      setStatus('saved')
    } catch (error) {
      if (error instanceof DirectoryRequestError && error.code === 'INVALID_PROFILE') setFields(error.fields)
      else if (error instanceof DirectoryRequestError && error.code === 'PUBLIC_NAME_DERIVED') setMessage('Tu nombre público es tu nombre completo y no se puede cambiar desde acá. Si trabajás como empresa, escribinos desde Ayuda.')
      else if (error instanceof DirectoryRequestError && error.code === 'PROVIDER_REQUIRED') {
        setStatus('not_provider')
        return
      } else setMessage('No pudimos guardar tu perfil. Probá de nuevo en unos minutos.')
      setStatus('ready')
    }
  }

  const error = (field: string) => (fields.includes(field) ? FIELD_MESSAGES[field] : undefined)

  if (session.status !== 'authenticated' || status === 'loading')
    return (
      <p aria-busy="true" className={styles.resultCount} role="status">
        Cargando tu perfil…
      </p>
    )
  if (status === 'error')
    return (
      <p className={authStyles.formError} role="alert">
        No pudimos cargar tu perfil. Probá de nuevo en unos minutos.
      </p>
    )
  if (status === 'not_provider')
    return (
      <div className={styles.state} role="alert">
        Primero completá tu alta como prestador en tu panel; después podés publicar tu perfil.
        <div className={styles.stateActions}>
          <Link className={authStyles.primary} href="/tus/prestador">
            Ir a mi panel de prestador
          </Link>
        </div>
      </div>
    )

  return (
    <form className={authStyles.form} noValidate onSubmit={(event) => void save(event)}>
      {/* The photo belongs to a saved profile: it appears once the profile exists. */}
      {publicId ? (
        <ProfilePhoto initials={photo.initials} onChange={(url) => setPhoto((current) => ({ ...current, url }))} photoUrl={photo.url} session={session.session} visible={values.visible} />
      ) : null}
      <p className={authStyles.notice}>
        Esto es lo que ven los clientes en “Buscar trabajador”. No publiques teléfono, email ni dirección: solo zonas aproximadas. La verificación,
        los trabajos realizados y tus horarios los calcula TUS.
      </p>
      {derivedName ? (
        <div className={authStyles.field} data-nombre-derivado>
          <span>Nombre público</span>
          <p style={{ fontWeight: 600, margin: '4px 0', overflowWrap: 'anywhere' }}>{derivedName}</p>
          <p className={authStyles.notice} style={{ margin: 0 }}>Es tu nombre completo, tomado de tus datos personales. Si trabajás como empresa y querés mostrar un nombre comercial, escribinos desde Ayuda.</p>
        </div>
      ) : (
        <TextField
          error={error('displayName')}
          id="perfil-nombre"
          label="Nombre público"
          maxLength={60}
          onChange={(event) => setValues((current) => ({ ...current, displayName: event.target.value }))}
          value={values.displayName}
        />
      )}
      <fieldset className={authStyles.field}>
        <legend>Servicios que ofrecés</legend>
        <ServicePicker
          categories={catalog.categories ?? []}
          idPrefix="perfil-servicio"
          onChange={(professions) => setValues((current) => ({ ...current, professions }))}
          services={catalog.items}
          value={values.professions}
        />
        <FieldError id="perfil-oficio-error" message={error('profession')} />
      </fieldset>
      <div className={authStyles.row2}>
        <div className={authStyles.field}>
          <label htmlFor="perfil-barrio">Zona principal (opcional)</label>
          <select className={authStyles.input} id="perfil-barrio" onChange={(event) => setValues((current) => ({ ...current, zone: event.target.value }))} value={values.zone}>
            <option value="">Usar fallback si existe</option>
            {catalog.zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <FieldError id="perfil-barrio-error" message={error('zone')} />
        </div>
      </div>
      <fieldset className={authStyles.field}>
        <legend>Zonas donde prestás servicio (opcional)</legend>
        <p className={styles.muted} style={{ fontSize: '0.9rem', margin: 0 }}>Podés elegir varias. Si no elegís ninguna, usamos una zona aproximada de tu identidad verificada cuando esté disponible.</p>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 8 }}>
          {catalog.zones.map((zone) => (
            <label className={authStyles.checkbox} key={zone}>
              <input
                checked={values.serviceZones.includes(zone)}
                onChange={(event) => setValues((current) => ({ ...current, serviceZones: event.target.checked ? [...new Set([...current.serviceZones, zone])] : current.serviceZones.filter((item) => item !== zone) }))}
                type="checkbox"
              />
              <span>{zone}</span>
            </label>
          ))}
        </div>
        <FieldError id="perfil-zonas-error" message={error('serviceZones')} />
      </fieldset>
      <div className={authStyles.row2}>
        <div className={authStyles.field}>
          <label htmlFor="perfil-modalidad">Modalidad de atención</label>
          <select className={authStyles.input} id="perfil-modalidad" onChange={(event) => setValues((current) => ({ ...current, serviceMode: event.target.value as typeof current.serviceMode }))} value={values.serviceMode}>
            <option value="local">Atiendo en un lugar</option>
            <option value="domicilio">Voy a domicilio</option>
            <option value="mixto">Lugar y domicilio</option>
          </select>
          <FieldError id="perfil-modalidad-error" message={error('serviceMode')} />
        </div>
        <TextField
          error={error('coverageRadiusKm')}
          id="perfil-radio"
          inputMode="numeric"
          label="Radio de cobertura en km (opcional)"
          onChange={(event) => setValues((current) => ({ ...current, coverageRadiusKm: event.target.value }))}
          value={values.coverageRadiusKm}
        />
      </div>
      <p className={authStyles.notice}>
        {publicId && values.serviceZones.length === 0 && values.zone === ''
          ? 'Si tu identidad está verificada y tiene una zona válida, se mostrará una referencia aproximada. Tu dirección exacta nunca se publica.'
          : 'Usamos únicamente zonas aproximadas. Tu dirección exacta nunca se publica.'}
      </p>
      <div className={authStyles.field}>
        <label htmlFor="perfil-descripcion">Descripción (opcional)</label>
        <textarea
          className={authStyles.input}
          id="perfil-descripcion"
          maxLength={600}
          onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
          rows={4}
          value={values.description}
        />
        <FieldError id="perfil-descripcion-error" message={error('description')} />
      </div>
      <TextField
        error={error('yearsOfExperience')}
        id="perfil-experiencia"
        inputMode="numeric"
        label="Años de experiencia (opcional)"
        onChange={(event) => setValues((current) => ({ ...current, years: event.target.value }))}
        value={values.years}
      />
      <label className={authStyles.checkbox}>
        <input checked={values.visible} onChange={(event) => setValues((current) => ({ ...current, visible: event.target.checked }))} type="checkbox" />
        <span>Mostrar mi perfil en “Buscar trabajador”</span>
      </label>
      <FormError message={message} />
      {status === 'saved' ? (
        <p className={authStyles.success} role="status">
          Perfil guardado.{' '}
          {publicId && values.visible ? <Link href={`/trabajadores/${encodeURIComponent(publicId)}` as Route}>Ver cómo lo ven los clientes</Link> : null}
        </p>
      ) : null}
      <button className={authStyles.primary} disabled={status === 'saving'} type="submit">
        {status === 'saving' ? 'Guardando…' : 'Guardar perfil'}
      </button>
    </form>
  )
}
