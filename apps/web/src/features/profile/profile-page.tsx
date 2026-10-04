'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  ETIQUETA_TIPO_DOCUMENTO,
  TIPOS_DOCUMENTO,
  validarPerfilPersonal,
  type ErroresPerfil,
  type LocalidadDTO,
  type PaisDTO,
  type PerfilPersonalDTO,
  type ProvinciaDTO,
  type TipoDocumento,
} from '@factory/contracts'

import { refreshAccountView, useAccountView } from '../session/use-account-view'
import { useTusSession } from '../session/use-tus-session'
import { createTusWebAuthClient, exemptFromProfile, sanitizeTusReturnTo } from '../../lib/tus-auth-client'
import { PhoneSection } from './phone-section'
import { createGeographyClient, createProfileClient } from './profile-client'
import styles from './profile.module.css'

const RETURN_TO = '/mi-perfil'

interface Form {
  nombre: string
  apellido: string
  tipoDocumento: TipoDocumento
  numeroDocumento: string
  paisId: string
  provinciaId: string
  localidadId: string
  calle: string
  numero: string
  pisoDepto: string
  codigoPostal: string
}

const EMPTY: Form = { nombre: '', apellido: '', tipoDocumento: 'DNI', numeroDocumento: '', paisId: '', provinciaId: '', localidadId: '', calle: '', numero: '', pisoDepto: '', codigoPostal: '' }

// The registration name is offered as a starting point for first and last name; the person
// confirms or corrects it before anything is saved.
function fromProfile(perfil: PerfilPersonalDTO): Form {
  const [first = '', ...rest] = perfil.nombreVisible.trim().split(/\s+/u)
  return {
    nombre: perfil.nombre ?? first,
    apellido: perfil.apellido ?? rest.join(' '),
    tipoDocumento: perfil.tipoDocumento ?? 'DNI',
    numeroDocumento: perfil.numeroDocumento ?? '',
    paisId: perfil.ubicacion?.paisId ?? '',
    provinciaId: perfil.ubicacion?.provinciaId ?? '',
    localidadId: perfil.ubicacion?.localidadId ?? '',
    calle: perfil.residencia?.calle ?? '',
    numero: perfil.residencia?.numero ?? '',
    pisoDepto: perfil.residencia?.pisoDepto ?? '',
    codigoPostal: perfil.residencia?.codigoPostal ?? '',
  }
}

// "Mi perfil": the PERSONAL data of the account (identity and residence, private) and, apart, the
// way into the professional profile. When the profile was required to continue somewhere
// (?returnTo=), saving a complete profile goes back there.
export function ProfilePage(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const role = useAccountView()
  const geography = useMemo(() => createGeographyClient(), [])
  const [perfil, setPerfil] = useState<PerfilPersonalDTO | null>(null)
  const [failed, setFailed] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<ErroresPerfil>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [countries, setCountries] = useState<PaisDTO[]>([])
  const [provinces, setProvinces] = useState<ProvinciaDTO[]>([])
  const [localities, setLocalities] = useState<LocalidadDTO[]>([])
  const [returnTo, setReturnTo] = useState('')

  useEffect(() => {
    const requested = sanitizeTusReturnTo(new URLSearchParams(window.location.search).get('returnTo') ?? undefined, '')
    setReturnTo(requested && !exemptFromProfile(requested) ? requested : '')
  }, [])

  useEffect(() => {
    if (session.status === 'guest') {
      // Only the fixed action is carried through sign-in: never a value taken from the URL.
      const vincular = new URLSearchParams(window.location.search).get('accion') === 'vincular-whatsapp'
      window.location.replace(`/sign-in?returnTo=${encodeURIComponent(vincular ? `${RETURN_TO}?accion=vincular-whatsapp` : RETURN_TO)}`)
    }
    if (session.status !== 'authenticated') return
    createProfileClient(session.session)
      .profile()
      .then((result) => {
        setPerfil(result)
        setForm(fromProfile(result))
      })
      .catch(() => setFailed(true))
  }, [session])

  // Dependent selectors: each level is loaded from the API when its parent changes.
  useEffect(() => {
    void geography
      .countries()
      .then(setCountries)
      .catch(() => setCountries([]))
  }, [geography])

  // One country in the catalog: it is the choice (whichever of profile and catalog loads last).
  const onlyCountry = countries.length === 1 ? countries[0]!.id : ''
  useEffect(() => {
    if (onlyCountry && perfil && !form.paisId) setForm((current) => (current.paisId ? current : { ...current, paisId: onlyCountry }))
  }, [onlyCountry, perfil, form.paisId])

  useEffect(() => {
    if (!form.paisId) return setProvinces([])
    let cancelled = false
    void geography
      .provinces(form.paisId)
      .then((items) => {
        if (!cancelled) setProvinces(items)
      })
      .catch(() => {
        if (!cancelled) setProvinces([])
      })
    return () => {
      cancelled = true
    }
  }, [geography, form.paisId])

  useEffect(() => {
    if (!form.provinciaId) return setLocalities([])
    let cancelled = false
    void geography
      .localities(form.provinciaId)
      .then((items) => {
        if (!cancelled) setLocalities(items)
      })
      .catch(() => {
        if (!cancelled) setLocalities([])
      })
    return () => {
      cancelled = true
    }
  }, [geography, form.provinciaId])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setNotice(null)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (session.status !== 'authenticated') return
    // Same validation as the API (shared contract); the API repeats it and is the authority.
    const validated = validarPerfilPersonal({ ...form })
    if (!validated.ok) {
      setErrors(validated.errores)
      setNotice({ kind: 'error', text: 'Revisá los campos marcados.' })
      return
    }
    setErrors({})
    setSaving(true)
    const result = await createProfileClient(session.session).saveProfile(validated.valor)
    setSaving(false)
    if (!result.ok) {
      if (result.code === 'INVALID_PROFILE') {
        setErrors(result.errores)
        setNotice({ kind: 'error', text: 'Revisá los campos marcados.' })
      } else if (result.code === 'DOCUMENT_ALREADY_REGISTERED') {
        setErrors({ numeroDocumento: 'Ese documento ya está registrado en otra cuenta.' })
        setNotice({ kind: 'error', text: 'No pudimos guardar: el documento ya está registrado en otra cuenta.' })
      } else setNotice({ kind: 'error', text: 'No pudimos guardar tus datos. Probá de nuevo en unos minutos.' })
      return
    }
    setPerfil(result.perfil)
    setForm(fromProfile(result.perfil))
    // Header, onboarding and map centre read the capabilities: refreshed without reloading.
    await refreshAccountView()
    if (returnTo) {
      window.location.assign(returnTo)
      return
    }
    setNotice({ kind: 'ok', text: 'Guardamos tus datos.' })
  }

  async function signOut() {
    await createTusWebAuthClient()
      .signOut()
      .catch(() => undefined)
    window.location.assign('/')
  }

  if (failed || session.status === 'unavailable')
    return (
      <div className={styles.page}>
        <p className={styles.alertError} role="alert">
          No pudimos cargar tu perfil. Probá de nuevo en unos minutos.
        </p>
        <button className={styles.buttonSecondary} onClick={() => void signOut()} type="button">
          Cerrar sesión
        </button>
      </div>
    )
  if (!perfil)
    return (
      <div className={styles.page}>
        <p aria-busy="true" className={styles.muted} role="status">
          Cargando tu perfil…
        </p>
      </div>
    )

  const field = (id: keyof ErroresPerfil) => ({ 'aria-invalid': errors[id] ? true : undefined, 'aria-describedby': errors[id] ? `perfil-${id}-error` : undefined })
  const error = (id: keyof ErroresPerfil) =>
    errors[id] ? (
      <span className={styles.fieldError} id={`perfil-${id}-error`} role="alert">
        {errors[id]}
      </span>
    ) : null

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>Mi perfil</h1>
        <span className={perfil.perfilCompleto ? styles.badgeOk : styles.badgeWarn}>{perfil.perfilCompleto ? 'Perfil completo' : 'Perfil incompleto'}</span>
      </header>
      <p className={styles.lead}>Tus datos personales son privados: no se muestran a otros usuarios ni en tu perfil profesional.</p>

      {!perfil.perfilCompleto ? (
        <p className={styles.alertWarn} role="status">
          Completá tus datos personales y tu domicilio para seguir usando TUS.{returnTo ? ' Cuando guardes, volvés a donde estabas.' : ''}
        </p>
      ) : null}

      <form className={styles.form} noValidate onSubmit={(event) => void save(event)}>
        <section aria-labelledby="perfil-datos" className={styles.card}>
          <h2 id="perfil-datos">Datos personales</h2>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>Nombre</span>
              <input autoComplete="given-name" maxLength={60} onChange={(event) => set('nombre', event.target.value)} value={form.nombre} {...field('nombre')} />
              {error('nombre')}
            </label>
            <label className={styles.field}>
              <span>Apellido</span>
              <input autoComplete="family-name" maxLength={60} onChange={(event) => set('apellido', event.target.value)} value={form.apellido} {...field('apellido')} />
              {error('apellido')}
            </label>
            <label className={styles.field}>
              <span>Tipo de documento</span>
              <select onChange={(event) => set('tipoDocumento', event.target.value as TipoDocumento)} value={form.tipoDocumento} {...field('tipoDocumento')}>
                {TIPOS_DOCUMENTO.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ETIQUETA_TIPO_DOCUMENTO[tipo]}
                  </option>
                ))}
              </select>
              {error('tipoDocumento')}
            </label>
            <label className={styles.field}>
              <span>Número de documento</span>
              <input
                autoComplete="off"
                inputMode={form.tipoDocumento === 'PASAPORTE' ? 'text' : 'numeric'}
                maxLength={14}
                onChange={(event) => set('numeroDocumento', event.target.value)}
                placeholder={form.tipoDocumento === 'PASAPORTE' ? 'AAA123456' : '12.345.678'}
                value={form.numeroDocumento}
                {...field('numeroDocumento')}
              />
              {error('numeroDocumento')}
            </label>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Email</dt>
              <dd>
                {perfil.email} <span className={perfil.emailVerificado ? styles.badgeOk : styles.badgeWarn}>{perfil.emailVerificado ? 'Verificado' : 'Sin verificar'}</span>
              </dd>
            </div>
            <div>
              <dt>Celular</dt>
              <dd>
                {perfil.telefono.numero ?? perfil.telefono.pendiente ?? 'Sin cargar'}{' '}
                <span className={perfil.telefono.verificado ? styles.badgeOk : styles.badgeWarn}>{perfil.telefono.verificado ? 'Verificado' : perfil.telefono.pendiente ? 'Pendiente de verificar' : 'Sin verificar'}</span>
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="perfil-residencia" className={styles.card}>
          <h2 id="perfil-residencia">Residencia</h2>
          <p className={styles.muted}>Usamos tu localidad para centrar el mapa donde vivís. Tu domicilio exacto nunca se publica.</p>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span>País</span>
              <select onChange={(event) => setForm((current) => ({ ...current, paisId: event.target.value, provinciaId: '', localidadId: '' }))} value={form.paisId}>
                <option value="">Elegí un país</option>
                {countries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Provincia</span>
              <select disabled={!form.paisId} onChange={(event) => setForm((current) => ({ ...current, provinciaId: event.target.value, localidadId: '' }))} value={form.provinciaId}>
                <option value="">{form.paisId ? 'Elegí una provincia' : 'Primero elegí el país'}</option>
                {provinces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Localidad</span>
              <select disabled={!form.provinciaId} onChange={(event) => set('localidadId', event.target.value)} value={form.localidadId} {...field('localidadId')}>
                <option value="">{form.provinciaId ? 'Elegí una localidad' : 'Primero elegí la provincia'}</option>
                {localities.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
              {error('localidadId')}
            </label>
            <label className={styles.field}>
              <span>Código postal</span>
              <input autoComplete="postal-code" maxLength={8} onChange={(event) => set('codigoPostal', event.target.value)} placeholder="3400" value={form.codigoPostal} {...field('codigoPostal')} />
              {error('codigoPostal')}
            </label>
            <label className={`${styles.field} ${styles.wide}`}>
              <span>Calle</span>
              <input autoComplete="address-line1" maxLength={120} onChange={(event) => set('calle', event.target.value)} value={form.calle} {...field('calle')} />
              {error('calle')}
            </label>
            <label className={styles.field}>
              <span>Número</span>
              <input autoComplete="off" maxLength={7} onChange={(event) => set('numero', event.target.value)} placeholder="1234 o S/N" value={form.numero} {...field('numero')} />
              {error('numero')}
            </label>
            <label className={styles.field}>
              <span>
                Piso / departamento <small>(opcional)</small>
              </span>
              <input autoComplete="address-line2" maxLength={30} onChange={(event) => set('pisoDepto', event.target.value)} placeholder="2° B" value={form.pisoDepto} {...field('pisoDepto')} />
              {error('pisoDepto')}
            </label>
          </div>
        </section>

        {notice ? (
          <p className={notice.kind === 'ok' ? styles.alertOk : styles.alertError} role={notice.kind === 'ok' ? 'status' : 'alert'}>
            {notice.text}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button className={styles.buttonPrimary} disabled={saving} type="submit">
            {saving ? 'Guardando…' : returnTo && !perfil.perfilCompleto ? 'Guardar y continuar' : 'Guardar'}
          </button>
        </div>
      </form>

      <PhoneSection />

      {role.status === 'signed-in' ? (
        <section aria-labelledby="perfil-profesional" className={styles.card}>
          <h2 id="perfil-profesional">{role.capabilities.platformAdmin && !role.capabilities.provider ? 'Administración' : 'Perfil profesional'}</h2>
          {role.capabilities.platformAdmin ? (
            <div className={styles.actions}>
              <a className={styles.buttonSecondary} href="/tus/admin">
                Ir al panel administrativo
              </a>
            </div>
          ) : null}
          {role.capabilities.provider ? (
            <>
              <p className={styles.muted}>Tu perfil profesional es lo que ven los clientes: oficio, zona de trabajo y servicios. Es independiente de tus datos personales.</p>
              <div className={styles.actions}>
                <a className={styles.buttonSecondary} href="/prestador/perfil-publico">
                  Editar perfil profesional
                </a>
                <a className={styles.buttonSecondary} href="/prestador/solicitudes">
                  Solicitudes y postulaciones
                </a>
              </div>
            </>
          ) : !role.capabilities.platformAdmin ? (
            <>
              <p className={styles.muted}>¿Ofrecés servicios? Creá tu perfil profesional: es independiente de tus datos personales.</p>
              <div className={styles.actions}>
                <a className={styles.buttonSecondary} href="/prestador/perfil-publico">
                  Crear perfil profesional
                </a>
                <a className={styles.buttonSecondary} href="/mis-solicitudes">
                  Mis solicitudes
                </a>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <div className={styles.actions}>
        <button className={styles.buttonSecondary} onClick={() => void signOut()} type="button">
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
