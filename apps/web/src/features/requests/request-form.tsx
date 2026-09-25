'use client'

import { useEffect, useState } from 'react'

import type { TusWebSession } from '../../lib/tus-ui-contract'
import { FieldError, FormError, TextField } from '../auth/auth-fields'
import styles from '../auth/auth.module.css'
import { CATEGORIES, CORRIENTES_ZONES, URGENCIES, categoryOf, type CategoryId, type UrgencyId } from '../home/types'
import { FIELD_MESSAGES, createRequestsClient, validateNewRequest, type NewRequestInput, type OwnRequestDto, type RequestField } from './requests-client'

export interface RequestDraft {
  category: CategoryId | ''
  title: string
  description: string
  zone: string
  budget: string
  urgency: UrgencyId | ''
}

export const EMPTY_DRAFT: RequestDraft = { category: '', title: '', description: '', zone: '', budget: '', urgency: '' }

const RESULT_MESSAGES = {
  unauthorized: 'Tu sesión venció. Iniciá sesión de nuevo para continuar.',
  rate_limited: 'Llegaste al límite de solicitudes por hoy. Probá de nuevo mañana o cerrá alguna que ya no necesites.',
  not_allowed: 'Tu cuenta todavía no puede enviar solicitudes. Verificá tu correo e intentá de nuevo.',
  unavailable: 'No pudimos enviar la solicitud. Probá de nuevo en unos minutos.',
  provider_unavailable: 'Este profesional no está disponible en este momento. Probá con otro.',
  self_request: 'No podés enviarte una solicitud a vos mismo.',
} as const

const MAX_IMAGES = 2
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// One form for every way of creating the TUS service request: public (map), directed from a
// worker profile, or directed from the assistant. The API decides account, name and location.
export function RequestForm({
  session,
  initial = EMPTY_DRAFT,
  lockedCategory,
  provider,
  origin,
  submitLabel,
  onSent,
}: {
  session: TusWebSession
  initial?: RequestDraft
  lockedCategory?: CategoryId
  provider?: { id: string; displayName: string }
  origin: NonNullable<NewRequestInput['origin']>
  submitLabel: string
  onSent: (request: OwnRequestDto, warning: string | null) => void
}): React.ReactNode {
  const [draft, setDraft] = useState<RequestDraft>({ ...initial, ...(lockedCategory ? { category: lockedCategory } : {}) })
  const [images, setImages] = useState<{ file: File; url: string }[]>([])
  const [imageError, setImageError] = useState('')
  const [errors, setErrors] = useState<RequestField[]>([])
  const [formError, setFormError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => () => images.forEach((image) => URL.revokeObjectURL(image.url)), [images])

  function update<K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => current.filter((field) => field !== (key === 'budget' ? 'budgetMax' : key)))
  }

  function addImages(list: FileList | null) {
    setImageError('')
    const files = [...(list ?? [])]
    const accepted: { file: File; url: string }[] = []
    for (const file of files) {
      if (images.length + accepted.length >= MAX_IMAGES) {
        setImageError('Podés adjuntar hasta 2 fotos.')
        break
      }
      if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) {
        setImageError('Usá fotos JPG, PNG o WEBP de hasta 3 MB.')
        continue
      }
      accepted.push({ file, url: URL.createObjectURL(file) })
    }
    setImages((current) => [...current, ...accepted])
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, position) => position !== index))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (sending) return
    const budgetText = draft.budget.replace(/[.\s$]/gu, '')
    const input: NewRequestInput = {
      category: draft.category as CategoryId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      zone: draft.zone,
      budgetMax: budgetText ? Number(budgetText) : null,
      urgency: draft.urgency as UrgencyId,
      origin,
      ...(provider ? { providerId: provider.id } : {}),
    }
    const invalid = validateNewRequest(input)
    setErrors(invalid)
    setFormError('')
    if (invalid.length > 0) return
    setSending(true)
    const client = createRequestsClient(session)
    const result = await client.publish(input)
    if (!result.ok) {
      setSending(false)
      if (result.kind === 'invalid') setErrors(result.fields)
      else setFormError(RESULT_MESSAGES[result.kind])
      return
    }
    let failed = 0
    for (const image of images) if (!(await client.uploadImage(result.request.id, image.file)).ok) failed += 1
    setSending(false)
    onSent(result.request, failed > 0 ? `La solicitud se envió, pero ${failed === 1 ? 'una foto no se pudo subir' : 'las fotos no se pudieron subir'}.` : null)
  }

  const error = (field: RequestField) => (errors.includes(field) ? FIELD_MESSAGES[field] : undefined)
  const selectProps = (field: RequestField, id: string) => ({
    'aria-describedby': error(field) ? `${id}-error` : undefined,
    'aria-invalid': error(field) ? true : undefined,
    className: `${styles.input} ${error(field) ? styles.inputInvalid : ''}`,
    id,
  })

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
      <p className={styles.notice}>
        {provider
          ? `Tu solicitud le llega solo a ${provider.displayName}. Queda pendiente hasta que la acepte.`
          : 'Tu solicitud es pública: aparece en el mapa con tu barrio aproximado y tu nombre con la inicial del apellido.'}{' '}
        No incluyas teléfono, email ni dirección.
      </p>

      {lockedCategory ? (
        <p className={styles.footerText} style={{ textAlign: 'left', margin: 0 }}>
          Oficio: <strong>{categoryOf(lockedCategory).label}</strong>
        </p>
      ) : (
        <div className={styles.field}>
          <label htmlFor="solicitud-categoria">Categoría</label>
          <select {...selectProps('category', 'solicitud-categoria')} onChange={(event) => update('category', event.target.value as CategoryId | '')} value={draft.category}>
            <option value="">Elegí una categoría</option>
            {CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <FieldError id="solicitud-categoria-error" message={error('category')} />
        </div>
      )}

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
        <span className={styles.counter} id="solicitud-descripcion-ayuda">
          {draft.description.length}/500
        </span>
        <FieldError id="solicitud-descripcion-error" message={error('description')} />
      </div>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label htmlFor="solicitud-barrio">Barrio</label>
          <select {...selectProps('zone', 'solicitud-barrio')} onChange={(event) => update('zone', event.target.value)} value={draft.zone}>
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
          <select {...selectProps('urgency', 'solicitud-urgencia')} onChange={(event) => update('urgency', event.target.value as UrgencyId | '')} value={draft.urgency}>
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

      <div className={styles.field}>
        <span className={styles.legend}>Fotos (opcional, hasta 2)</span>
        <div className={styles.filePicker}>
          <input
            accept={IMAGE_TYPES.join(',')}
            aria-describedby={imageError ? 'solicitud-fotos-error' : 'solicitud-fotos-ayuda'}
            className={styles.fileInput}
            disabled={images.length >= MAX_IMAGES}
            id="solicitud-fotos"
            multiple
            onChange={(event) => {
              addImages(event.target.files)
              event.target.value = ''
            }}
            type="file"
          />
          <label className={styles.fileButton} htmlFor="solicitud-fotos">
            {images.length >= MAX_IMAGES ? 'Ya agregaste 2 fotos' : images.length === 1 ? 'Agregar otra foto' : 'Agregar fotos'}
          </label>
        </div>
        <span className={styles.counter} id="solicitud-fotos-ayuda" style={{ textAlign: 'left' }}>
          JPG, PNG o WEBP de hasta 3 MB. Borramos la ubicación y los datos de la cámara.
        </span>
        {images.length > 0 ? (
          <ul style={{ display: 'flex', gap: 10, listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
            {images.map((image, index) => (
              <li key={image.url} style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) */}
                <img alt={`Foto ${index + 1} adjunta`} height={72} src={image.url} style={{ borderRadius: 10, objectFit: 'cover' }} width={72} />
                <button className={styles.link} onClick={() => removeImage(index)} type="button">
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <FieldError id="solicitud-fotos-error" message={imageError || undefined} />
      </div>

      <FormError message={formError} />
      <button className={styles.primary} disabled={sending} type="submit">
        {sending ? 'Enviando…' : submitLabel}
      </button>
    </form>
  )
}
