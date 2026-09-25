'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { OficioPublico } from '@factory/contracts'

import { FieldError, FormError, TextField } from '../auth/auth-fields'
import authStyles from '../auth/auth.module.css'
import { DirectoryRequestError, createDirectoryClient } from '../directory/directory-client'
import styles from '../directory/directory.module.css'
import { useTusSession } from '../session/use-tus-session'

const client = createDirectoryClient()
const RETURN_TO = '/prestador/perfil-publico'

const FIELD_MESSAGES: Record<string, string> = {
  displayName: 'Usá tu nombre o el de tu negocio (2 a 60 caracteres, sin teléfonos ni emails).',
  profession: 'Elegí tu oficio.',
  zone: 'Elegí el barrio donde trabajás.',
  description: 'Hasta 600 caracteres, sin teléfonos, emails ni links.',
  yearsOfExperience: 'Ingresá los años como número entero (0 a 70).',
}

// The provider chooses what the directory shows. Verification, completed jobs and hours are
// computed by TUS and cannot be edited here.
export function ProviderPublicProfile(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [catalog, setCatalog] = useState<{ items: OficioPublico[]; zones: string[] }>({ items: [], zones: [] })
  const [values, setValues] = useState({ displayName: '', profession: '', zone: '', description: '', years: '', visible: true })
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'not_provider' | 'error'>('loading')
  const [fields, setFields] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [publicId, setPublicId] = useState<string | null>(null)

  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
    if (session.status !== 'authenticated') return
    void Promise.all([client.catalog(), client.myProfile(session.session)])
      .then(([loadedCatalog, mine]) => {
        setCatalog(loadedCatalog)
        if (mine.profile) {
          setPublicId(mine.profile.id)
          setValues({
            displayName: mine.profile.displayName,
            profession: mine.profile.profession.id,
            zone: mine.profile.approximateArea,
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
      const result = await client.saveProfile(session.session, {
        displayName: values.displayName.trim(),
        profession: values.profession,
        zone: values.zone,
        description: values.description.trim(),
        yearsOfExperience: years,
        visible: values.visible,
      })
      setPublicId(result.profile.id)
      setStatus('saved')
    } catch (error) {
      if (error instanceof DirectoryRequestError && error.code === 'INVALID_PROFILE') setFields(error.fields)
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
      <p className={authStyles.notice}>
        Esto es lo que ven los clientes en “Buscar trabajador”. No publiques teléfono, email ni dirección: solo tu barrio. La verificación,
        los trabajos realizados y tus horarios los calcula TUS.
      </p>
      <TextField
        error={error('displayName')}
        id="perfil-nombre"
        label="Nombre público"
        maxLength={60}
        onChange={(event) => setValues((current) => ({ ...current, displayName: event.target.value }))}
        value={values.displayName}
      />
      <div className={authStyles.row2}>
        <div className={authStyles.field}>
          <label htmlFor="perfil-oficio">Oficio</label>
          <select className={authStyles.input} id="perfil-oficio" onChange={(event) => setValues((current) => ({ ...current, profession: event.target.value }))} value={values.profession}>
            <option value="">Elegí tu oficio</option>
            {catalog.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <FieldError id="perfil-oficio-error" message={error('profession')} />
        </div>
        <div className={authStyles.field}>
          <label htmlFor="perfil-barrio">Barrio donde trabajás</label>
          <select className={authStyles.input} id="perfil-barrio" onChange={(event) => setValues((current) => ({ ...current, zone: event.target.value }))} value={values.zone}>
            <option value="">Elegí un barrio</option>
            {catalog.zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <FieldError id="perfil-barrio-error" message={error('zone')} />
        </div>
      </div>
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
