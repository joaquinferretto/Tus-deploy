'use client'

import { useState } from 'react'

import type { BloqueoAgendaDTO } from '@factory/contracts'

import ui from '../../components/admin/admin-usuarios.module.css'
import { turnosApi } from '../../lib/tus-turnos-client'

// Exceptions to the usual week: a whole day, some hours of a day, or several days (a vacation).
// The weekly hours are never edited for a one-off absence. The API decides: it refuses an absence
// that would cover a taken turno, and its answer is what the screen shows. The reason is private:
// clients only ever see "No disponible".

type Tipo = 'dia' | 'horas' | 'rango'
const MOTIVOS = ['Vacaciones', 'Médico', 'Trámite', 'Personal', 'Otro'] as const
const ZONA = 'America/Argentina/Buenos_Aires'
const DIA_MS = 86_400_000

// Calendar date and clock time of an instant, where the provider works.
const fechaDe = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const horaDe = (iso: string) => new Intl.DateTimeFormat('es-AR', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
const instante = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00.000-03:00`).toISOString()
const diaSiguiente = (fecha: string) => new Date(Date.parse(`${fecha}T00:00:00.000Z`) + DIA_MS).toISOString().slice(0, 10)
const diaAnterior = (fecha: string) => new Date(Date.parse(`${fecha}T00:00:00.000Z`) - DIA_MS).toISOString().slice(0, 10)
const corta = (fecha: string) => new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${fecha}T00:00:00.000Z`))
const hoy = () => fechaDe(new Date().toISOString())

// What kind of absence a stored range is: whole days end at midnight.
function leer(bloqueo: BloqueoAgendaDTO): { tipo: Tipo; desde: string; hasta: string; horaDesde: string; horaHasta: string } {
  const desde = fechaDe(bloqueo.inicio)
  const horaDesde = horaDe(bloqueo.inicio)
  const horaHasta = horaDe(bloqueo.fin)
  if (horaDesde === '00:00' && horaHasta === '00:00') {
    const ultimo = diaAnterior(fechaDe(bloqueo.fin))
    return { tipo: ultimo === desde ? 'dia' : 'rango', desde, hasta: ultimo, horaDesde: '08:00', horaHasta: '12:00' }
  }
  return { tipo: 'horas', desde, hasta: fechaDe(bloqueo.fin), horaDesde, horaHasta }
}

export function textoAusencia(bloqueo: BloqueoAgendaDTO): string {
  const a = leer(bloqueo)
  if (a.tipo === 'dia') return `${corta(a.desde)} — No disponible todo el día`
  if (a.tipo === 'rango') return `${corta(a.desde)} → ${corta(a.hasta)} — No disponible`
  return a.desde === a.hasta ? `${corta(a.desde)} — ${a.horaDesde} a ${a.horaHasta}` : `${corta(a.desde)} ${a.horaDesde} → ${corta(a.hasta)} ${a.horaHasta}`
}

const VACIO = { tipo: 'dia' as Tipo, desde: '', hasta: '', horaDesde: '08:00', horaHasta: '12:00', motivo: '' }

export function ProviderAusencias({ bloqueos, onCambio }: { bloqueos: BloqueoAgendaDTO[]; onCambio: () => void }): React.ReactNode {
  // null: closed. 'nueva': adding. Otherwise the id of the absence being edited.
  const [abierta, setAbierta] = useState<string | null>(null)
  const [form, setForm] = useState(VACIO)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const abrir = (bloqueo: BloqueoAgendaDTO | null) => {
    setError('')
    setAviso('')
    setAbierta(bloqueo ? bloqueo.id : 'nueva')
    setForm(bloqueo ? { ...leer(bloqueo), motivo: (MOTIVOS as readonly string[]).includes(bloqueo.motivo) ? bloqueo.motivo : bloqueo.motivo === 'Bloqueo manual' ? '' : 'Otro' } : VACIO)
  }

  // The range the form describes, or what is wrong with it (the API checks it again).
  const rango = (): { inicio: string; fin: string } | string => {
    if (!form.desde) return form.tipo === 'rango' ? 'Elegí el primer día.' : 'Elegí la fecha.'
    if (form.desde < hoy()) return 'La fecha ya pasó.'
    if (form.tipo === 'dia') return { inicio: instante(form.desde, '00:00'), fin: instante(diaSiguiente(form.desde), '00:00') }
    if (form.tipo === 'rango') {
      if (!form.hasta) return 'Elegí el último día.'
      if (form.hasta < form.desde) return 'El último día no puede ser anterior al primero.'
      return { inicio: instante(form.desde, '00:00'), fin: instante(diaSiguiente(form.hasta), '00:00') }
    }
    if (!/^\d{2}:\d{2}$/u.test(form.horaDesde) || !/^\d{2}:\d{2}$/u.test(form.horaHasta)) return 'Elegí desde qué hora y hasta qué hora.'
    if (form.horaHasta <= form.horaDesde) return 'La hora de fin debe ser posterior a la de inicio.'
    return { inicio: instante(form.desde, form.horaDesde), fin: instante(form.desde, form.horaHasta) }
  }

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault()
    const leido = rango()
    if (typeof leido === 'string') return setError(leido)
    setOcupado(true)
    setError('')
    try {
      const cuerpo = { ...leido, ...(form.motivo ? { motivo: form.motivo } : {}) }
      if (abierta === 'nueva') await turnosApi.bloquear(cuerpo)
      else if (abierta) await turnosApi.editarBloqueo(abierta, cuerpo)
      setAviso(abierta === 'nueva' ? 'Ausencia guardada: esos horarios ya no se ofrecen.' : 'Ausencia actualizada.')
      setAbierta(null)
      onCambio()
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No pudimos guardar la ausencia.')
    } finally {
      setOcupado(false)
    }
  }

  const quitar = async (id: string) => {
    setOcupado(true)
    setError('')
    setAviso('')
    try {
      await turnosApi.quitarBloqueo(id)
      setAviso('Ausencia quitada: tus horarios habituales vuelven a ofrecerse.')
      onCambio()
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No pudimos quitar la ausencia.')
    } finally {
      setOcupado(false)
    }
  }

  const tipo = (valor: Tipo, texto: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44 }}>
      <input checked={form.tipo === valor} data-ausencia-tipo={valor} name="ausencia-tipo" onChange={() => setForm({ ...form, tipo: valor })} type="radio" />
      {texto}
    </label>
  )

  return (
    <section aria-labelledby="excepciones-titulo" className={ui.panel} data-ausencias>
      <h2 id="excepciones-titulo">Excepciones</h2>
      <p className={ui.muted}>Días u horarios puntuales en los que no atendés. Tu horario habitual no cambia.</p>
      {bloqueos.length === 0 ? (
        <p className={ui.muted} data-ausencias-lista="vacia">No tenés ausencias cargadas.</p>
      ) : (
        <ul data-ausencias-lista style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {bloqueos.map((bloqueo) => (
            <li data-ausencia={bloqueo.id} key={bloqueo.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: '1px solid var(--tus-line, #e5e7eb)', borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{textoAusencia(bloqueo)}</strong>
                {bloqueo.motivo && bloqueo.motivo !== 'Bloqueo manual' ? <span className={ui.muted}>{` · ${bloqueo.motivo} (solo lo ves vos)`}</span> : null}
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button className={ui.buttonSecondary} data-ausencia-accion="editar" disabled={ocupado} onClick={() => abrir(bloqueo)} type="button">Editar</button>
                <button className={ui.buttonSecondary} data-ausencia-accion="quitar" disabled={ocupado} onClick={() => void quitar(bloqueo.id)} type="button">Quitar</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {aviso ? <p className={ui.alertOk} data-ausencias-aviso role="status">{aviso}</p> : null}
      {abierta === null ? (
        <>
          {error ? <p className={ui.alertError} data-ausencias-error role="alert">{error}</p> : null}
          <div className={ui.actions}>
            <button className={ui.buttonPrimary} data-ausencia-accion="agregar" onClick={() => abrir(null)} type="button">Agregar ausencia</button>
          </div>
        </>
      ) : (
        <form data-ausencia-form noValidate onSubmit={guardar} style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>{abierta === 'nueva' ? 'Nueva ausencia' : 'Editar ausencia'}</legend>
            {tipo('dia', 'Todo el día')}
            {tipo('horas', 'Unas horas')}
            {tipo('rango', 'Varios días')}
          </fieldset>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))' }}>
            <label className={ui.field}>
              <span>{form.tipo === 'rango' ? 'Desde' : 'Fecha'}</span>
              <input data-ausencia="desde" min={hoy()} onChange={(event) => setForm({ ...form, desde: event.target.value, hasta: form.hasta && form.hasta < event.target.value ? event.target.value : form.hasta })} type="date" value={form.desde} />
            </label>
            {form.tipo === 'rango' ? (
              <label className={ui.field}>
                <span>Hasta (inclusive)</span>
                <input data-ausencia="hasta" min={form.desde || hoy()} onChange={(event) => setForm({ ...form, hasta: event.target.value })} type="date" value={form.hasta} />
              </label>
            ) : null}
            {form.tipo === 'horas' ? (
              <>
                <label className={ui.field}>
                  <span>Desde las</span>
                  <input data-ausencia="hora-desde" onChange={(event) => setForm({ ...form, horaDesde: event.target.value })} type="time" value={form.horaDesde} />
                </label>
                <label className={ui.field}>
                  <span>Hasta las</span>
                  <input data-ausencia="hora-hasta" onChange={(event) => setForm({ ...form, horaHasta: event.target.value })} type="time" value={form.horaHasta} />
                </label>
              </>
            ) : null}
            <label className={ui.field}>
              <span>Motivo (opcional, privado)</span>
              <select data-ausencia="motivo" onChange={(event) => setForm({ ...form, motivo: event.target.value })} value={form.motivo}>
                <option value="">Sin motivo</option>
                {MOTIVOS.map((motivo) => <option key={motivo}>{motivo}</option>)}
              </select>
            </label>
          </div>
          {error ? <p className={ui.alertError} data-ausencias-error role="alert">{error}</p> : null}
          <div className={ui.actions}>
            <button className={ui.buttonPrimary} data-ausencia-accion="guardar" disabled={ocupado} type="submit">{ocupado ? 'Guardando…' : 'Guardar ausencia'}</button>
            <button className={ui.buttonSecondary} disabled={ocupado} onClick={() => { setAbierta(null); setError('') }} type="button">Cancelar</button>
          </div>
        </form>
      )}
    </section>
  )
}
