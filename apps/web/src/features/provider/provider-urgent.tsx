'use client'

import { useCallback, useEffect, useState } from 'react'

import authStyles from '../auth/auth.module.css'
import styles from '../directory/directory.module.css'
import homeStyles from '../home/home.module.css'
import { useTusSession } from '../session/use-tus-session'
import { createUrgentClient, type UrgentOffer, type UrgentPreference } from '../urgent/urgent-client'

const RETURN_TO = '/prestador/solicitudes'

const OFFER_LABEL: Record<UrgentOffer['offer'], string> = {
  notificada: 'Esperando tu respuesta',
  no_enviada: 'Esperando tu respuesta',
  acepto: 'Es tuya',
  no_puede: 'Dijiste que no podías',
  cerrada_por_otro: 'La tomó otro prestador',
  renuncio: 'Avisaste que no podías asistir',
  vencida: 'Venció',
}

// SERVICIO-URGENTE-01, provider side: the switch "Aceptar servicios urgentes" and the urgent
// requests TUS offered to this provider. The first provider that accepts gets it; the one that got
// it can still say it cannot go, and it is offered again to the others.
export function ProviderUrgent(): React.ReactNode {
  const session = useTusSession(RETURN_TO)
  const [preference, setPreference] = useState<UrgentPreference | null | undefined>(undefined)
  const [offers, setOffers] = useState<UrgentOffer[]>([])
  const [working, setWorking] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (session.status !== 'authenticated') return
    const client = createUrgentClient(session.session)
    try {
      const [current, items] = await Promise.all([client.preference(), client.offers()])
      setPreference(current)
      setOffers(items)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [session])

  // An urgent request waits minutes, not days: what is offered is read again while this is open.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  if (session.status !== 'authenticated' || preference === undefined) return failed ? <p className={authStyles.formError} role="alert">No pudimos cargar los servicios urgentes.</p> : null
  // No provider profile yet: nothing to configure here.
  if (preference === null) return null

  async function toggle(change: { acceptsUrgent?: boolean; wholeCity?: boolean }) {
    if (session.status !== 'authenticated') return
    setWorking('preferencia')
    try {
      setPreference(await createUrgentClient(session.session).savePreference(change))
      setNotice('')
    } catch {
      setNotice('No pudimos guardar el cambio. Probá de nuevo.')
    } finally {
      setWorking(null)
    }
  }

  async function answer(offer: UrgentOffer, decision: 'asistir' | 'no-puedo') {
    if (session.status !== 'authenticated') return
    setWorking(offer.id)
    try {
      const result = await createUrgentClient(session.session).answer(offer.id, decision)
      setNotice(result.message)
    } catch {
      setNotice('No pudimos registrar tu respuesta. Probá de nuevo.')
    } finally {
      await load()
      setWorking(null)
    }
  }

  const visibles = offers.filter((offer) => offer.open || offer.assigned).concat(offers.filter((offer) => !offer.open && !offer.assigned).slice(0, 3))

  return (
    <section aria-labelledby="servicios-urgentes" data-urgentes-prestador>
      <h2 className={styles.title} id="servicios-urgentes" style={{ fontSize: '1.15rem' }}>
        Servicios urgentes
      </h2>
      <label style={{ alignItems: 'flex-start', display: 'flex', gap: 10, marginTop: 8 }}>
        <input checked={preference.acceptsUrgent} data-acepta-urgencias disabled={working === 'preferencia'} onChange={(event) => void toggle({ acceptsUrgent: event.target.checked })} style={{ height: 20, marginTop: 2, width: 20 }} type="checkbox" />
        <span>
          <strong>Aceptar servicios urgentes</strong>
          <span className={styles.muted} style={{ display: 'block', fontSize: '0.9rem' }}>
            Si lo activás, te avisamos al instante por WhatsApp cuando un cliente necesita atención rápida de tus servicios, con su dirección y su barrio. El pedido les llega a la vez a todos los prestadores disponibles y lo toma el primero que responde “Puedo asistir”.
          </span>
        </span>
      </label>
      {preference.acceptsUrgent ? (
        <>
          {/* Coverage is what the provider DECLARED: its neighbourhoods, its radius, or the whole
              city if it says so here. Nothing is assumed. */}
          <label style={{ alignItems: 'flex-start', display: 'flex', gap: 10, marginTop: 10 }}>
            <input checked={preference.wholeCity} data-toda-la-ciudad disabled={working === 'preferencia'} onChange={(event) => void toggle({ wholeCity: event.target.checked })} style={{ height: 20, marginTop: 2, width: 20 }} type="checkbox" />
            <span>
              <strong>Atiendo urgencias en toda la ciudad</strong>
              <span className={styles.muted} style={{ display: 'block', fontSize: '0.9rem' }}>Marcalo solo si podés ir a cualquier barrio. Si no, te avisamos únicamente de los barrios que declaraste.</span>
            </span>
          </label>
          <p className={styles.muted} data-cobertura-urgencias={preference.wholeCity ? 'ciudad' : preference.zones.length > 0 || preference.radiusKm !== null ? 'zonas' : 'ninguna'} style={{ fontSize: '0.9rem', marginTop: 8 }}>
            {preference.wholeCity
              ? 'Vas a recibir urgencias de toda la ciudad.'
              : preference.zones.length > 0
                ? `Vas a recibir urgencias de: ${preference.zones.join(', ')}${preference.radiusKm !== null ? ` y hasta ${preference.radiusKm} km de tu barrio` : ''}. `
                : preference.radiusKm !== null
                  ? `Vas a recibir urgencias hasta ${preference.radiusKm} km de tu barrio. `
                  : 'Todavía no declaraste ningún barrio, así que no vas a recibir urgencias. '}
            {preference.wholeCity ? null : <a href="/prestador/perfil-publico">Editar mis barrios</a>}
          </p>
        </>
      ) : null}
      {notice ? (
        <p className={styles.resultCount} data-urgente-aviso role="status" style={{ marginTop: 10 }}>
          {notice}
        </p>
      ) : null}
      {visibles.length > 0 ? (
        <ul className={styles.grid} style={{ gridTemplateColumns: '1fr', marginTop: 12 }}>
          {visibles.map((offer) => (
            <li className={styles.card} data-urgente-oferta={offer.offer} key={offer.id}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                <strong>Servicio urgente de {offer.service}</strong>
                <span className={offer.open || offer.assigned ? styles.available : styles.muted}>{OFFER_LABEL[offer.offer]}</span>
              </div>
              <p style={{ margin: 0 }}>
                {offer.address} · {offer.zone}
              </p>
              {offer.description ? <p style={{ margin: 0 }}>{offer.description}</p> : null}
              <p className={styles.muted} style={{ fontSize: '0.9rem', margin: 0 }}>Cliente: {offer.client}</p>
              {offer.workId ? <a href={`/trabajos/${encodeURIComponent(offer.workId)}`}>Ver trabajo</a> : null}
              {offer.open ? (
                <div className={styles.cardActions}>
                  <button className={homeStyles.buttonPrimary} disabled={working === offer.id} onClick={() => void answer(offer, 'asistir')} type="button">
                    Puedo asistir
                  </button>
                  {offer.offer !== 'no_puede' ? (
                    <button className={homeStyles.buttonSecondary} disabled={working === offer.id} onClick={() => void answer(offer, 'no-puedo')} type="button">
                      No puedo
                    </button>
                  ) : null}
                </div>
              ) : offer.assigned ? (
                <div className={styles.cardActions}>
                  {/* The assigned provider gives the request back: it is offered again to the others. */}
                  <button className={homeStyles.buttonSecondary} disabled={working === offer.id} onClick={() => void answer(offer, 'no-puedo')} type="button">
                    No puedo asistir
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
