'use client'

import { FotosTurno } from '../turnos/fotos-turno'
import { useState, useEffect, useCallback, useRef } from 'react'
import { CODIGO_SOLICITUD_SIN_HORARIO, etiquetaEstadoTurno, etiquetaSenaTurno, formatearPesos, normalizarTelefono, type DetalleTurno, type FranjaAgenda, type ServicioTurnosDTO, type TurnoDeFranja } from '@factory/contracts'
import { TurnosError, diaTurno, horaTurno, turnosApi, turnosErrorDe, turnosFetch } from '../../lib/tus-turnos-client'
import { etiquetaTurnoDeFranja } from '../turnos/agenda-semanal'
import { claseEstadoTurno } from '../turnos/estado-turno'
import { ProviderAvailability } from './provider-availability'
import homeStyles from '../home/home.module.css'
import styles from '../directory/directory.module.css'

const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function ProviderTurnos(): React.ReactNode {
  const [turnos, setTurnos] = useState<DetalleTurno[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  // Requests of clients waiting for this provider's answer: accepting opens the deposit payment.
  const [solicitudes, setSolicitudes] = useState<DetalleTurno[]>([])
  const [respondiendo, setRespondiendo] = useState<string | null>(null)
  const [avisoSolicitud, setAvisoSolicitud] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  // Modal turno manual
  const [modalManual, setModalManual] = useState(false)
  const [manualOficio, setManualOficio] = useState('')
  const [manualInicio, setManualInicio] = useState('')
  const [manualCliente, setManualCliente] = useState('')
  const [manualTelefono, setManualTelefono] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [manualPrecio, setManualPrecio] = useState('')
  const [manualNotas, setManualNotas] = useState('')
  const [guardandoManual, setGuardandoManual] = useState(false)
  const [errorManual, setErrorManual] = useState<string | null>(null)
  // AGENDA-MATRIZ-01. The manual turno may be linked to an existing client of TUS, found by its
  // WHOLE phone number (the API never searches by name nor by a part of anything). The provider
  // chooses the match; nothing is linked by itself.
  const [coincidencias, setCoincidencias] = useState<{ cuentaId: string; nombre: string }[] | null>(null)
  const [vinculo, setVinculo] = useState<{ cuentaId: string; nombre: string } | null>(null)
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const busquedaCliente = useRef(0)
  const dialogoManual = useRef<HTMLDialogElement>(null)
  const invalidarCliente = () => { busquedaCliente.current += 1; setCoincidencias(null); setVinculo(null); setBuscandoCliente(false) }
  const limpiarManual = () => { invalidarCliente(); setManualCliente(''); setManualTelefono(''); setManualEmail(''); setManualPrecio(''); setManualNotas(''); setErrorManual(null) }
  const cerrarManual = () => { invalidarCliente(); setModalManual(false) }
  useEffect(() => {
    const dialogo = dialogoManual.current
    if (modalManual && dialogo && !dialogo.open) dialogo.showModal()
    return () => { busquedaCliente.current += 1; dialogo?.close() }
  }, [modalManual])
  // The turno of the agenda the provider tapped.
  const [detalle, setDetalle] = useState<{ turno: TurnoDeFranja; franja: FranjaAgenda } | null>(null)
  const horaLocal = (iso: string) => new Date(Date.parse(iso) - 3 * 60 * 60_000).toISOString().slice(0, 16)
  function abrirManualEn(franja: FranjaAgenda, oficioId: string) {
    setManualOficio(oficioId)
    setManualInicio(horaLocal(franja.inicio))
    limpiarManual()
    setDetalle(null)
    setModalManual(true)
  }
  async function buscarCliente() {
    const pedido = ++busquedaCliente.current
    setBuscandoCliente(true)
    setErrorManual(null)
    setVinculo(null)
    setCoincidencias(null)
    try {
      const respuesta = await turnosApi.buscarClienteTurno({ telefono: manualTelefono.trim(), email: manualEmail.trim() })
      if (pedido === busquedaCliente.current) setCoincidencias(respuesta.items)
    } catch (causa: unknown) {
      if (pedido !== busquedaCliente.current) return
      setCoincidencias(null)
      setErrorManual(causa instanceof Error ? causa.message : 'No pudimos buscar el cliente.')
    } finally {
      if (pedido === busquedaCliente.current) setBuscandoCliente(false)
    }
  }

  // Modal bloqueo
  const [modalBloqueo, setModalBloqueo] = useState(false)
  const [bloqueoInicio, setBloqueoInicio] = useState('')
  const [bloqueoFin, setBloqueoFin] = useState('')
  const [bloqueoMotivo, setBloqueoMotivo] = useState('')
  const [guardandoBloqueo, setGuardandoBloqueo] = useState(false)
  const [errorBloqueo, setErrorBloqueo] = useState<string | null>(null)
  // Own services (from the API): the manual turno picks one of them, never a typed id.
  const [servicios, setServicios] = useState<ServicioTurnosDTO[]>([])
  // Bumped when a turno or a block changes: the weekly agenda above is asked again.
  const [versionAgenda, setVersionAgenda] = useState(0)
  useEffect(() => {
    void turnosApi.misServicios().then(setServicios).catch(() => setServicios([]))
  }, [])
  // TURNOS-REPROGRAMACION-01: the provider's own switch (saved by the API before it shows).
  const [permiteReprogramar, setPermiteReprogramar] = useState<boolean | null>(null)
  const [guardandoReprogramar, setGuardandoReprogramar] = useState(false)
  useEffect(() => {
    void turnosApi.miReprogramacion().then((valor) => setPermiteReprogramar(valor.permite)).catch(() => setPermiteReprogramar(null))
  }, [])
  async function cambiarReprogramacion(permite: boolean) {
    setGuardandoReprogramar(true)
    try {
      setPermiteReprogramar((await turnosApi.guardarMiReprogramacion(permite)).permite)
    } catch {
      // It stays as the API has it.
    } finally {
      setGuardandoReprogramar(false)
    }
  }

  const cargarTurnos = useCallback(() => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (filtroEstado) params.set('estado', filtroEstado)

    turnosFetch(`/tus/v1/prestador/turnos?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw await turnosErrorDe(res, 'No se pudieron cargar tus turnos')
        return res.json()
      })
      .then((data) => {
        setTurnos(data.items || [])
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [filtroEstado])

  const cargarSolicitudes = useCallback(() => {
    turnosApi
      .misSolicitudes()
      .then((resultado) => setSolicitudes(resultado.items))
      .catch(() => setSolicitudes([]))
  }, [])

  useEffect(() => {
    cargarTurnos()
  }, [cargarTurnos])

  useEffect(() => {
    cargarSolicitudes()
  }, [cargarSolicitudes])

  async function responder(solicitud: DetalleTurno, aceptar: boolean) {
    setRespondiendo(solicitud.id)
    setAvisoSolicitud(null)
    try {
      const turno = aceptar ? await turnosApi.aceptarSolicitud(solicitud.id) : await turnosApi.rechazarSolicitud(solicitud.id)
      // Accepting does not confirm a turno with a deposit: it waits for the client's payment.
      const detalle = turno.estado === 'awaiting_payment' ? ' Queda esperando que el cliente abone la seña; se confirma cuando Mercado Pago acredite el pago.' : ''
      setAvisoSolicitud({ tipo: 'ok', texto: `${etiquetaEstadoTurno(turno.estado)}: turno de ${solicitud.clienteNombre ?? 'el cliente'} del ${diaTurno(solicitud.inicio)} a las ${horaTurno(solicitud.inicio)} hs.${detalle}` })
    } catch (err: unknown) {
      // CODIGO_SOLICITUD_SIN_HORARIO: the time was no longer free and the API already stored the
      // request as rejected; the message says so.
      setAvisoSolicitud({ tipo: 'error', texto: err instanceof TurnosError && err.code === CODIGO_SOLICITUD_SIN_HORARIO ? err.message : err instanceof Error ? err.message : 'No pudimos responder la solicitud.' })
    } finally {
      setRespondiendo(null)
      cargarSolicitudes()
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    }
  }

  // CIERRE-TRABAJO-01. A turno paid through TUS is finished with a note of what was done; the
  // client then confirms it (or TUS does when its 72 hours run out).
  const [finalizando, setFinalizando] = useState<string | null>(null)
  const [evidencia, setEvidencia] = useState('')
  const [enviandoCierre, setEnviandoCierre] = useState(false)
  async function finalizar(id: string) {
    setEnviandoCierre(true)
    setError(null)
    try {
      await turnosApi.finalizarTurno(id, evidencia.trim())
      setFinalizando(null)
      setEvidencia('')
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar la finalización.')
    } finally {
      setEnviandoCierre(false)
    }
  }

  async function cambiarEstado(id: string, nuevoEstado: string) {
    try {
      const res = await turnosFetch(`/tus/v1/prestador/turnos/${encodeURIComponent(id)}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      })
      if (!res.ok) throw await turnosErrorDe(res, 'No pudimos actualizar el turno.')
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No pudimos actualizar el turno.')
    }
  }

  async function handleCrearManual(e: React.FormEvent) {
    e.preventDefault()
    if (!manualOficio || !manualInicio || (!vinculo && !manualCliente.trim())) {
      setErrorManual('Servicio, inicio y nombre de cliente son obligatorios.')
      return
    }
    // The same rules the API applies (it is the authority): each problem names its field.
    const nombreCliente = (vinculo?.nombre ?? manualCliente).replace(/\s+/gu, ' ').trim()
    if (nombreCliente.length < 2 || nombreCliente.length > 120) {
      setErrorManual('Nombre del cliente: ingresá entre 2 y 120 caracteres.')
      return
    }
    if (manualTelefono.trim() && !normalizarTelefono(manualTelefono).ok) {
      setErrorManual('Teléfono: ingresalo con código de área, por ejemplo 3794 123456.')
      return
    }
    if (manualPrecio.trim() && !/^\d{1,9}$/u.test(manualPrecio.trim())) {
      setErrorManual('Precio final: ingresá un número entero de pesos, sin decimales ni signos.')
      return
    }
    if (manualNotas.trim().length > 500) {
      setErrorManual('Notas: hasta 500 caracteres.')
      return
    }

    setGuardandoManual(true)
    setErrorManual(null)

    try {
      const res = await turnosFetch('/tus/v1/prestador/turnos/manual', {
        method: 'POST',
        body: JSON.stringify({
          oficioId: manualOficio.trim(),
          // The field is Argentina local time; the API stores the instant.
          inicio: new Date(`${manualInicio}:00.000-03:00`).toISOString(),
          clienteNombre: nombreCliente,
          clienteTelefono: manualTelefono.trim() || undefined,
          clienteEmail: manualEmail.trim() || undefined,
          ...(vinculo ? { clienteCuentaId: vinculo.cuentaId } : {}),
          precioFinal: manualPrecio.trim() ? Number(manualPrecio.trim()) : undefined,
          notas: manualNotas.trim() || undefined,
        }),
      })

      if (!res.ok) throw await turnosErrorDe(res, 'No se pudo crear el turno manual')

      cerrarManual()
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    } catch (err: unknown) {
      setErrorManual(err instanceof Error ? err.message : 'Error inesperado')
      if (err instanceof TurnosError && err.status === 409) setVersionAgenda((value) => value + 1)
      if (err instanceof TurnosError && err.code === 'CLIENT_NOT_FOUND') invalidarCliente()
    } finally {
      setGuardandoManual(false)
    }
  }

  async function handleBloquear(e: React.FormEvent) {
    e.preventDefault()
    if (!bloqueoInicio || !bloqueoFin) {
      setErrorBloqueo('Inicio y fin son obligatorios.')
      return
    }
    if (bloqueoFin <= bloqueoInicio) {
      setErrorBloqueo('Fin: debe ser posterior al inicio.')
      return
    }
    if (bloqueoMotivo.trim().length > 200) {
      setErrorBloqueo('Motivo: hasta 200 caracteres.')
      return
    }

    setGuardandoBloqueo(true)
    setErrorBloqueo(null)

    try {
      const res = await turnosFetch('/tus/v1/prestador/turnos/bloquear', {
        method: 'POST',
        body: JSON.stringify({
          inicio: new Date(`${bloqueoInicio}:00.000-03:00`).toISOString(),
          fin: new Date(`${bloqueoFin}:00.000-03:00`).toISOString(),
          motivo: bloqueoMotivo.trim() || 'Bloqueo manual de horario',
        }),
      })

      if (!res.ok) throw await turnosErrorDe(res, 'No se pudo registrar el bloqueo')

      setModalBloqueo(false)
      cargarTurnos()
      setVersionAgenda((value) => value + 1)
    } catch (err: unknown) {
      setErrorBloqueo(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setGuardandoBloqueo(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {permiteReprogramar !== null ? (
        <section aria-label="Reprogramación de turnos" className={styles.panel} data-reprogramacion-prestador>
          <label style={{ alignItems: 'flex-start', display: 'flex', gap: 10 }}>
            <input checked={permiteReprogramar} data-permite-reprogramacion disabled={guardandoReprogramar} onChange={(event) => void cambiarReprogramacion(event.target.checked)} style={{ marginTop: 4 }} type="checkbox" />
            <span>
              <strong>Permitir reprogramación de turnos</strong>
              <span className={styles.muted} style={{ display: 'block', fontSize: '0.9rem' }}>
                Tus clientes van a poder mover su turno a otro horario libre de tu agenda, hasta 24 horas antes. No tenés que aceptar nada: te avisamos el cambio. Vale para los turnos que se reserven desde ahora; los que ya existen conservan la condición con la que se reservaron.
              </span>
            </span>
          </label>
        </section>
      ) : null}
      {/* Solicitudes de reserva: lo que los clientes pidieron y espera la respuesta del prestador */}
      <section aria-labelledby="solicitudes-reserva" className={styles.panel} data-solicitudes>
        <h2 className={styles.panelTitle} id="solicitudes-reserva">
          Solicitudes de reserva{solicitudes.length > 0 ? ` (${solicitudes.length})` : ''}
        </h2>
        {avisoSolicitud ? (
          <p className={styles.notice} role={avisoSolicitud.tipo === 'error' ? 'alert' : 'status'} style={{ marginBottom: 12 }}>
            {avisoSolicitud.texto}
          </p>
        ) : null}
        {solicitudes.length === 0 ? (
          <p className={styles.muted} style={{ margin: 0 }}>
            No tenés solicitudes pendientes. Cuando un cliente pida un turno aparece acá para que la aceptes o la rechaces.
          </p>
        ) : (
          <div className={styles.turnoList}>
            {solicitudes.map((solicitud) => (
              <article className={`${styles.panel} ${styles.turnoCard} ${styles.turnoCardNew}`} data-solicitud={solicitud.id} key={solicitud.id}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <strong>Nueva solicitud</strong>
                  <FotosTurno cantidad={solicitud.imagenes ?? 0} turnoId={solicitud.id} />
                  <dl className={styles.turnoData}>
                    <div>
                      <dt>Cliente:</dt>
                      <dd>{solicitud.clienteNombre ?? 'Cliente de TUS'}</dd>
                    </div>
                    <div>
                      <dt>Servicio:</dt>
                      <dd>{[solicitud.oficioNombre, solicitud.tarifaNombre].filter((nombre, indice, lista) => nombre && lista.indexOf(nombre) === indice).join(' · ') || 'Turno'}</dd>
                    </div>
                    {solicitud.precioFinal != null && solicitud.precioFinal > 0 ? (
                      <div>
                        <dt>Precio:</dt>
                        <dd>
                          {formatearPesos(solicitud.precioFinal)}
                          {solicitud.sena ? ` · seña ${formatearPesos(solicitud.sena.monto)} (la abona el cliente cuando aceptes)` : ''}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Fecha:</dt>
                      <dd>{diaTurno(solicitud.inicio)}</dd>
                    </div>
                    <div>
                      <dt>Horario:</dt>
                      <dd>{horaTurno(solicitud.inicio)}</dd>
                    </div>
                    <div>
                      <dt>Duración:</dt>
                      <dd>{solicitud.duracionMinutos} minutos</dd>
                    </div>
                    {solicitud.notas ? (
                      <div>
                        <dt>Nota:</dt>
                        <dd>{solicitud.notas}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <span className={claseEstadoTurno(solicitud.estado)} style={{ justifySelf: 'start' }}>
                    {etiquetaEstadoTurno(solicitud.estado)}
                  </span>
                </div>
                <div className={styles.turnoActions}>
                  <button className={homeStyles.buttonSecondary} disabled={respondiendo === solicitud.id} onClick={() => void responder(solicitud, false)} type="button">
                    Rechazar
                  </button>
                  <button className={homeStyles.buttonPrimary} disabled={respondiendo === solicitud.id} onClick={() => void responder(solicitud, true)} type="button">
                    {respondiendo === solicitud.id ? 'Guardando…' : 'Aceptar'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Disponibilidad semanal (intervalo, días y horarios) y la agenda que ven los clientes */}
      <ProviderAvailability onServicios={() => void turnosApi.misServicios().then(setServicios).catch(() => undefined)} onLibre={abrirManualEn} onTurno={(turno, franja) => setDetalle({ turno, franja })} servicios={servicios} version={versionAgenda} />
      {detalle ? (
        <section aria-label="Detalle del turno" className={styles.panel} data-turno-detalle={detalle.turno.id}>
          <h2 className={styles.panelTitle}>Detalle del turno</h2>
          <p style={{ margin: 0 }}>
             <strong>{diaTurno(detalle.turno.inicio)} a las {horaTurno(detalle.turno.inicio)} — {horaTurno(detalle.turno.fin)}</strong>
          </p>
          <p style={{ margin: '4px 0 0' }}>
            {etiquetaTurnoDeFranja(detalle.turno)}
            {detalle.turno.cliente ? ` · ${detalle.turno.cliente}` : ''}
          </p>
          <p className={styles.muted} style={{ fontSize: '0.9rem', margin: '4px 0 0' }}>
            {detalle.turno.origen === 'manual' ? 'Turno manual: lo cargaste vos en tu agenda. No tiene pago por TUS.' : 'Turno pedido por TUS.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <button className={homeStyles.buttonSecondary} data-ver-en-lista onClick={() => document.querySelector(`[data-turno-fila="${detalle.turno.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} type="button">
              Ver en la lista
            </button>
            <button className={homeStyles.buttonSecondary} onClick={() => setDetalle(null)} type="button">
              Cerrar
            </button>
          </div>
        </section>
      ) : null}

      {/* Botones de acción principales */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: '0.9rem', fontWeight: 600 }}>Filtrar:</label>
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #d1d5db', minHeight: 40 }}
          >
            <option value="">Todos</option>
            <option value="pending">Pendientes de respuesta</option>
            <option value="awaiting_payment">Esperando pago de seña</option>
            <option value="confirmed">Confirmados</option>
            <option value="rejected">Rechazados</option>
            <option value="completed">Completados</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={homeStyles.buttonPrimary}
            onClick={() => {
              limpiarManual()
              setManualOficio(servicios.find((item) => item.turnosHabilitados)?.oficioId ?? '')
              setManualInicio('')
              setModalManual(true)
            }}
          >
            + Turno manual
          </button>
          <button
            type="button"
            className={homeStyles.buttonSecondary}
            onClick={() => {
              setModalBloqueo(true)
              setErrorBloqueo(null)
            }}
          >
            Bloquear horario
          </button>
        </div>
      </div>

      {/* Lista de turnos */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando agenda de turnos...</div>
      ) : error ? (
        <div role="alert" style={{ background: '#fee2e2', color: '#dc2626', padding: 16, borderRadius: 'var(--tus-control-radius)' }}>{error}</div>
      ) : turnos.length === 0 ? (
        <div className={styles.panel} style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
          No tenés turnos registrados con este filtro. Podés agendar uno manualmente o esperar solicitudes de clientes.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {turnos.map((t) => {
            const fecha = new Date(t.inicio).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
            const horaInicio = horaTurno(t.inicio)
            const horaFin = horaTurno(t.fin)

            return (
              <div key={t.id} className={styles.panel} data-turno-fila={t.id} data-turno-origen={t.origen ?? 'tus'} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                    {fecha} · {horaInicio} a {horaFin} hs
                  </div>
                  <div style={{ color: '#4b5563', fontSize: '0.9rem', marginTop: 2 }}>
                    Cliente: <strong>{t.clienteNombre || 'Cliente'}</strong> {t.clienteTelefono ? `(${t.clienteTelefono})` : ''}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                    {t.oficioNombre || t.tarifaNombre || t.oficioId} · {t.duracionMinutos} min · ${PESOS.format(t.precioFinal ?? 0)}
                    {t.sena ? ` · Seña ${formatearPesos(t.sena.monto)}: ${etiquetaSenaTurno(t.sena.estado)}` : ''}
                  </div>
                  {t.pago && t.pago.pagado > 0 ? (
                    <div data-turno-cobro={t.pago.fondos ?? 'sin-fondos'} style={{ color: '#374151', fontSize: '0.85rem', marginTop: 2 }}>
                      Cobrado por TUS: <strong>{formatearPesos(t.pago.pagado)}</strong> de {formatearPesos(t.pago.total)}
                      {t.pago.saldoPendiente > 0 ? ` · Saldo pendiente del cliente: ${formatearPesos(t.pago.saldoPendiente)}` : ''}
                      {t.pago.fondos === 'retenidos' ? ' · Retenido hasta que el turno se cierre y esté pagado por completo' : t.pago.fondos === 'liberados' ? ' · Liberado: ya está en tus ganancias disponibles' : ''}
                    </div>
                  ) : null}
                  {t.pago?.cierre ? (
                    <div data-turno-cierre={t.pago.cierre.observacionAbierta ? 'observado' : t.pago.cierre.confirmadoEn ? 'confirmado' : 'esperando'} style={{ color: '#374151', fontSize: '0.85rem', marginTop: 2 }}>
                      {t.pago.cierre.observacionAbierta
                        ? 'El cliente reportó un problema. TUS lo está revisando; los fondos siguen retenidos.'
                        : t.pago.cierre.confirmadoEn
                          ? t.pago.cierre.confirmacionOrigen === 'automatica' ? 'Confirmado automáticamente al vencer el plazo del cliente.' : 'El cliente confirmó que se realizó.'
                          : `Finalizado. Esperando la confirmación del cliente (se confirma solo el ${new Date(t.pago.cierre.confirmacionVenceEn).toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })}).`}
                    </div>
                  ) : null}
                  {finalizando === t.id ? (
                    <label style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Contá qué se hizo (lo ve el cliente y queda como evidencia)</span>
                      <textarea maxLength={1000} onChange={(event) => setEvidencia(event.target.value)} rows={3} value={evidencia} />
                    </label>
                  ) : null}
                  {t.notas ? <div style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 4 }}>Nota: {t.notas}</div> : null}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span className={claseEstadoTurno(t.estado)}>{etiquetaEstadoTurno(t.estado)}</span>
                  <span data-origen={t.origen ?? 'tus'} style={{ border: '1px solid #d1d5db', borderRadius: 999, color: '#374151', fontSize: '0.75rem', padding: '2px 8px' }}>{t.origen === 'manual' ? 'Manual' : 'TUS'}</span>

                  {t.estado === 'confirmed' && t.pago && t.pago.pagado > 0 ? (
                    finalizando === t.id ? (
                      <>
                        <button className={homeStyles.buttonPrimary} disabled={enviandoCierre || evidencia.trim().length < 10} onClick={() => void finalizar(t.id)} type="button">
                          {enviandoCierre ? 'Guardando…' : 'Confirmar finalización'}
                        </button>
                        <button className={homeStyles.buttonSecondary} onClick={() => { setFinalizando(null); setEvidencia('') }} type="button">
                          Volver
                        </button>
                      </>
                    ) : t.pago.cierre ? null : Date.parse(t.inicio) <= Date.now() ? (
                      <button className={homeStyles.buttonPrimary} data-finalizar onClick={() => { setFinalizando(t.id); setEvidencia('') }} type="button">
                        Finalizar turno
                      </button>
                    ) : null
                  ) : t.estado === 'confirmed' ? (
                    <button
                      type="button"
                      onClick={() => cambiarEstado(t.id, 'completed')}
                      style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #22c55e', background: '#f0fdf4', color: '#15803d', fontSize: '0.85rem', cursor: 'pointer' }}
                    >
                      ✓ Completado
                    </button>
                  ) : null}
                  {(t.estado === 'confirmed' || t.estado === 'awaiting_payment') && !t.pago?.cierre ? (
                    <button
                      type="button"
                      onClick={() => cambiarEstado(t.id, 'cancelled')}
                      style={{ padding: '6px 10px', borderRadius: 'var(--tus-control-radius)', border: '1px solid #ef4444', background: '#fef2f2', color: '#b91c1c', fontSize: '0.85rem', cursor: 'pointer' }}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal turno manual */}
      {modalManual && (
          <dialog aria-labelledby="turno-manual-titulo" className={styles.modalCard} onCancel={(event) => { if (guardandoManual) event.preventDefault(); else cerrarManual() }} ref={dialogoManual}>
            <h2 id="turno-manual-titulo" style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 12px 0' }}>Nuevo turno manual</h2>
            <form onSubmit={handleCrearManual} style={{ display: 'grid', gap: 12 }}>
              <div>
                <label htmlFor="manual-oficio" style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Oficio / Servicio *</label>
                <select className={styles.bookingControl} id="manual-oficio" onChange={(e) => setManualOficio(e.target.value)} required value={manualOficio}>
                  <option value="">Elegí uno de tus servicios</option>
                  {servicios.map((item) => (
                    <option key={item.oficioId} value={item.oficioId}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="manual-inicio" style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Fecha y hora de inicio *</label>
                <input
                  id="manual-inicio"
                  type="datetime-local"
                  required
                  value={manualInicio}
                  onChange={(e) => setManualInicio(e.target.value)}
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label htmlFor="manual-cliente" style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Nombre Cliente *</label>
                <input
                  id="manual-cliente"
                  disabled={vinculo !== null}
                  type="text"
                  required
                  value={vinculo?.nombre ?? manualCliente}
                  onChange={(e) => setManualCliente(e.target.value)}
                  placeholder="Nombre y apellido"
                  minLength={2}
                  maxLength={120}
                  autoComplete="off"
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label htmlFor="manual-telefono" style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Teléfono</label>
                <input
                  id="manual-telefono"
                  type="tel"
                  inputMode="tel"
                  value={manualTelefono}
                  onChange={(e) => { setManualTelefono(e.target.value); invalidarCliente() }}
                  placeholder="3794 123456"
                  maxLength={40}
                  autoComplete="off"
                  className={styles.bookingControl}
                />
                <label htmlFor="manual-email" style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', margin: '8px 0 4px' }}>Email</label>
                <input className={styles.bookingControl} id="manual-email" maxLength={254} onChange={(event) => { setManualEmail(event.target.value); invalidarCliente() }} type="email" value={manualEmail} />
                {/* AGENDA-MATRIZ-01: link the turno to an existing client of TUS (optional). */}
                <div data-vincular-cliente style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                  <button className={homeStyles.buttonSecondary} data-buscar-cliente disabled={buscandoCliente || (!manualTelefono.trim() && !manualEmail.trim())} onClick={() => void buscarCliente()} style={{ justifySelf: 'start' }} type="button">
                    {buscandoCliente ? 'Buscando…' : 'Buscar cliente de TUS por celular o email'}
                  </button>
                  {coincidencias !== null && coincidencias.length === 0 ? <span data-sin-coincidencias style={{ color: '#6b7280', fontSize: '0.85rem' }}>No hay un cliente activo de TUS con esos datos verificados. El turno queda con el contacto que cargues acá.</span> : null}
                  {coincidencias !== null && coincidencias.length > 0 ? (
                    <fieldset style={{ border: 0, display: 'grid', gap: 4, margin: 0, padding: 0 }}>
                      <legend style={{ fontSize: '0.85rem', padding: 0 }}>{coincidencias.length === 1 ? 'Encontramos este cliente:' : 'Hay más de un cliente con ese dato. Elegí cuál es:'}</legend>
                      {coincidencias.map((item) => (
                        <label key={item.cuentaId} style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                          <input checked={vinculo?.cuentaId === item.cuentaId} data-coincidencia={item.cuentaId} name="cliente-vinculado" onChange={() => setVinculo(item)} type="radio" />
                          {item.nombre}
                        </label>
                      ))}
                      <label style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                        <input checked={vinculo === null} name="cliente-vinculado" onChange={() => setVinculo(null)} type="radio" />
                        No vincular (solo el contacto que cargo acá)
                      </label>
                      {vinculo ? <span data-vinculado style={{ color: '#065f46', fontSize: '0.85rem' }}>El turno le va a aparecer a {vinculo.nombre} en “Mis turnos”. No se le cobra nada por TUS.</span> : null}
                    </fieldset>
                  ) : null}
                </div>
              </div>

              <div>
                <label htmlFor="manual-precio" style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Precio final ($ ARS)</label>
                <input
                  id="manual-precio"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={9}
                  value={manualPrecio}
                  onChange={(e) => setManualPrecio(e.target.value.replace(/\D/gu, ''))}
                  placeholder="ej. 25000"
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label htmlFor="manual-notas" style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Notas / Observaciones</label>
                <textarea
                  id="manual-notas"
                  rows={2}
                  value={manualNotas}
                  onChange={(e) => setManualNotas(e.target.value)}
                  placeholder="Detalles sobre el turno o trabajo..."
                  maxLength={500}
                  className={styles.bookingControl}
                  style={{ minHeight: 80, resize: 'vertical' }}
                />
              </div>

              {errorManual && (
                <div role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', background: '#fee2e2', padding: '8px 12px', borderRadius: 'var(--tus-control-radius)' }}>
                  {errorManual}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  disabled={guardandoManual}
                  onClick={cerrarManual}
                  className={homeStyles.buttonSecondary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoManual}
                  className={homeStyles.buttonPrimary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  {guardandoManual ? 'Guardando...' : 'Crear turno'}
                </button>
              </div>
            </form>
          </dialog>
      )}

      {/* Modal bloqueo */}
      {modalBloqueo && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 12px 0' }}>Bloquear horario / Vacaciones</h2>
            <form onSubmit={handleBloquear} style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Desde *</label>
                <input
                  type="datetime-local"
                  required
                  value={bloqueoInicio}
                  onChange={(e) => setBloqueoInicio(e.target.value)}
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Hasta *</label>
                <input
                  type="datetime-local"
                  required
                  value={bloqueoFin}
                  onChange={(e) => setBloqueoFin(e.target.value)}
                  className={styles.bookingControl}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Motivo</label>
                <input
                  type="text"
                  value={bloqueoMotivo}
                  onChange={(e) => setBloqueoMotivo(e.target.value)}
                  placeholder="ej. Médico, Trámites, Vacaciones"
                  maxLength={200}
                  className={styles.bookingControl}
                />
              </div>

              {errorBloqueo && (
                <div role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', background: '#fee2e2', padding: '8px 12px', borderRadius: 'var(--tus-control-radius)' }}>
                  {errorBloqueo}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setModalBloqueo(false)}
                  className={homeStyles.buttonSecondary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoBloqueo}
                  className={homeStyles.buttonPrimary}
                  style={{ minHeight: 44, borderRadius: 'var(--tus-control-radius)' }}
                >
                  {guardandoBloqueo ? 'Bloqueando...' : 'Confirmar bloqueo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
