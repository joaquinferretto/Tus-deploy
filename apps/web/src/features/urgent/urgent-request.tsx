'use client'

import { useCallback, useEffect, useState } from 'react'

import { FieldError, FormError, TextField } from '../auth/auth-fields'
import styles from '../auth/auth.module.css'
import { neighbourhoodGroups, useCatalog } from '../catalog/use-catalog'
import { useTusSession } from '../session/use-tus-session'
import { URGENT_STATUS_LABEL, createUrgentClient, type OwnUrgentRequest, type UrgentField } from './urgent-client'

const RETURN_TO = '/urgente'

const FIELD_MESSAGES: Record<UrgentField, string> = {
  category: 'Elegí el servicio que necesitás.',
  description: 'Contá qué pasó en 5 a 300 caracteres, sin teléfonos ni links.',
  address: 'Escribí la calle y el número (5 a 160 caracteres).',
  zone: 'Elegí el barrio.',
}

const RESULT_MESSAGES = {
  already_open: 'Ya tenés un pedido urgente en curso. Esperá a que un prestador lo tome o a que venza antes de pedir otro.',
  rate_limited: 'Llegaste al límite de pedidos por hoy. Probá de nuevo mañana.',
  not_allowed: 'Tu cuenta todavía no puede enviar pedidos. Verificá tu correo o tu celular e intentá de nuevo.',
  unauthorized: 'Tu sesión venció. Iniciá sesión de nuevo para continuar.',
  unavailable: 'No pudimos enviar el pedido. Probá de nuevo en unos minutos.',
} as const

// SERVICIO-URGENTE-01. The client asks for an urgent service: TUS offers it at once to every
// compatible provider and the first that accepts is assigned. Unlike a normal request, the
// address travels to those providers (they need it to decide), and the client is told so here.
export function UrgentRequest(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const catalog = useCatalog()
  const [draft, setDraft] = useState({ category: '', description: '', address: '', zone: '' })
  const [errors, setErrors] = useState<UrgentField[]>([])
  const [formError, setFormError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [items, setItems] = useState<OwnUrgentRequest[] | null>(null)

  useEffect(() => {
    if (session.status === 'guest') window.location.replace(`/sign-in?returnTo=${encodeURIComponent(RETURN_TO)}`)
  }, [session.status])

  const load = useCallback(async () => {
    if (session.status !== 'authenticated') return
    setItems(await createUrgentClient(session.session).mine().catch(() => []))
  }, [session])

  // While one is waiting, its real state is read again: the list is the notice on the Web.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  if (session.status !== 'authenticated')
    return (
      <p aria-busy="true" className={styles.notice} role="status">
        {session.status === 'unavailable' ? 'No pudimos conectar con TUS. Probá de nuevo en unos minutos.' : 'Verificando tu sesión…'}
      </p>
    )

  const update = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => current.filter((field) => field !== key))
  }
  const error = (field: UrgentField) => (errors.includes(field) ? FIELD_MESSAGES[field] : undefined)
  const selectProps = (field: UrgentField, id: string) => ({
    'aria-describedby': error(field) ? `${id}-error` : undefined,
    'aria-invalid': error(field) ? true : undefined,
    className: `${styles.input} ${error(field) ? styles.inputInvalid : ''}`,
    id,
  })

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (sending || session.status !== 'authenticated') return
    const input = { category: draft.category, description: draft.description.trim(), address: draft.address.trim(), zone: draft.zone }
    const invalid: UrgentField[] = [
      ...(input.category ? [] : (['category'] as const)),
      ...(input.description.length >= 5 && input.description.length <= 300 ? [] : (['description'] as const)),
      ...(input.address.length >= 5 && input.address.length <= 160 ? [] : (['address'] as const)),
      ...(input.zone ? [] : (['zone'] as const)),
    ]
    setErrors(invalid)
    setFormError('')
    setSent(null)
    if (invalid.length > 0) return
    setSending(true)
    const result = await createUrgentClient(session.session).create(input)
    setSending(false)
    if (!result.ok) {
      if (result.kind === 'invalid') setErrors(result.fields)
      else setFormError(RESULT_MESSAGES[result.kind])
      return
    }
    setSent(result.request.message ?? 'Enviamos tu pedido urgente.')
    setDraft({ category: '', description: '', address: '', zone: '' })
    void load()
  }

  const abierta = (items ?? []).some((item) => item.status === 'pendiente')

  return (
    <>
      {sent ? (
        <div className={styles.success} data-urgente-enviado role="status">
          {sent}
        </div>
      ) : null}

      <form className={styles.form} data-urgente-form noValidate onSubmit={(event) => void submit(event)}>
        <p className={styles.notice}>
          Un servicio urgente se ofrece <strong>al mismo tiempo a todos los prestadores compatibles</strong> y el primero que acepta queda asignado. Para que puedan decidir, van a ver{' '}
          <strong>tu dirección y tu barrio</strong>. Si preferís comparar y elegir vos, usá <a href="/buscar-trabajador">Buscar trabajador</a>.
        </p>

        <div className={styles.field}>
          <label htmlFor="urgente-servicio">Servicio</label>
          <select {...selectProps('category', 'urgente-servicio')} onChange={(event) => update('category', event.target.value)} value={draft.category}>
            <option value="">{catalog.isPending ? 'Cargando servicios…' : catalog.isError ? 'No pudimos cargar los servicios' : 'Elegí un servicio'}</option>
            {(catalog.data?.items ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <FieldError id="urgente-servicio-error" message={error('category')} />
        </div>

        <TextField error={error('address')} id="urgente-direccion" label="Dirección (calle y número)" maxLength={160} onChange={(event) => update('address', event.target.value)} placeholder="Ej. Av. 3 de Abril 1850" value={draft.address} />

        <div className={styles.field}>
          <label htmlFor="urgente-barrio">Barrio</label>
          <select {...selectProps('zone', 'urgente-barrio')} onChange={(event) => update('zone', event.target.value)} value={draft.zone}>
            <option value="">{catalog.isPending ? 'Cargando barrios…' : catalog.isError ? 'No pudimos cargar los barrios' : 'Elegí tu barrio'}</option>
            {neighbourhoodGroups(catalog.data).map((group) =>
              group.label ? (
                <optgroup key={group.label} label={group.label}>
                  {group.names.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </optgroup>
              ) : (
                group.names.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))
              )
            )}
          </select>
          <FieldError id="urgente-barrio-error" message={error('zone')} />
        </div>

        <div className={styles.field}>
          <label htmlFor="urgente-motivo">¿Qué pasó?</label>
          <textarea
            aria-describedby={error('description') ? 'urgente-motivo-error' : undefined}
            aria-invalid={error('description') ? true : undefined}
            className={`${styles.input} ${error('description') ? styles.inputInvalid : ''}`}
            id="urgente-motivo"
            maxLength={300}
            onChange={(event) => update('description', event.target.value)}
            placeholder="Ej. Se cortó toda la luz y está saltando la térmica"
            rows={3}
            value={draft.description}
          />
          <FieldError id="urgente-motivo-error" message={error('description')} />
        </div>

        <FormError message={formError} />
        <button className={styles.primary} disabled={sending || abierta} type="submit">
          {sending ? 'Enviando…' : abierta ? 'Ya tenés un pedido urgente en curso' : 'Pedir servicio urgente'}
        </button>
      </form>

      <section aria-labelledby="mis-urgentes" style={{ marginTop: 32 }}>
        <h2 className={styles.legend} id="mis-urgentes" style={{ fontSize: '1.05rem' }}>
          Mis pedidos urgentes
        </h2>
        {items === null ? (
          <p aria-busy="true" className={styles.notice} role="status">Cargando…</p>
        ) : items.length === 0 ? (
          <p className={styles.footerText} style={{ textAlign: 'left' }}>Todavía no pediste ningún servicio urgente.</p>
        ) : (
          <ul data-urgentes-propios style={{ display: 'grid', gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((item) => (
              <li data-urgente-estado={item.status} key={item.id} style={{ border: '1px solid var(--tus-line, #e5e7eb)', borderRadius: 12, display: 'grid', gap: 4, padding: 12 }}>
                <strong>
                  {item.service} · {URGENT_STATUS_LABEL[item.status]}
                </strong>
                <span>
                  {item.address}, {item.zone}
                </span>
                {item.description ? <span className={styles.footerText} style={{ textAlign: 'left' }}>{item.description}</span> : null}
                <span className={styles.footerText} style={{ textAlign: 'left' }}>
                  {item.status === 'pendiente'
                    ? `Avisamos a ${item.notified === 1 ? '1 prestador' : `${item.notified} prestadores`}. El primero que acepte queda asignado.${item.reopenings > 0 ? ' El prestador anterior avisó que no podía asistir y la ofrecimos de nuevo.' : ''}`
                    : item.status === 'tomada' && item.provider
                      ? `${item.provider.name} aceptó y se pone en contacto para coordinar la llegada.`
                      : item.status === 'sin_candidatos'
                        ? 'No había prestadores de ese servicio disponibles para urgencias en tu barrio.'
                        : item.status === 'vencida'
                          ? 'Nadie llegó a tomarla a tiempo.'
                          : item.status === 'todos_rechazaron'
                            ? 'Ningún prestador pudo asistir.'
                            : ''}
                </span>
                {item.workId ? <a href={`/trabajos/${encodeURIComponent(item.workId)}`}>Ver el trabajo</a> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
