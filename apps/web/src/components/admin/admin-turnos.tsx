'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  CODIGO_HORARIO_NO_DISPONIBLE,
  CODIGO_HORARIO_OCUPADO,
  type ClienteTurnoAdmin,
  type ClienteTurnosDTO,
  type DetalleTurno,
  type PrestadorTurnosDTO,
  type ServicioTurnosDTO,
  type SlotDisponible,
  type TipoTurnoAdmin,
} from '@factory/contracts'

import { TurnosError, fechaTurno, horaTurno, hoyArgentina, instanteArgentina, turnosApi } from '@/lib/tus-turnos-client'
import { AdminCombobox } from './admin-combobox'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import styles from './admin-usuarios.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const TAMANO = 25

const ESTADO: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pendiente de confirmación', className: styles.badgeWarn },
  confirmed: { label: 'Confirmado', className: styles.badgeOk },
  rejected: { label: 'Rechazado', className: styles.badgeDanger },
  expired: { label: 'Vencido sin respuesta', className: styles.badgeNeutral },
  completed: { label: 'Completado', className: styles.badgeNeutral },
  cancelled: { label: 'Cancelado', className: styles.badgeDanger },
  'cancelled-late': { label: 'Cancelado tarde', className: styles.badgeDanger },
  'no-show': { label: 'No asistió', className: styles.badgeWarn },
}

const errorDe = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

// Turnos of the platform. They are reservations of the providers' calendars (the same the
// clients book); the administration can create one for a client. Providers, services and clients
// are picked by name: no internal id is typed or shown.
export function AdminTurnos(): React.ReactNode {
  const [turnos, setTurnos] = useState<DetalleTurno[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [estado, setEstado] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [prestador, setPrestador] = useState<PrestadorTurnosDTO | null>(null)
  const [pagina, setPagina] = useState(1)
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<DetalleTurno | null>(null)

  const cargar = useCallback(
    () =>
      turnosApi
        .adminListar({ estado, desde, hasta, prestadorId: prestador?.id, pagina, tamano: TAMANO })
        .then((result) => {
          setTurnos(result.items)
          setTotal(result.total)
          setTotalPaginas(result.totalPaginas)
          setError('')
        })
        .catch((cause) => {
          setTurnos([])
          setError(errorDe(cause, 'No pudimos cargar los turnos.'))
        }),
    [estado, desde, hasta, prestador, pagina]
  )

  useEffect(() => {
    void cargar()
  }, [cargar])

  const filtrando = Boolean(estado || desde || hasta || prestador)

  return (
    <>
      <AdminPageHeader subtitle="Agenda de los prestadores: turnos reservados, turnos de la administración y su auditoría" title="Turnos">
        <button
          className={styles.buttonPrimary}
          onClick={() => {
            setCreando(true)
            setAviso('')
          }}
          type="button"
        >
          + Nuevo turno
        </button>
      </AdminPageHeader>

      {aviso ? (
        <p className={styles.alertOk} role="status">
          {aviso}
        </p>
      ) : null}

      {creando ? (
        <NuevoTurno
          onCancel={() => setCreando(false)}
          onCreated={(turno) => {
            setCreando(false)
            setAviso(`Turno ${turno.forzadoFueraHorario ? 'forzado ' : ''}creado para el ${fechaTurno(turno.inicio)} a las ${horaTurno(turno.inicio)} hs.`)
            setPagina(1)
            void cargar()
          }}
        />
      ) : null}

      <section aria-label="Filtrar turnos" className={styles.panel}>
        <div className={styles.filterGrid}>
          <AdminCombobox
            label="Prestador"
            onChange={(value) => {
              setPrestador(value)
              setPagina(1)
            }}
            optionDetail={(option) => `${option.oficioPrincipal}${option.zona ? ` · ${option.zona}` : ''}`}
            optionKey={(option) => option.id}
            optionLabel={(option) => option.nombre}
            placeholder="Todos: buscá por nombre"
            search={turnosApi.adminPrestadores}
            value={prestador}
          />
          <label className={styles.field}>
            <span>Estado</span>
            <select
              onChange={(event) => {
                setEstado(event.target.value)
                setPagina(1)
              }}
              value={estado}
            >
              <option value="">Todos</option>
              <option value="pending">Pendientes de confirmación</option>
              <option value="confirmed">Confirmados</option>
              <option value="rejected">Rechazados</option>
              <option value="expired">Vencidos sin respuesta</option>
              <option value="completed">Completados</option>
              <option value="cancelled">Cancelados</option>
              <option value="no-show">No asistió</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Desde</span>
            <input
              onChange={(event) => {
                setDesde(event.target.value)
                setPagina(1)
              }}
              type="date"
              value={desde}
            />
          </label>
          <label className={styles.field}>
            <span>Hasta</span>
            <input
              onChange={(event) => {
                setHasta(event.target.value)
                setPagina(1)
              }}
              type="date"
              value={hasta}
            />
          </label>
        </div>
        <div className={styles.resultBar}>
          <span aria-live="polite" role="status">
            {turnos === null ? 'Cargando…' : `${total} ${total === 1 ? 'turno' : 'turnos'}`}
          </span>
          {filtrando ? (
            <button
              className={styles.linkButton}
              onClick={() => {
                setEstado('')
                setDesde('')
                setHasta('')
                setPrestador(null)
                setPagina(1)
              }}
              type="button"
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className={styles.alertError} role="alert">
          {error}
        </p>
      ) : null}
      {turnos && turnos.length === 0 && !error ? <AdminEmpty text={filtrando ? 'No hay turnos con esos filtros.' : 'Todavía no hay turnos.'} /> : null}
      {turnos && turnos.length > 0 ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Prestador</th>
                  <th>Servicio</th>
                  <th>Cliente</th>
                  <th>Precio</th>
                  <th>Estado</th>
                  <th>
                    <span className={styles.srOnly}>Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {turnos.map((turno) => {
                  const badge = ESTADO[turno.estado] ?? { label: turno.estado, className: styles.badgeNeutral }
                  return (
                    <tr key={turno.id}>
                      <td data-label="Fecha y hora">
                        <strong>
                          {fechaTurno(turno.inicio)} · {horaTurno(turno.inicio)} hs
                        </strong>
                        <span className={styles.sub}>{turno.duracionMinutos} min</span>
                      </td>
                      <td data-label="Prestador">{turno.prestadorNombre}</td>
                      <td data-label="Servicio">
                        {turno.oficioNombre ?? turno.tarifaNombre ?? '—'}
                        {turno.oficioNombre && turno.tarifaNombre ? <span className={styles.sub}>{turno.tarifaNombre}</span> : null}
                      </td>
                      <td data-label="Cliente">
                        {turno.clienteNombre || 'Sin nombre'}
                        <span className={styles.sub}>{turno.esInvitado ? 'Invitado' : 'Cliente registrado'}</span>
                        {turno.clienteTelefono ? <span className={styles.sub}>{turno.clienteTelefono}</span> : null}
                      </td>
                      <td data-label="Precio">
                        ${PESOS.format(turno.precioFinal ?? 0)}
                        {turno.motivoModificacionPrecio ? <span className={styles.sub}>Modificado: {turno.motivoModificacionPrecio}</span> : null}
                      </td>
                      <td data-label="Estado">
                        <span className={styles.badges}>
                          <span className={badge.className}>{badge.label}</span>
                          {turno.forzadoFueraHorario ? <span className={styles.badgeWarn}>Forzado</span> : null}
                          {turno.creadoPorAdminId && !turno.forzadoFueraHorario ? <span className={styles.badgeNeutral}>Creado por admin</span> : null}
                        </span>
                        {turno.motivoForzado ? <span className={styles.sub}>Motivo: {turno.motivoForzado}</span> : null}
                      </td>
                      <td>
                        <button className={styles.buttonSecondary} onClick={() => setEditando(turno)} type="button">
                          Editar precio
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.resultBar} style={{ borderTop: 0, paddingTop: 0 }}>
            <span>
              Página {pagina} de {totalPaginas}
            </span>
            <div className={styles.actions}>
              <button className={styles.buttonSecondary} disabled={pagina <= 1} onClick={() => setPagina((value) => value - 1)} type="button">
                ‹ Anterior
              </button>
              <button className={styles.buttonSecondary} disabled={pagina >= totalPaginas} onClick={() => setPagina((value) => value + 1)} type="button">
                Siguiente ›
              </button>
            </div>
          </div>
        </>
      ) : null}

      {editando ? (
        <EditarPrecio
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null)
            setAviso('Precio actualizado. El motivo quedó registrado.')
            void cargar()
          }}
          turno={editando}
        />
      ) : null}
    </>
  )
}

// One form for the two kinds of turno. "Turno general": only a time of the provider's real
// availability (asked to the API). "Forzar fuera de horario": any future time, with a mandatory
// reason that is audited. Neither can overlap another turno (the database refuses it).
function NuevoTurno({ onCreated, onCancel }: { onCreated: (turno: DetalleTurno) => void; onCancel: () => void }): React.ReactNode {
  const [tipo, setTipo] = useState<TipoTurnoAdmin>('general')
  const [prestador, setPrestador] = useState<PrestadorTurnosDTO | null>(null)
  const [servicios, setServicios] = useState<ServicioTurnosDTO[]>([])
  const [oficioId, setOficioId] = useState('')
  const [tarifaId, setTarifaId] = useState('')
  const [tipoCliente, setTipoCliente] = useState<'registrado' | 'invitado'>('registrado')
  const [cliente, setCliente] = useState<ClienteTurnosDTO | null>(null)
  const [invitado, setInvitado] = useState({ nombre: '', telefono: '', email: '' })
  const [fecha, setFecha] = useState(hoyArgentina)
  const [slots, setSlots] = useState<SlotDisponible[] | null>(null)
  const [mensajeSlots, setMensajeSlots] = useState('')
  const [inicio, setInicio] = useState('')
  const [hora, setHora] = useState('')
  const [motivo, setMotivo] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  const servicio = servicios.find((item) => item.oficioId === oficioId) ?? null

  // Only the services of the chosen provider.
  useEffect(() => {
    setServicios([])
    setOficioId('')
    setTarifaId('')
    if (!prestador) return
    let active = true
    turnosApi
      .adminServicios(prestador.id)
      .then((items) => {
        if (!active) return
        setServicios(items)
        if (items.length === 1) setOficioId(items[0]!.oficioId)
      })
      .catch((cause) => {
        if (active) setError(errorDe(cause, 'No pudimos cargar los servicios de ese prestador.'))
      })
    return () => {
      active = false
    }
  }, [prestador])

  // Real availability of that provider, service and day.
  useEffect(() => {
    setInicio('')
    setSlots(null)
    setMensajeSlots('')
    if (tipo !== 'general' || !prestador || !oficioId || !fecha) return
    let active = true
    turnosApi
      .adminDisponibilidad(prestador.id, oficioId, fecha)
      .then((result) => {
        if (!active) return
        setSlots(result.slots)
        setMensajeSlots(result.mensaje ?? '')
      })
      .catch((cause) => {
        if (!active) return
        setSlots([])
        setMensajeSlots(errorDe(cause, 'No pudimos consultar la disponibilidad.'))
      })
    return () => {
      active = false
    }
  }, [tipo, prestador, oficioId, fecha, version])

  async function guardar(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!prestador) return setError('Elegí el prestador.')
    if (!oficioId) return setError('Elegí el servicio.')
    const clienteTurno: ClienteTurnoAdmin | null =
      tipoCliente === 'registrado'
        ? cliente
          ? { tipo: 'registrado', cuentaId: cliente.cuentaId }
          : null
        : invitado.nombre.trim().length >= 2
          ? { tipo: 'invitado', nombre: invitado.nombre.trim(), ...(invitado.telefono.trim() ? { telefono: invitado.telefono.trim() } : {}), ...(invitado.email.trim() ? { email: invitado.email.trim() } : {}) }
          : null
    if (!clienteTurno) return setError(tipoCliente === 'registrado' ? 'Elegí el cliente.' : 'Escribí el nombre del invitado.')
    const cuando = tipo === 'general' ? inicio : fecha && hora ? instanteArgentina(fecha, hora) : ''
    if (!cuando) return setError(tipo === 'general' ? 'Elegí uno de los horarios disponibles.' : 'Elegí la fecha y la hora.')
    if (tipo === 'forzado' && motivo.trim().length < 5) return setError('Escribí el motivo (al menos 5 caracteres): queda registrado en la auditoría.')
    setGuardando(true)
    try {
      onCreated(
        await turnosApi.adminCrear({
          tipo,
          prestadorId: prestador.id,
          oficioId,
          ...(tarifaId && tipo === 'general' ? { tarifaId } : {}),
          inicio: cuando,
          cliente: clienteTurno,
          ...(tipo === 'forzado' ? { motivo: motivo.trim() } : {}),
          ...(notas.trim() ? { notas: notas.trim() } : {}),
        })
      )
    } catch (cause) {
      setError(errorDe(cause, 'No pudimos crear el turno.'))
      // Someone took the time meanwhile: show the availability again so another one is chosen.
      if (cause instanceof TurnosError && (cause.code === CODIGO_HORARIO_OCUPADO || cause.code === CODIGO_HORARIO_NO_DISPONIBLE)) setVersion((value) => value + 1)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form aria-labelledby="nuevo-turno-titulo" className={styles.panel} noValidate onSubmit={(event) => void guardar(event)}>
      <h2 id="nuevo-turno-titulo">Nuevo turno</h2>
      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>Tipo</span>
          <select onChange={(event) => setTipo(event.target.value === 'forzado' ? 'forzado' : 'general')} value={tipo}>
            <option value="general">Turno general</option>
            <option value="forzado">Forzar fuera de horario</option>
          </select>
          <span className={styles.hint}>
            {tipo === 'general'
              ? 'Usa la disponibilidad real del prestador: solo podés elegir un horario libre.'
              : 'Permite una hora fuera de la agenda publicada. Exige un motivo, que queda auditado, y nunca se superpone con otro turno.'}
          </span>
        </label>

        <AdminCombobox
          label="Prestador"
          onChange={setPrestador}
          optionDetail={(option) => `${option.oficioPrincipal}${option.zona ? ` · ${option.zona}` : ''}${option.aceptaTurnos ? '' : ' · no ofrece turnos'}`}
          optionKey={(option) => option.id}
          optionLabel={(option) => option.nombre}
          placeholder="Buscá por nombre"
          search={turnosApi.adminPrestadores}
          value={prestador}
        />

        <label className={styles.field}>
          <span>Servicio</span>
          <select disabled={!prestador || servicios.length === 0} onChange={(event) => setOficioId(event.target.value)} value={oficioId}>
            <option value="">{!prestador ? 'Primero elegí el prestador' : servicios.length === 0 ? 'Sin servicios cargados' : 'Elegí un servicio'}</option>
            {servicios.map((item) => (
              <option disabled={tipo === 'general' && !item.turnosHabilitados} key={item.oficioId} value={item.oficioId}>
                {item.nombre} · {item.duracionMinutos} min{item.turnosHabilitados ? '' : ' (sin turnos)'}
              </option>
            ))}
          </select>
        </label>

        {tipo === 'general' && servicio && servicio.tarifas.length > 0 ? (
          <label className={`${styles.field} ${styles.wide}`}>
            <span>Tarifa</span>
            <select onChange={(event) => setTarifaId(event.target.value)} value={tarifaId}>
              <option value="">Tarifa principal</option>
              {servicio.tarifas.map((tarifa) => (
                <option key={tarifa.id} value={tarifa.id}>
                  {tarifa.nombre} · {tarifa.duracionMinutos} min · ${PESOS.format(tarifa.precio)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className={`${styles.field} ${styles.wide}`}>
          <span id="nuevo-turno-cliente">Cliente</span>
          <div aria-labelledby="nuevo-turno-cliente" className={styles.segmented} role="group">
            <button aria-pressed={tipoCliente === 'registrado'} onClick={() => setTipoCliente('registrado')} type="button">
              Cliente registrado
            </button>
            <button aria-pressed={tipoCliente === 'invitado'} onClick={() => setTipoCliente('invitado')} type="button">
              Invitado (sin cuenta)
            </button>
          </div>
        </div>

        {tipoCliente === 'registrado' ? (
          <div className={styles.wide}>
            <AdminCombobox
              label="Buscar cliente"
              minLength={2}
              onChange={setCliente}
              optionDetail={(option) => `${option.email}${option.telefono ? ` · ${option.telefono}` : ''}`}
              optionKey={(option) => option.cuentaId}
              optionLabel={(option) => option.nombre}
              placeholder="Nombre, email o teléfono"
              search={turnosApi.adminClientes}
              value={cliente}
            />
          </div>
        ) : (
          <>
            <label className={`${styles.field} ${styles.wide}`}>
              <span>Nombre del invitado</span>
              <input maxLength={120} onChange={(event) => setInvitado({ ...invitado, nombre: event.target.value })} value={invitado.nombre} />
            </label>
            <label className={styles.field}>
              <span>
                Teléfono <span className={styles.hint}>(opcional)</span>
              </span>
              <input inputMode="tel" maxLength={32} onChange={(event) => setInvitado({ ...invitado, telefono: event.target.value })} type="tel" value={invitado.telefono} />
            </label>
            <label className={styles.field}>
              <span>
                Email <span className={styles.hint}>(opcional)</span>
              </span>
              <input maxLength={254} onChange={(event) => setInvitado({ ...invitado, email: event.target.value })} type="email" value={invitado.email} />
            </label>
          </>
        )}

        <label className={styles.field}>
          <span>Fecha</span>
          <input min={hoyArgentina()} onChange={(event) => setFecha(event.target.value)} type="date" value={fecha} />
        </label>

        {tipo === 'forzado' ? (
          <label className={styles.field}>
            <span>Hora</span>
            <input onChange={(event) => setHora(event.target.value)} step={300} type="time" value={hora} />
          </label>
        ) : null}

        {tipo === 'general' ? (
          <div className={`${styles.field} ${styles.wide}`}>
            <span id="nuevo-turno-horarios">Horario</span>
            {!prestador || !oficioId ? (
              <span className={styles.hint}>Elegí prestador y servicio para ver los horarios disponibles.</span>
            ) : slots === null ? (
              <span className={styles.hint} role="status">
                Consultando disponibilidad…
              </span>
            ) : slots.length === 0 ? (
              <span className={styles.hint}>{mensajeSlots || 'No hay horarios disponibles ese día. Probá otra fecha.'}</span>
            ) : (
              <div aria-labelledby="nuevo-turno-horarios" className={styles.slots} role="group">
                {slots.map((slot) => (
                  <button aria-pressed={inicio === slot.inicio} className={styles.slot} key={slot.inicio} onClick={() => setInicio(slot.inicio)} type="button">
                    {horaTurno(slot.inicio)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <label className={`${styles.field} ${styles.wide}`}>
            <span>Motivo del turno forzado</span>
            <textarea maxLength={300} onChange={(event) => setMotivo(event.target.value)} placeholder="Por qué se agenda fuera del horario publicado" value={motivo} />
            <span className={styles.hint}>Obligatorio. Queda registrado en la auditoría junto con tu usuario.</span>
          </label>
        )}

        <label className={`${styles.field} ${styles.wide}`}>
          <span>
            Notas <span className={styles.hint}>(opcional)</span>
          </span>
          <input maxLength={300} onChange={(event) => setNotas(event.target.value)} value={notas} />
        </label>
      </div>

      {error ? (
        <p className={styles.alertError} role="alert" style={{ marginBottom: 0 }}>
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button className={styles.buttonPrimary} disabled={guardando} type="submit">
          {guardando ? 'Guardando…' : tipo === 'general' ? 'Crear turno' : 'Forzar turno'}
        </button>
        <button className={styles.buttonSecondary} onClick={onCancel} type="button">
          Cancelar
        </button>
      </div>
    </form>
  )
}

function EditarPrecio({ turno, onSaved, onClose }: { turno: DetalleTurno; onSaved: () => void; onClose: () => void }): React.ReactNode {
  const [precio, setPrecio] = useState(String(turno.precioFinal ?? ''))
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar(event: FormEvent) {
    event.preventDefault()
    const valor = Number(precio)
    if (!Number.isInteger(valor) || valor < 0) return setError('Ingresá el precio en pesos, sin decimales.')
    if (motivo.trim().length < 5) return setError('Escribí el motivo (al menos 5 caracteres): queda registrado en la auditoría.')
    setGuardando(true)
    setError('')
    try {
      await turnosApi.adminPrecio(turno.id, valor, motivo.trim())
      onSaved()
    } catch (cause) {
      setError(errorDe(cause, 'No pudimos modificar el precio.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form aria-labelledby="editar-precio-titulo" className={styles.panel} noValidate onSubmit={(event) => void guardar(event)}>
      <h2 id="editar-precio-titulo">Modificar precio del turno</h2>
      <p className={styles.muted}>
        {turno.prestadorNombre} · {turno.clienteNombre || 'Sin nombre'} · {fechaTurno(turno.inicio)} {horaTurno(turno.inicio)} hs
      </p>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Precio final ($ ARS)</span>
          <input inputMode="numeric" min={0} onChange={(event) => setPrecio(event.target.value)} type="number" value={precio} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>Motivo</span>
          <textarea maxLength={300} onChange={(event) => setMotivo(event.target.value)} placeholder="Por qué se modifica el precio" value={motivo} />
          <span className={styles.hint}>Obligatorio. Queda registrado en la auditoría.</span>
        </label>
      </div>
      {error ? (
        <p className={styles.alertError} role="alert" style={{ marginBottom: 0 }}>
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button className={styles.buttonPrimary} disabled={guardando} type="submit">
          {guardando ? 'Guardando…' : 'Guardar y auditar'}
        </button>
        <button className={styles.buttonSecondary} onClick={onClose} type="button">
          Cancelar
        </button>
      </div>
    </form>
  )
}
