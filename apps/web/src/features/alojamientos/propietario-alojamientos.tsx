'use client'

import { useCallback, useEffect, useState } from 'react'
import { MAXIMO_IMAGENES_ALOJAMIENTO, type AlojamientoPropioDTO, type ReservaAlojamientoDTO, type TipoAlojamientoDTO } from '@factory/contracts'

import {
  bloquearFechas,
  cambiarEstadoReserva,
  crearMiAlojamiento,
  editarMiAlojamiento,
  ErrorAlojamientos,
  ESTADO_RESERVA,
  fechaCorta,
  hoyAlojamientos,
  listarBarriosAlojamiento,
  listarTiposAlojamiento,
  misAlojamientos,
  ordenarFotosAlojamiento,
  pesos,
  publicarMiAlojamiento,
  quitarBloqueoFechas,
  quitarFotoAlojamiento,
  reservasDeMiAlojamiento,
  subirFotoAlojamiento,
  sumarDiasFecha,
  type AlojamientoPropioForm,
} from './alojamientos-client'

// "Mis alojamientos": what the owner of a place does with it. One screen, one alojamiento open at
// a time: its data, its photos, its blocked dates and its reservations. Nothing is decided here:
// every action goes to the API and the screen shows what it answered.

type Barrio = { id: string; nombre: string; zona: string | null }
type Seccion = 'datos' | 'fotos' | 'disponibilidad' | 'reservas'
const VACIO = { tipoId: '', nombre: '', descripcion: '', direccion: '', barrioId: '', checkInHora: '14:00', checkOutHora: '10:00', politicas: '', comodidades: '', capacidadPersonas: '2', camasDetalle: '', banosCantidad: '1', precioNoche: '' }
type Campos = typeof VACIO

const caja: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem' }
const boton: React.CSSProperties = { minHeight: 44, padding: '0.5rem 1rem', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem', border: '1px solid #e5e7eb', background: '#f3f4f6', color: '#111827' }
const primario: React.CSSProperties = { ...boton, background: '#ff5a00', borderColor: '#ff5a00', color: '#fff' }
const peligro: React.CSSProperties = { ...boton, background: '#fff', borderColor: '#dc2626', color: '#b91c1c' }
const entrada: React.CSSProperties = { minHeight: 44, width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: 8, padding: '0.5rem 0.7rem', fontSize: '1rem', background: '#fff' }
const etiqueta: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.85rem', fontWeight: 600, color: '#374151', minWidth: 0 }
const rejilla: React.CSSProperties = { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }

const camposDe = (a: AlojamientoPropioDTO): Campos => ({
  tipoId: a.tipoId,
  nombre: a.nombre,
  descripcion: a.descripcion ?? '',
  direccion: a.direccion,
  barrioId: a.barrioId ?? '',
  checkInHora: a.checkInHora,
  checkOutHora: a.checkOutHora,
  politicas: a.politicas ?? '',
  comodidades: a.comodidades.join(', '),
  capacidadPersonas: String(a.unidades[0]?.capacidadPersonas ?? 2),
  camasDetalle: a.unidades[0]?.camasDetalle ?? '',
  banosCantidad: String(a.unidades[0]?.banosCantidad ?? 1),
  precioNoche: a.unidades[0]?.precioNoche ? String(a.unidades[0].precioNoche) : '',
})

// The same rules the API applies, said before sending. The API still decides.
function validar(c: Campos): { campo: keyof Campos; mensaje: string } | null {
  if (!c.tipoId) return { campo: 'tipoId', mensaje: 'Elegí el tipo de alojamiento.' }
  if (c.nombre.trim().length < 3) return { campo: 'nombre', mensaje: 'El título debe tener al menos 3 caracteres.' }
  if (!c.barrioId) return { campo: 'barrioId', mensaje: 'Elegí el barrio.' }
  if (c.direccion.trim().length < 3) return { campo: 'direccion', mensaje: 'Escribí la dirección.' }
  if (!/^\d{1,3}$/u.test(c.capacidadPersonas) || Number(c.capacidadPersonas) < 1 || Number(c.capacidadPersonas) > 100) return { campo: 'capacidadPersonas', mensaje: 'La capacidad es un número de 1 a 100.' }
  if (!/^\d{1,2}$/u.test(c.banosCantidad) || Number(c.banosCantidad) > 50) return { campo: 'banosCantidad', mensaje: 'La cantidad de baños es un número de 0 a 50.' }
  if (!/^\d{1,9}$/u.test(c.precioNoche) || Number(c.precioNoche) < 1) return { campo: 'precioNoche', mensaje: 'El precio por noche es un número entero mayor que cero, sin puntos ni comas.' }
  return null
}

const formDe = (c: Campos): AlojamientoPropioForm => ({
  tipoId: c.tipoId,
  nombre: c.nombre.trim(),
  ...(c.descripcion.trim() ? { descripcion: c.descripcion.trim() } : {}),
  direccion: c.direccion.trim(),
  barrioId: c.barrioId,
  checkInHora: c.checkInHora,
  checkOutHora: c.checkOutHora,
  ...(c.politicas.trim() ? { politicas: c.politicas.trim() } : {}),
  comodidades: [...new Set(c.comodidades.split(',').map((item) => item.trim()).filter(Boolean))],
  capacidadPersonas: Number(c.capacidadPersonas),
  ...(c.camasDetalle.trim() ? { camasDetalle: c.camasDetalle.trim() } : {}),
  banosCantidad: Number(c.banosCantidad),
  precioNoche: Number(c.precioNoche),
})

export function PropietarioAlojamientosView(): React.ReactNode {
  const [alojamientos, setAlojamientos] = useState<AlojamientoPropioDTO[] | null>(null)
  const [tipos, setTipos] = useState<TipoAlojamientoDTO[]>([])
  const [barrios, setBarrios] = useState<Barrio[]>([])
  const [sinSesion, setSinSesion] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // 'nuevo', the id of the alojamiento that is open, or nothing.
  const [abierto, setAbierto] = useState<string | null>(null)
  const [seccion, setSeccion] = useState<Seccion>('datos')
  const [campos, setCampos] = useState<Campos>(VACIO)
  const [errorCampo, setErrorCampo] = useState<{ campo: string; mensaje: string } | null>(null)
  const [reservas, setReservas] = useState<ReservaAlojamientoDTO[] | null>(null)
  const [bloqueo, setBloqueo] = useState({ desde: '', hasta: '', motivo: 'Uso personal' })
  const [confirmar, setConfirmar] = useState<{ titulo: string; detalle: string; accion: string; hacer: () => Promise<void> } | null>(null)

  const cargar = useCallback(async () => {
    try {
      setAlojamientos(await misAlojamientos())
      setError(null)
    } catch (causa) {
      if (causa instanceof ErrorAlojamientos && causa.status === 401) setSinSesion(true)
      else setError(causa instanceof Error ? causa.message : 'No pudimos cargar tus alojamientos.')
    }
  }, [])

  useEffect(() => {
    void cargar()
    listarTiposAlojamiento().then(setTipos).catch(() => undefined)
    listarBarriosAlojamiento().then(setBarrios).catch(() => undefined)
  }, [cargar])

  const actual = alojamientos?.find((a) => a.id === abierto) ?? null
  const unidad = actual?.unidades[0] ?? null

  useEffect(() => {
    if (!actual || seccion !== 'reservas') return
    setReservas(null)
    reservasDeMiAlojamiento(actual.id).then(setReservas).catch(() => setReservas([]))
  }, [actual?.id, seccion])

  // Every action: one at a time, the answer of the API on screen, the list reloaded.
  const ejecutar = async (hacer: () => Promise<unknown>, hecho: string) => {
    setOcupado(true)
    setAviso(null)
    setError(null)
    try {
      await hacer()
      // The message arrives with the list already showing what changed.
      await cargar()
      setAviso(hecho)
      return true
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No pudimos completar la operación.')
      return false
    } finally {
      setOcupado(false)
    }
  }

  const abrir = (a: AlojamientoPropioDTO | null) => {
    setAbierto(a ? a.id : 'nuevo')
    setCampos(a ? camposDe(a) : VACIO)
    setSeccion('datos')
    setErrorCampo(null)
    setAviso(null)
    setError(null)
  }

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault()
    const invalido = validar(campos)
    setErrorCampo(invalido)
    if (invalido) return
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      if (abierto === 'nuevo') {
        const creado = await crearMiAlojamiento(formDe(campos))
        await cargar()
        setAbierto(creado.id)
        setSeccion('fotos')
        setAviso('Alojamiento creado como borrador. Sumale fotos y publicalo cuando esté listo.')
      } else if (abierto) {
        await editarMiAlojamiento(abierto, formDe(campos))
        await cargar()
        setAviso('Cambios guardados.')
      }
    } catch (causa) {
      if (causa instanceof ErrorAlojamientos && causa.campo) setErrorCampo({ campo: causa.campo, mensaje: causa.message })
      else setError(causa instanceof Error ? causa.message : 'No pudimos guardar.')
    } finally {
      setOcupado(false)
    }
  }

  const campo = (nombre: keyof Campos, texto: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label style={etiqueta}>
      {texto}
      <input aria-invalid={errorCampo?.campo === nombre} data-campo={nombre} onChange={(e) => setCampos({ ...campos, [nombre]: e.target.value })} style={entrada} value={campos[nombre]} {...extra} />
      {errorCampo?.campo === nombre ? <span data-error={nombre} role="alert" style={{ color: '#b91c1c', fontWeight: 500 }}>{errorCampo.mensaje}</span> : null}
    </label>
  )

  const formulario = (
    <form data-alojamiento-form noValidate onSubmit={guardar} style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={rejilla}>
        <label style={etiqueta}>
          Tipo
          <select aria-invalid={errorCampo?.campo === 'tipoId'} data-campo="tipoId" onChange={(e) => setCampos({ ...campos, tipoId: e.target.value })} style={entrada} value={campos.tipoId}>
            <option value="">Elegí un tipo</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          {errorCampo?.campo === 'tipoId' ? <span data-error="tipoId" role="alert" style={{ color: '#b91c1c', fontWeight: 500 }}>{errorCampo.mensaje}</span> : null}
        </label>
        {campo('nombre', 'Título', { maxLength: 120, placeholder: 'Ej. Casa con patio cerca del río' })}
      </div>
      <label style={etiqueta}>
        Descripción
        <textarea data-campo="descripcion" maxLength={4000} onChange={(e) => setCampos({ ...campos, descripcion: e.target.value })} style={{ ...entrada, minHeight: 90, resize: 'vertical' }} value={campos.descripcion} />
      </label>
      <div style={rejilla}>
        <label style={etiqueta}>
          Barrio
          <select aria-invalid={errorCampo?.campo === 'barrioId'} data-campo="barrioId" onChange={(e) => setCampos({ ...campos, barrioId: e.target.value })} style={entrada} value={campos.barrioId}>
            <option value="">Elegí un barrio</option>
            {barrios.map((b) => <option key={b.id} value={b.id}>{b.nombre}{b.zona ? ` (${b.zona})` : ''}</option>)}
          </select>
          {errorCampo?.campo === 'barrioId' ? <span data-error="barrioId" role="alert" style={{ color: '#b91c1c', fontWeight: 500 }}>{errorCampo.mensaje}</span> : null}
        </label>
        <div>
          {campo('direccion', 'Dirección', { maxLength: 200, placeholder: 'Calle y número' })}
          <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>Solo la ve quien tiene una reserva confirmada.</span>
        </div>
      </div>
      <div style={rejilla}>
        {campo('capacidadPersonas', 'Huéspedes (máximo)', { inputMode: 'numeric', maxLength: 3 })}
        {campo('camasDetalle', 'Camas', { maxLength: 300, placeholder: 'Ej. 1 matrimonial, 2 simples' })}
        {campo('banosCantidad', 'Baños', { inputMode: 'numeric', maxLength: 2 })}
        {campo('precioNoche', 'Precio por noche (ARS)', { inputMode: 'numeric', maxLength: 9, placeholder: 'Ej. 50000' })}
      </div>
      <div style={rejilla}>
        {campo('checkInHora', 'Entrada desde', { type: 'time' })}
        {campo('checkOutHora', 'Salida hasta', { type: 'time' })}
      </div>
      {campo('comodidades', 'Servicios (separados por coma)', { maxLength: 600, placeholder: 'Wifi, Parrilla, Cochera' })}
      <label style={etiqueta}>
        Reglas de la casa
        <textarea data-campo="politicas" maxLength={4000} onChange={(e) => setCampos({ ...campos, politicas: e.target.value })} style={{ ...entrada, minHeight: 70, resize: 'vertical' }} value={campos.politicas} />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button data-accion="guardar" disabled={ocupado} style={primario} type="submit">{ocupado ? 'Guardando…' : abierto === 'nuevo' ? 'Crear alojamiento' : 'Guardar cambios'}</button>
        <button disabled={ocupado} onClick={() => setAbierto(null)} style={boton} type="button">Volver</button>
      </div>
    </form>
  )

  const fotos = actual ? (
    <div data-seccion="fotos" style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ margin: 0, color: '#4b5563' }}>Hasta {MAXIMO_IMAGENES_ALOJAMIENTO} fotos JPG, PNG o WEBP de hasta 2 MB. La primera es la principal.</p>
      <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {actual.imagenes.map((img, indice) => (
          <figure data-foto={img.id} key={img.id} style={{ margin: 0, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#f9fafb' }}>
            <img alt={img.alt ?? `Foto ${indice + 1} de ${actual.nombre}`} src={img.url} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
            <figcaption style={{ display: 'grid', gap: 4, padding: 6 }}>
              {indice === 0 ? <strong style={{ fontSize: 12, color: '#065f46' }}>Principal</strong> : (
                <button disabled={ocupado} onClick={() => void ejecutar(() => ordenarFotosAlojamiento(actual.id, [img.id, ...actual.imagenes.filter((otra) => otra.id !== img.id).map((otra) => otra.id)]), 'Foto principal actualizada.')} style={{ ...boton, minHeight: 36, fontSize: 12, padding: '0.25rem 0.5rem' }} type="button">Hacer principal</button>
              )}
              <button data-foto-accion="quitar" disabled={ocupado} onClick={() => setConfirmar({ titulo: '¿Quitar esta foto?', detalle: 'La foto deja de mostrarse en el alojamiento.', accion: 'Quitar foto', hacer: async () => { await ejecutar(() => quitarFotoAlojamiento(img.id), 'Foto quitada.') } })} style={{ ...peligro, minHeight: 36, fontSize: 12, padding: '0.25rem 0.5rem' }} type="button">Quitar</button>
            </figcaption>
          </figure>
        ))}
      </div>
      {actual.imagenes.length < MAXIMO_IMAGENES_ALOJAMIENTO ? (
        <label style={{ ...etiqueta, maxWidth: 360 }}>
          Agregar foto
          <input
            accept="image/jpeg,image/png,image/webp"
            data-foto="archivo"
            disabled={ocupado}
            onChange={(e) => {
              const archivo = e.target.files?.[0]
              e.target.value = ''
              if (!archivo) return
              if (archivo.size > 2 * 1024 * 1024) return setError('Usá una foto de hasta 2 MB.')
              void ejecutar(() => subirFotoAlojamiento(actual.id, archivo), 'Foto agregada.')
            }}
            style={entrada}
            type="file"
          />
        </label>
      ) : <p style={{ margin: 0, color: '#6b7280' }}>Llegaste al máximo de fotos.</p>}
    </div>
  ) : null

  const hoy = hoyAlojamientos()
  const disponibilidad = actual && unidad ? (
    <div data-seccion="disponibilidad" style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ margin: 0, color: '#4b5563' }}>Bloqueá las fechas en las que el lugar no se puede reservar (mantenimiento, uso personal, reformas). Las reservas que ya tenés no se tocan.</p>
      <form
        data-bloqueo-form
        onSubmit={(e) => {
          e.preventDefault()
          if (!bloqueo.desde || !bloqueo.hasta) return setError('Elegí desde qué día y hasta qué día.')
          if (bloqueo.hasta < bloqueo.desde) return setError('El último día no puede ser anterior al primero.')
          // The last blocked day is included: the block ends the morning after.
          void ejecutar(() => bloquearFechas(unidad.id, { fechaInicio: bloqueo.desde, fechaFin: sumarDiasFecha(bloqueo.hasta, 1), motivo: bloqueo.motivo }), 'Fechas bloqueadas.').then((ok) => ok && setBloqueo({ desde: '', hasta: '', motivo: bloqueo.motivo }))
        }}
        style={rejilla}
      >
        <label style={etiqueta}>Desde<input data-bloqueo="desde" min={hoy} onChange={(e) => setBloqueo({ ...bloqueo, desde: e.target.value, hasta: bloqueo.hasta && bloqueo.hasta < e.target.value ? e.target.value : bloqueo.hasta })} style={entrada} type="date" value={bloqueo.desde} /></label>
        <label style={etiqueta}>Hasta (inclusive)<input data-bloqueo="hasta" min={bloqueo.desde || hoy} onChange={(e) => setBloqueo({ ...bloqueo, hasta: e.target.value })} style={entrada} type="date" value={bloqueo.hasta} /></label>
        <label style={etiqueta}>
          Motivo (privado)
          <select data-bloqueo="motivo" onChange={(e) => setBloqueo({ ...bloqueo, motivo: e.target.value })} style={entrada} value={bloqueo.motivo}>
            {['Uso personal', 'Mantenimiento', 'Reformas', 'Vacaciones', 'Cierre temporal', 'Otro'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}><button data-bloqueo="guardar" disabled={ocupado} style={primario} type="submit">Bloquear fechas</button></div>
      </form>
      {unidad.bloqueos.length === 0 ? <p data-bloqueos="vacio" style={{ margin: 0, color: '#6b7280' }}>No hay fechas bloqueadas.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
          {unidad.bloqueos.map((b) => (
            <li data-bloqueo-id={b.id} key={b.id} style={{ ...caja, padding: '0.6rem 0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span>{fechaCorta(b.fechaInicio)} → {fechaCorta(sumarDiasFecha(b.fechaFin.slice(0, 10), -1))} · {b.motivo}</span>
              <button data-bloqueo-accion="quitar" disabled={ocupado} onClick={() => void ejecutar(() => quitarBloqueoFechas(b.id), 'Bloqueo quitado: las fechas vuelven a estar disponibles.')} style={{ ...boton, minHeight: 40 }} type="button">Quitar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null

  const cambiar = (r: ReservaAlojamientoDTO, estado: 'checked_in' | 'completed' | 'cancelled', hecho: string) =>
    ejecutar(async () => {
      await cambiarEstadoReserva(r.id, estado)
      if (actual) setReservas(await reservasDeMiAlojamiento(actual.id))
    }, hecho)

  const listaReservas = actual ? (
    <div data-seccion="reservas" style={{ display: 'grid', gap: '0.5rem' }}>
      {reservas === null ? <p>Cargando reservas…</p> : reservas.length === 0 ? <p data-reservas="vacio" style={{ margin: 0, color: '#6b7280' }}>Este alojamiento todavía no tiene reservas.</p> : reservas.map((r) => (
        <article data-reserva={r.id} data-reserva-estado={r.estado} key={r.id} style={{ ...caja, padding: '0.75rem', display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong style={{ overflowWrap: 'anywhere' }}>{r.clienteNombre}</strong>
            <span style={{ fontSize: 12, fontWeight: 700, background: '#f3f4f6', borderRadius: 9999, padding: '2px 10px' }}>{ESTADO_RESERVA[r.estado] ?? r.estado}</span>
          </div>
          <span>{fechaCorta(r.fechaInicio)} → {fechaCorta(r.fechaFin)} · {r.cantidadPersonas} {r.cantidadPersonas === 1 ? 'huésped' : 'huéspedes'} · {pesos(r.precioFinalSnapshot)}</span>
          {r.clienteTelefono || r.clienteEmail ? <span style={{ color: '#4b5563', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{[r.clienteTelefono, r.clienteEmail].filter(Boolean).join(' · ')}</span> : null}
          {r.notas ? <span style={{ color: '#4b5563', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>“{r.notas}”</span> : null}
          {r.estado === 'confirmed' || r.estado === 'checked_in' ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 4 }}>
              {r.estado === 'confirmed' ? <button disabled={ocupado} onClick={() => void cambiar(r, 'checked_in', 'Ingreso registrado.')} style={{ ...boton, minHeight: 40 }} type="button">Registrar ingreso</button> : null}
              {r.estado === 'checked_in' ? <button disabled={ocupado} onClick={() => void cambiar(r, 'completed', 'Estadía finalizada.')} style={{ ...boton, minHeight: 40 }} type="button">Finalizar estadía</button> : null}
              <button data-reserva-accion="cancelar" disabled={ocupado} onClick={() => setConfirmar({ titulo: '¿Cancelar esta reserva?', detalle: `La reserva de ${r.clienteNombre} queda cancelada y sus fechas vuelven a estar disponibles. Avisale a la persona.`, accion: 'Cancelar reserva', hacer: async () => { await cambiar(r, 'cancelled', 'Reserva cancelada.') } })} style={{ ...peligro, minHeight: 40 }} type="button">Cancelar</button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  ) : null

  const pestana = (id: Seccion, texto: string) => (
    <button aria-pressed={seccion === id} data-pestana={id} onClick={() => setSeccion(id)} style={{ ...boton, ...(seccion === id ? { background: '#111827', borderColor: '#111827', color: '#fff' } : {}) }} type="button">{texto}</button>
  )

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '2rem 1rem', display: 'grid', gap: '1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#111827', margin: 0 }}>Mis alojamientos</h1>
          <p style={{ color: '#4b5563', margin: '0.25rem 0 0' }}>Publicá tu lugar, cuidá su disponibilidad y seguí sus reservas.</p>
        </div>
        {!sinSesion && abierto === null ? <button data-accion="nuevo" onClick={() => abrir(null)} style={primario} type="button">Publicar un alojamiento</button> : null}
      </header>
      {aviso ? <p data-propietario="aviso" role="status" style={{ ...caja, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', margin: 0 }}>{aviso}</p> : null}
      {error ? <p data-propietario="error" role="alert" style={{ ...caja, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b', margin: 0 }}>{error}</p> : null}
      {sinSesion ? (
        <div style={{ ...caja, textAlign: 'center' }}>
          <p style={{ marginTop: 0 }}>Iniciá sesión con tu cuenta de TUS para publicar y administrar alojamientos.</p>
          <a href={`/sign-in?returnTo=${encodeURIComponent('/propietario/alojamientos')}`} style={{ ...primario, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Iniciar sesión</a>
        </div>
      ) : alojamientos === null ? (
        !error ? <p data-propietario="cargando">Cargando tus alojamientos…</p> : null
      ) : abierto === 'nuevo' ? (
        <section style={caja}><h2 style={{ marginTop: 0, fontSize: '1.2rem' }}>Nuevo alojamiento</h2>{formulario}</section>
      ) : actual ? (
        <section data-alojamiento={actual.id} style={{ ...caja, display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', overflowWrap: 'anywhere' }}>{actual.nombre}</h2>
              <span data-publicacion={actual.publicado ? 'publicado' : actual.estado} style={{ fontSize: 12, fontWeight: 700, color: actual.publicado ? '#065f46' : '#9a3412' }}>
                {actual.publicado ? 'Publicado' : actual.estado === 'suspendido' ? 'Suspendido por la administración' : actual.estado === 'borrador' ? 'Borrador (no se ve en la búsqueda)' : 'Pausado (no se ve en la búsqueda)'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {actual.estado !== 'suspendido' ? (
                <button data-accion={actual.publicado ? 'despublicar' : 'publicar'} disabled={ocupado || (!actual.publicado && !actual.puedePublicarse)} onClick={() => void ejecutar(() => publicarMiAlojamiento(actual.id, !actual.publicado), actual.publicado ? 'Alojamiento despublicado: ya no aparece en la búsqueda.' : 'Alojamiento publicado.')} style={actual.publicado ? boton : primario} type="button">
                  {actual.publicado ? 'Despublicar' : 'Publicar'}
                </button>
              ) : null}
              <button onClick={() => setAbierto(null)} style={boton} type="button">Volver a la lista</button>
            </div>
          </div>
          <nav aria-label="Secciones del alojamiento" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {pestana('datos', 'Datos y precio')}
            {pestana('fotos', `Fotos (${actual.imagenes.length})`)}
            {pestana('disponibilidad', 'Disponibilidad')}
            {pestana('reservas', 'Reservas')}
          </nav>
          {seccion === 'datos' ? formulario : seccion === 'fotos' ? fotos : seccion === 'disponibilidad' ? disponibilidad : listaReservas}
        </section>
      ) : alojamientos.length === 0 ? (
        <div data-propietario="vacio" style={{ ...caja, textAlign: 'center', padding: '2.5rem 1rem' }}>
          <p style={{ fontSize: '1.05rem', color: '#4b5563', marginTop: 0 }}>Todavía no publicaste ningún alojamiento.</p>
          <button onClick={() => abrir(null)} style={primario} type="button">Publicar mi primer alojamiento</button>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
          {alojamientos.map((a) => (
            <li data-alojamiento-tarjeta={a.id} key={a.id} style={{ ...caja, padding: 0, overflow: 'hidden', display: 'grid' }}>
              <div style={{ height: 140, background: '#f3f4f6' }}>
                {a.imagenes[0] ? <img alt={a.nombre} src={a.imagenes[0].url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>Sin fotos</div>}
              </div>
              <div style={{ padding: '0.9rem', display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', overflowWrap: 'anywhere' }}>{a.nombre}</h3>
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 9999, padding: '2px 8px', whiteSpace: 'nowrap', background: a.publicado ? '#ecfdf5' : '#fff7ed', color: a.publicado ? '#065f46' : '#9a3412' }}>{a.publicado ? 'Publicado' : a.estado === 'suspendido' ? 'Suspendido' : a.estado === 'borrador' ? 'Borrador' : 'Pausado'}</span>
                </div>
                <span style={{ color: '#4b5563', fontSize: '0.9rem' }}>{a.tipoNombre} · {a.unidades[0]?.precioNoche ? `${pesos(a.unidades[0].precioNoche)} por noche` : 'Sin precio'}</span>
                <span style={{ color: '#4b5563', fontSize: '0.9rem' }}>{a.reservasVigentes === 0 ? 'Sin reservas vigentes' : `${a.reservasVigentes} ${a.reservasVigentes === 1 ? 'reserva vigente' : 'reservas vigentes'}`}</span>
                <button data-accion="gestionar" onClick={() => abrir(a)} style={boton} type="button">Gestionar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirmar ? (
        <div aria-labelledby="confirmar-titulo" aria-modal="true" role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}>
          <div style={{ ...caja, maxWidth: 420, width: '100%' }}>
            <h2 id="confirmar-titulo" style={{ marginTop: 0, fontSize: '1.15rem' }}>{confirmar.titulo}</h2>
            <p style={{ color: '#4b5563' }}>{confirmar.detalle}</p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button disabled={ocupado} onClick={() => setConfirmar(null)} style={boton} type="button">Volver</button>
              <button data-accion="confirmar" disabled={ocupado} onClick={() => { const { hacer } = confirmar; setConfirmar(null); void hacer() }} style={{ ...peligro, background: '#dc2626', color: '#fff' }} type="button">{confirmar.accion}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
