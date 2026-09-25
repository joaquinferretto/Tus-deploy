'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import type { CandidatoPrestador, OficioPublico } from '@factory/contracts'

import { withReturnTo } from '../auth/auth-validation'
import { createDirectoryClient } from '../directory/directory-client'
import styles from '../directory/directory.module.css'
import { WorkerCard } from '../directory/worker-card'
import homeStyles from '../home/home.module.css'
import { CORRIENTES_ZONES, URGENCIES, type CategoryId, type UrgencyId } from '../home/types'
import { RequestForm } from '../requests/request-form'
import { useTusSession } from '../session/use-tus-session'

const client = createDirectoryClient()
const RETURN_TO = '/asistente'
const STORAGE_KEY = 'tus.asistente.v1'

type Step = 'describe' | 'profession' | 'auth' | 'zone' | 'urgency' | 'budget' | 'searching' | 'results' | 'confirm' | 'sent'

interface Need {
  text: string
  category: CategoryId | null
  alternatives: CategoryId[]
  zone: string | null
  zoneAsked: boolean
  urgency: UrgencyId | null
  budget: number | null
  budgetAsked: boolean
}

interface Message {
  from: 'assistant' | 'user'
  text: string
}

const EMPTY_NEED: Need = { text: '', category: null, alternatives: [], zone: null, zoneAsked: false, urgency: null, budget: null, budgetAsked: false }
const GREETING = 'Hola, soy el asistente de TUS. Contame qué necesitás resolver.'

function loadNeed(): Need | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Need>) : null
    return parsed && typeof parsed.text === 'string' && parsed.text.length >= 3 ? { ...EMPTY_NEED, ...parsed } : null
  } catch {
    return null
  }
}

function saveNeed(need: Need | null) {
  try {
    if (need) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(need))
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Only a convenience to resume after signing in.
  }
}

// Title of the request: first sentence of the description (5..90 characters).
function titleFrom(text: string): string {
  const first = text.replace(/\s+/gu, ' ').trim().split(/(?<=[.!?])\s/u)[0] ?? text
  const title = first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first
  return title.length >= 5 ? title : `${title} (detalle en la descripción)`.slice(0, 90)
}

// The assistant recommends; the client always chooses. It only uses real providers from the API
// and never invents availability or ratings. Choosing creates the same TUS request as the
// directory, pending until the provider accepts it.
export function AssistantChat(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [catalog, setCatalog] = useState<OficioPublico[]>([])
  const [need, setNeed] = useState<Need>(EMPTY_NEED)
  const [messages, setMessages] = useState<Message[]>([{ from: 'assistant', text: GREETING }])
  const [step, setStep] = useState<Step>('describe')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<CandidatoPrestador[]>([])
  const [chosen, setChosen] = useState<CandidatoPrestador | null>(null)
  const [restored, setRestored] = useState(false)
  const endRef = useRef<HTMLLIElement>(null)

  const say = (text: string, from: Message['from'] = 'assistant') => setMessages((current) => [...current, { from, text }])
  const label = (id: CategoryId | null) => catalog.find((item) => item.id === id)?.label ?? id ?? ''

  useEffect(() => {
    void client
      .catalog()
      .then((value) => setCatalog(value.items))
      .catch(() => setCatalog([]))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, step, candidates])

  // After signing in (or reloading), resume the saved need instead of starting over.
  useEffect(() => {
    if (restored || session.status === 'loading') return
    setRestored(true)
    const saved = loadNeed()
    if (!saved) return
    setNeed(saved)
    setMessages([
      { from: 'assistant', text: GREETING },
      { from: 'user', text: saved.text },
      { from: 'assistant', text: saved.category ? `Seguimos con tu búsqueda de ${label(saved.category) || 'profesional'}.` : 'Seguimos con tu búsqueda.' },
    ])
    void advance(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once when the session is known
  }, [session.status, restored])

  // Decides the next question from what is still missing.
  async function advance(current: Need) {
    saveNeed(current)
    if (!current.category) {
      setStep('profession')
      return
    }
    if (session.status !== 'authenticated') {
      setStep('auth')
      say('Para buscar prestadores disponibles y guardar tu solicitud necesitás iniciar sesión o crear una cuenta.')
      return
    }
    if (!current.zone && !current.zoneAsked) {
      setStep('zone')
      say('¿En qué barrio es? Solo usamos la zona aproximada.')
      return
    }
    if (!current.urgency) {
      setStep('urgency')
      say('¿Para cuándo lo necesitás?')
      return
    }
    if (!current.budgetAsked) {
      setStep('budget')
      say('¿Tenés un presupuesto máximo? Es opcional: escribí un monto o elegí "Sin presupuesto".')
      return
    }
    await search(current)
  }

  async function search(current: Need) {
    if (session.status !== 'authenticated' || !current.category) return
    setStep('searching')
    setBusy(true)
    try {
      const result = await client.candidates(session.session, { profession: current.category, zone: current.zone })
      setCandidates(result.items)
      setStep('results')
      if (result.items.length === 0) say('No encontré prestadores disponibles para esa búsqueda en este momento. Podés cambiar el barrio, el oficio o la urgencia.')
      else
        say(
          `Encontré ${result.items.length} ${result.items.length === 1 ? 'profesional compatible' : 'profesionales compatibles'} de ${label(current.category)}${current.zone ? ` cerca de ${current.zone}` : ''}. Elegí con quién querés avanzar: la decisión es tuya.`
        )
    } catch {
      setStep('results')
      setCandidates([])
      say('No pude buscar profesionales ahora. Probá de nuevo en unos minutos.')
    } finally {
      setBusy(false)
    }
  }

  async function describe(text: string) {
    const clean = text.replace(/\s+/gu, ' ').trim().slice(0, 500)
    if (clean.length < 3) return
    say(clean, 'user')
    setBusy(true)
    let next: Need = { ...EMPTY_NEED, text: clean }
    try {
      const interpretation = await client.interpret(clean)
      next = {
        ...next,
        category: (interpretation.category as CategoryId | null) ?? null,
        alternatives: interpretation.alternatives as CategoryId[],
        zone: interpretation.zone,
        urgency: (interpretation.urgency as UrgencyId | null) ?? null,
        budget: interpretation.budgetMax,
        budgetAsked: interpretation.budgetMax !== null,
      }
      if (next.category) say(`Parece un trabajo de ${label(next.category) || next.category}.${next.zone ? ` Zona: ${next.zone}.` : ''}`)
      else say('¿Qué tipo de profesional necesitás?')
    } catch {
      say('No pude interpretar tu mensaje ahora. Elegí el tipo de profesional:')
    } finally {
      setBusy(false)
    }
    setNeed(next)
    await advance(next)
  }

  function update(patch: Partial<Need>, userText: string) {
    say(userText, 'user')
    const next = { ...need, ...patch }
    setNeed(next)
    void advance(next)
  }

  function submitComposer(event: React.FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    if (step === 'budget') {
      const amount = Number(text.replace(/[.\s$]/gu, ''))
      if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) {
        say('Escribí el monto en pesos, sin decimales (por ejemplo 25000).')
        return
      }
      update({ budget: amount, budgetAsked: true }, `$${amount.toLocaleString('es-AR')}`)
      return
    }
    void describe(text)
  }

  function restart() {
    saveNeed(null)
    setNeed(EMPTY_NEED)
    setCandidates([])
    setChosen(null)
    setMessages([{ from: 'assistant', text: GREETING }])
    setStep('describe')
  }

  function choose(candidate: CandidatoPrestador) {
    setChosen(candidate)
    setStep('confirm')
    say(`Elegiste a ${candidate.displayName}.`, 'user')
    say('Revisá tu solicitud y agregá hasta 2 fotos si querés. Se envía solo a ese profesional y queda pendiente hasta que la acepte.')
  }

  const composerEnabled = step === 'describe' || step === 'budget' || step === 'results' || step === 'profession'
  const option = (text: string, onClick: () => void, key = text) => (
    <button className={styles.chip} key={key} onClick={onClick} type="button">
      {text}
    </button>
  )

  return (
    <div className={styles.narrow}>
      <h1 className={styles.title}>Buscar servicios</h1>
      <p className={styles.subtitle}>Contale tu problema al asistente de TUS: te ayuda a encontrar profesionales reales de tu zona. Vos elegís.</p>

      <section aria-label="Conversación con el asistente de TUS" className={styles.chat}>
        <ol aria-live="polite" className={styles.messages}>
          {messages.map((message, index) => (
            <li className={`${styles.bubble} ${message.from === 'assistant' ? styles.fromAssistant : styles.fromUser}`} key={index}>
              <span className={styles.srOnlyLabel}>{message.from === 'assistant' ? 'Asistente: ' : 'Vos: '}</span>
              {message.text}
            </li>
          ))}

          {step === 'profession' ? (
            <li className={styles.options}>
              {(need.alternatives.length > 0 ? catalog.filter((item) => need.alternatives.includes(item.id as CategoryId)) : catalog).map((item) =>
                option(item.label, () => update({ category: item.id as CategoryId }, item.label), item.id)
              )}
            </li>
          ) : null}

          {step === 'auth' ? (
            <li className={styles.options}>
              <Link className={homeStyles.buttonPrimary} href={withReturnTo('/sign-in', RETURN_TO) as Route}>
                Iniciar sesión
              </Link>
              <Link className={homeStyles.buttonSecondary} href={withReturnTo('/registro', RETURN_TO) as Route}>
                Registrarse
              </Link>
            </li>
          ) : null}

          {step === 'zone' ? (
            <li className={styles.options}>
              {CORRIENTES_ZONES.map((zone) => option(zone, () => update({ zone, zoneAsked: true }, zone)))}
              {option('Prefiero no decirlo', () => update({ zone: null, zoneAsked: true }, 'Prefiero no decirlo'), 'sin-barrio')}
            </li>
          ) : null}

          {step === 'urgency' ? <li className={styles.options}>{URGENCIES.map((urgency) => option(urgency.label, () => update({ urgency: urgency.id }, urgency.label), urgency.id))}</li> : null}

          {step === 'budget' ? <li className={styles.options}>{option('Sin presupuesto', () => update({ budget: null, budgetAsked: true }, 'Sin presupuesto'))}</li> : null}

          {step === 'searching' ? (
            <li aria-busy="true" className={`${styles.bubble} ${styles.fromAssistant}`} role="status">
              Buscando profesionales disponibles…
            </li>
          ) : null}

          {step === 'results' && candidates.length > 0 ? (
            <li>
              <ul className={styles.candidates}>
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <WorkerCard onChoose={() => choose(candidate)} worker={candidate} />
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

          {step === 'results' ? (
            <li className={styles.options}>
              {option('Cambiar barrio', () => update({ zone: null, zoneAsked: false }, 'Quiero cambiar el barrio'))}
              {option('Cambiar oficio', () => update({ category: null, alternatives: [] }, 'Quiero cambiar el oficio'))}
              {option('Cambiar urgencia', () => update({ urgency: null }, 'Quiero cambiar la urgencia'))}
              {option('Empezar de nuevo', restart)}
            </li>
          ) : null}

          {step === 'confirm' && chosen && session.status === 'authenticated' && need.category ? (
            <li className={styles.panel} style={{ alignSelf: 'stretch' }}>
              <RequestForm
                initial={{
                  category: need.category,
                  title: titleFrom(need.text),
                  description: need.text,
                  zone: need.zone ?? '',
                  budget: need.budget ? String(need.budget) : '',
                  urgency: need.urgency ?? '',
                }}
                lockedCategory={need.category}
                onSent={(_request, warning) => {
                  saveNeed(null)
                  setStep('sent')
                  say(`Listo. Enviamos tu solicitud a ${chosen.displayName}. Queda pendiente hasta que la acepte; te lo mostramos en Mis solicitudes.${warning ? ` ${warning}` : ''}`)
                }}
                origin="web_assistant"
                provider={{ id: chosen.id, displayName: chosen.displayName }}
                session={session.session}
                submitLabel={`Enviar solicitud a ${chosen.displayName}`}
              />
              <button className={styles.chip} onClick={() => setStep('results')} style={{ marginTop: 10 }} type="button">
                Elegir otro profesional
              </button>
            </li>
          ) : null}

          {step === 'sent' ? (
            <li className={styles.options}>
              <Link className={homeStyles.buttonPrimary} href={'/mis-solicitudes' as Route}>
                Ver mis solicitudes
              </Link>
              {option('Nueva búsqueda', restart)}
            </li>
          ) : null}
          <li aria-hidden="true" ref={endRef} />
        </ol>

        <form className={styles.composer} onSubmit={submitComposer}>
          <label className={styles.srOnlyLabel} htmlFor="asistente-mensaje">
            {step === 'budget' ? 'Presupuesto máximo en pesos' : 'Contá qué necesitás'}
          </label>
          <textarea
            disabled={!composerEnabled || busy}
            id="asistente-mensaje"
            maxLength={500}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submitComposer(event)
              }
            }}
            placeholder={step === 'budget' ? 'Ej. 25000' : 'Ej. Pierde agua abajo de la bacha de la cocina'}
            rows={1}
            value={input}
          />
          <button className={homeStyles.buttonPrimary} disabled={!composerEnabled || busy || !input.trim()} type="submit">
            Enviar
          </button>
        </form>
      </section>
      {session.status === 'unavailable' ? (
        <p className={styles.resultCount} role="alert">
          No pudimos conectar con TUS. Podés describir tu problema, pero la búsqueda necesita conexión.
        </p>
      ) : null}
    </div>
  )
}
