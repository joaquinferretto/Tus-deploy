'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import type { TusWebSession } from '@/lib/tus-ui-contract'

import { FieldError, FormError, TextField } from '../auth/auth-fields'
import styles from '../auth/auth.module.css'
import { budgetLabel, timeAgoLabel, urgencyLabel } from '../home/requests-source'
import { CATEGORIES, CORRIENTES_ZONES, URGENCIES, categoryOf, type CategoryId, type UrgencyId } from '../home/types'
import { FIELD_MESSAGES, createRequestsClient, validateNewRequest, type OwnRequestDto, type RequestField } from './requests-client'

const RETURN_TO = '/publicar'

interface Draft {
  category: CategoryId | ''
  title: string
  description: string
  zone: string
  budget: string
  urgency: UrgencyId | ''
}

const EMPTY: Draft = { category: '', title: '', description: '', zone: '', budget: '', urgency: '' }

const RESULT_MESSAGES = {
  unauthorized: 'Tu sesión venció. Iniciá sesión de nuevo para publicar.',
  rate_limited: 'Llegaste al límite de solicitudes por hoy. Probá de nuevo mañana o cerrá alguna que ya no necesites.',
  not_allowed: 'Tu cuenta todavía no puede publicar solicitudes. Verificá tu correo e intentá de nuevo.',
  unavailable: 'No pudimos publicar la solicitud. Probá de nuevo en unos minutos.',
} as const

export function PublishRequest(): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<RequestField[]>([])
  const [formError, setFormError] = useState('')
  const [sending, setSending] = useState(false)
  const [published, setPublished] = useState<OwnRequestDto | null>(null)
  const [mine, setMine] = useState<OwnRequestDto[] | null>(null)

  // Publishing needs a TUS session: without one, go to sign-in and come back here.
  useEffect(() => {
    void createTusWebAuthClient()
      .restore(RETURN_TO)
      .then((result) => {
        if (result.status !== 'authenticated' || !result.session) {
          window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
          setSession(null)
          return
        }
        setSession(toTusWebSession(result.session))
      })
      .catch(() => setSession(null))
  }, [])

  useEffect(() => {
    if (!session) return
    createRequestsClient(session)
      .mine()
      .then(setMine)
      .catch(() => setMine([]))
  }, [session, published])

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => current.filter((field) => field !== (key === 'budget' ? 'budgetMax' : key)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!session || sending) return
    const budgetText = draft.budget.replace(/[.\s$]/gu, '')
    const input = {
      category: draft.category as CategoryId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      zone: draft.zone,
      budgetMax: budgetText ? Number(budgetText) : null,
      urgency: draft.urgency as UrgencyId,
    }
    const invalid = validateNewRequest(input)
    setErrors(invalid)
    setFormError('')
    if (invalid.length > 0) return
    setSending(true)
    const result = await createRequestsClient(session).publish(input)
    setSending(false)
    if (result.ok) {
      setPublished(result.request)
      setDraft(EMPTY)
      return
    }
    if (result.kind === 'invalid') setErrors(result.fields)
    else setFormError(RESULT_MESSAGES[result.kind])
  }

  async function close(id: string) {
    if (!session) return
    if (await createRequestsClient(session).close(id)) setMine((current) => (current ?? []).map((item) => (item.id === id ? { ...item, status: 'cerrada' } : item)))
  }

  const error = (field: RequestField) => (errors.includes(field) ? FIELD_MESSAGES[field] : undefined)

  if (session === undefined || session === null)
    return (
      <p aria-busy="true" className={styles.notice} role="status">
        Verificando tu sesión…
      </p>
    )

  return (
    <>
      {published ? (
        <div className={styles.success} role="status">
          ¡Listo! Tu solicitud ya aparece en el mapa. <Link href="/">Ver el mapa</Link>
        </div>
      ) : null}

      <form className={styles.form} noValidate onSubmit={submit}>
        <p className={styles.notice}>
          Tu solicitud es pública: no incluyas teléfono, email ni dirección. En el mapa solo se muestra tu barrio de forma
          aproximada y tu nombre con la inicial del apellido.
        </p>

        <div className={styles.field}>
          <label htmlFor="solicitud-categoria">Categoría</label>
          <select
            aria-describedby={error('category') ? 'solicitud-categoria-error' : undefined}
            aria-invalid={error('category') ? true : undefined}
            className={`${styles.input} ${error('category') ? styles.inputInvalid : ''}`}
            id="solicitud-categoria"
            onChange={(event) => update('category', event.target.value as CategoryId | '')}
            value={draft.category}
          >
            <option value="">Elegí una categoría</option>
            {CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <FieldError id="solicitud-categoria-error" message={error('category')} />
        </div>

        <TextField
          error={error('title')}
          id="solicitud-titulo"
          label="¿Qué necesitás?"
          maxLength={90}
          onChange={(event) => update('title', event.target.value)}
          placeholder="Ej. Pierde agua la canilla de la cocina"
          value={draft.title}
        />

        <div className={styles.field}>
          <label htmlFor="solicitud-descripcion">Detalles (opcional)</label>
          <textarea
            aria-describedby={`solicitud-descripcion-ayuda${error('description') ? ' solicitud-descripcion-error' : ''}`}
            aria-invalid={error('description') ? true : undefined}
            className={`${styles.input} ${error('description') ? styles.inputInvalid : ''}`}
            id="solicitud-descripcion"
            maxLength={500}
            onChange={(event) => update('description', event.target.value)}
            rows={4}
            value={draft.description}
          />
          <span className={styles.googleHint} id="solicitud-descripcion-ayuda">
            {draft.description.length}/500
          </span>
          <FieldError id="solicitud-descripcion-error" message={error('description')} />
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label htmlFor="solicitud-barrio">Barrio</label>
            <select
              aria-describedby={error('zone') ? 'solicitud-barrio-error' : undefined}
              aria-invalid={error('zone') ? true : undefined}
              className={`${styles.input} ${error('zone') ? styles.inputInvalid : ''}`}
              id="solicitud-barrio"
              onChange={(event) => update('zone', event.target.value)}
              value={draft.zone}
            >
              <option value="">Elegí tu barrio</option>
              {CORRIENTES_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <FieldError id="solicitud-barrio-error" message={error('zone')} />
          </div>

          <div className={styles.field}>
            <label htmlFor="solicitud-urgencia">Urgencia</label>
            <select
              aria-describedby={error('urgency') ? 'solicitud-urgencia-error' : undefined}
              aria-invalid={error('urgency') ? true : undefined}
              className={`${styles.input} ${error('urgency') ? styles.inputInvalid : ''}`}
              id="solicitud-urgencia"
              onChange={(event) => update('urgency', event.target.value as UrgencyId | '')}
              value={draft.urgency}
            >
              <option value="">Elegí la urgencia</option>
              {URGENCIES.map((urgency) => (
                <option key={urgency.id} value={urgency.id}>
                  {urgency.label}
                </option>
              ))}
            </select>
            <FieldError id="solicitud-urgencia-error" message={error('urgency')} />
          </div>
        </div>

        <TextField
          error={error('budgetMax')}
          id="solicitud-presupuesto"
          inputMode="numeric"
          label="Presupuesto máximo en pesos (opcional)"
          onChange={(event) => update('budget', event.target.value)}
          placeholder="Ej. 25000 — vacío = a convenir"
          value={draft.budget}
        />

        <FormError message={formError} />
        <button className={styles.primary} disabled={sending} type="submit">
          {sending ? 'Publicando…' : 'Publicar solicitud'}
        </button>
      </form>

      <section aria-labelledby="mis-solicitudes" style={{ marginTop: 32 }}>
        <h2 className={styles.legend} id="mis-solicitudes" style={{ fontSize: '1.05rem' }}>
          Mis solicitudes
        </h2>
        {mine === null ? (
          <p className={styles.footerText} role="status">
            Cargando…
          </p>
        ) : mine.length === 0 ? (
          <p className={styles.footerText}>Todavía no publicaste solicitudes.</p>
        ) : (
          <ul style={{ display: 'grid', gap: 10, listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {mine.map((item) => (
              <li className={styles.notice} key={item.id} style={{ display: 'grid', gap: 4 }}>
                <strong>{item.title}</strong>
                <span>
                  {categoryOf(item.category).label} · {item.approximateLocation.label} · {budgetLabel(item.budgetMax)} ·{' '}
                  {urgencyLabel(item.urgency)} · {timeAgoLabel(item.createdAt)}
                </span>
                {item.status === 'abierta' ? (
                  <button className={styles.link} onClick={() => void close(item.id)} style={{ justifySelf: 'start' }} type="button">
                    Cerrar solicitud
                  </button>
                ) : (
                  <span>Cerrada</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
