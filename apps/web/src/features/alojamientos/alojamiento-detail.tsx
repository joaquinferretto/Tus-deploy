'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import type {
  DetalleAlojamientoPublicoDTO,
  UnidadDisponibleDTO,
  ReservaAlojamientoDTO,
} from '@factory/contracts'
import {
  obtenerDetalleAlojamiento,
  ErrorAlojamientos,
  hoyAlojamientos,
  reservarAlojamiento,
  sumarDiasFecha,
} from './alojamientos-client'
import styles from './alojamientos.module.css'

function formatPrice(amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function AlojamientoDetail({ idOrSlug }: { idOrSlug: string }): React.ReactNode {
  const [detalle, setDetalle] = useState<DetalleAlojamientoPublicoDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros de fecha / huéspedes
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [personas, setPersonas] = useState(2)

  // Estado del modal de reserva
  const [unidadSeleccionada, setUnidadSeleccionada] = useState<UnidadDisponibleDTO | null>(null)
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteEmail, setClienteEmail] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [notas, setNotas] = useState('')
  const [submittingHold, setSubmittingHold] = useState(false)
  const [holdError, setHoldError] = useState<string | null>(null)
  const [reservaConfirmada, setReservaConfirmada] = useState<ReservaAlojamientoDTO | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [faltaSesion, setFaltaSesion] = useState(false)

  const cargarDetalle = async () => {
    setLoading(true)
    setError(null)
    try {
      // Availability is asked only for a complete stay; until then, the place without dates.
      const conFechas = Boolean(checkIn && checkOut && checkOut > checkIn)
      const data = await obtenerDetalleAlojamiento(idOrSlug, {
        checkIn: conFechas ? checkIn : undefined,
        checkOut: conFechas ? checkOut : undefined,
        personas,
      })
      setDetalle(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al cargar alojamiento')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargarDetalle()
  }, [idOrSlug, checkIn, checkOut, personas])

  const handleIniciarReserva = (unidad: UnidadDisponibleDTO) => {
    if (!checkIn || !checkOut) {
      setAviso('Elegí la fecha de entrada y la de salida para reservar.')
      return
    }
    if (checkOut <= checkIn) {
      setAviso('La salida debe ser posterior a la entrada.')
      return
    }
    setAviso(null)
    setFaltaSesion(false)
    setUnidadSeleccionada(unidad)
    setHoldError(null)
    setReservaConfirmada(null)
  }

  const handleConfirmarHoldYPago = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!unidadSeleccionada || !detalle) return

    setSubmittingHold(true)
    setHoldError(null)

    try {
      // Calendar dates: the API computes the nights and the total, and confirms the reservation.
      const reserva = await reservarAlojamiento({
        unidadId: unidadSeleccionada.id,
        alojamientoId: detalle.id,
        clienteNombre,
        ...(clienteEmail.trim() ? { clienteEmail: clienteEmail.trim() } : {}),
        ...(clienteTelefono.trim() ? { clienteTelefono: clienteTelefono.trim() } : {}),
        fechaInicio: checkIn,
        fechaFin: checkOut,
        cantidadPersonas: personas,
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      })
      setReservaConfirmada(reserva)
      void cargarDetalle()
    } catch (err: unknown) {
      if (err instanceof ErrorAlojamientos && err.status === 401) setFaltaSesion(true)
      setHoldError(err instanceof ErrorAlojamientos && err.status === 401 ? 'Para reservar necesitás iniciar sesión con tu cuenta de TUS.' : err instanceof Error ? err.message : 'No pudimos completar la reserva.')
    } finally {
      setSubmittingHold(false)
    }
  }

  if (loading && !detalle) {
    return (
      <div className={styles.container} style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <p>Cargando información del alojamiento...</p>
      </div>
    )
  }

  if (error || !detalle) {
    return (
      <div className={styles.container} style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <h2>Alojamiento no encontrado</h2>
        <p style={{ color: '#ef4444', marginBottom: '1.5rem' }}>{error || 'No se pudo encontrar el alojamiento'}</p>
        <Link href={'/alojamientos' as Route} className={styles.btnSearch}>
          Volver a alojamientos
        </Link>
      </div>
    )
  }

  const fotosGenerales = detalle.imagenes
  const fotoPrincipal = fotosGenerales.find((img) => img.esPrincipal) || fotosGenerales[0]
  const fotosSecundarias = fotosGenerales.filter((img) => img.id !== fotoPrincipal?.id).slice(0, 4)

  return (
    <div className={styles.container}>
      {/* Breadcrumb */}
      <nav style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
        <Link href={'/alojamientos' as Route} style={{ color: '#ff5a00', textDecoration: 'none' }}>
          Alojamientos
        </Link>{' '}
        / <span>{detalle.tipo.nombre}</span> / <span>{detalle.nombre}</span>
      </nav>

      {/* Encabezado */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <span className={styles.typeBadge} style={{ position: 'static' }}>
            {detalle.tipo.nombre}
          </span>
          {detalle.rating && (
            <div className={styles.ratingTag}>
              <span className={styles.starIcon}>★</span>
              <span>{detalle.rating.average}</span>
              <span style={{ color: '#6b7280', fontWeight: 400 }}>({detalle.rating.count} opiniones)</span>
            </div>
          )}
        </div>
        <h1 className={styles.title} style={{ margin: '0.25rem 0' }}>
          {detalle.nombre}
        </h1>
        <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>
          {[detalle.direccion, detalle.barrioNombre, detalle.zonaNombre].filter(Boolean).join(', ')}
        </p>
      </div>

      {/* Galería de Fotos Generales */}
      {fotosGenerales.length > 0 && (
        <div className={styles.galleryGrid}>
          {fotoPrincipal && (
            <img
              src={fotoPrincipal.url}
              alt={fotoPrincipal.alt || detalle.nombre}
              className={styles.galleryMain}
            />
          )}
          {fotosSecundarias.map((img) => (
            <img
              key={img.id}
              src={img.url}
              alt={img.alt || detalle.nombre}
              className={styles.gallerySub}
            />
          ))}
        </div>
      )}

      {/* Selector de Fechas y Disponibilidad */}
      <div className={styles.filterBar} style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem' }}>
          Consultá disponibilidad y tarifas
        </h2>
        {aviso ? (
          <p data-estadia="aviso" role="alert" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            {aviso}
          </p>
        ) : null}
        <div className={styles.filterGrid}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="estadia-entrada">Entrada</label>
            <input
              type="date"
              id="estadia-entrada"
              className={styles.formInput}
              min={hoyAlojamientos()}
              value={checkIn}
              onChange={(e) => {
                setCheckIn(e.target.value)
                setAviso(null)
                // The departure never stays before the arrival.
                if (e.target.value && checkOut && checkOut <= e.target.value) setCheckOut(sumarDiasFecha(e.target.value, 1))
              }}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="estadia-salida">Salida</label>
            <input
              type="date"
              id="estadia-salida"
              className={styles.formInput}
              min={checkIn ? sumarDiasFecha(checkIn, 1) : hoyAlojamientos()}
              value={checkOut}
              onChange={(e) => {
                setCheckOut(e.target.value)
                setAviso(null)
              }}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Huéspedes</label>
            <select
              className={styles.formSelect}
              value={personas}
              onChange={(e) => setPersonas(Number(e.target.value))}
            >
              <option value={1}>1 huésped</option>
              <option value={2}>2 huéspedes</option>
              <option value={3}>3 huéspedes</option>
              <option value={4}>4 huéspedes</option>
              <option value={5}>5+ huéspedes</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '0.9rem', color: '#4b5563' }}>
              Horarios: Check-in {detalle.checkInHora} / Check-out {detalle.checkOutHora}
            </span>
          </div>
        </div>
      </div>

      {/* Layout Detalle */}
      <div className={styles.detailLayout}>
        {/* Columna Izquierda: Unidades e Información */}
        <div>
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1rem' }}>
              Habitaciones y Unidades disponibles
            </h2>

            {detalle.unidades.map((u) => {
              const fotoUnidad = u.imagenes[0]

              return (
                <div key={u.id} className={styles.unitCard}>
                  <div>
                    {fotoUnidad ? (
                      <img
                        src={fotoUnidad.url}
                        alt={fotoUnidad.alt || u.nombre}
                        className={styles.unitImage}
                      />
                    ) : (
                      <div className={styles.cardImagePlaceholder} style={{ height: 120, borderRadius: 8 }}>
                        Sin foto
                      </div>
                    )}
                    {fotoUnidad?.esFotoGeneralFallback && (
                      <div className={styles.fallbackNotice}>
                        * Fotos generales del alojamiento
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                      {u.nombre}
                    </h3>
                    <p style={{ fontSize: '0.875rem', color: '#4b5563', marginBottom: '0.5rem' }}>
                      Capacidad: {u.capacidadPersonas} personas · {u.camasDetalle || 'Camas a consultar'} · {u.banosCantidad} baño(s)
                    </p>
                    {u.descripcion && (
                      <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                        {u.descripcion}
                      </p>
                    )}
                    {u.comodidades.length > 0 && (
                      <div className={styles.amenitiesRow}>
                        {u.comodidades.map((c, i) => (
                          <span key={i} className={styles.amenityPill}>
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {u.precioCalculado ? (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          Total por {u.precioCalculado.cantidadPeriodos} {u.precioCalculado.modalidad}(s)
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
                          {formatPrice(u.precioCalculado.total)}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.75rem' }}>
                        Seleccioná fechas para ver precio
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={!u.disponible}
                      onClick={() => handleIniciarReserva(u)}
                      className={styles.btnSearch}
                      style={{
                        backgroundColor: u.disponible ? '#ff5a00' : '#9ca3af',
                        cursor: u.disponible ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {u.disponible ? 'Reservar' : 'No disponible'}
                    </button>
                  </div>
                </div>
              )
            })}
          </section>

          {/* Información y políticas */}
          <section style={{ background: '#ffffff', borderRadius: 12, padding: '1.5rem', border: '1px solid #e5e7eb', marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              Descripción y políticas
            </h3>
            <p style={{ color: '#374151', lineHeight: 1.6, marginBottom: '1rem' }}>
              {detalle.descripcion || 'Sin descripción detallada.'}
            </p>
            {detalle.politicas && (
              <div>
                <h4 style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', marginBottom: '0.25rem' }}>
                  Reglas de la casa
                </h4>
                <p style={{ color: '#4b5563', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  {detalle.politicas}
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Columna Derecha: Resumen y Comodidades */}
        <div>
          <div style={{ background: '#ffffff', borderRadius: 12, padding: '1.5rem', border: '1px solid #e5e7eb', position: 'sticky', top: 20 }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
              Comodidades del alojamiento
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {detalle.comodidades.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.95rem', color: '#374151' }}>
                  <span style={{ color: '#10b981' }}>✓</span> {c}
                </div>
              ))}
              {detalle.comodidades.length === 0 && (
                <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Sin comodidades declaradas</span>
              )}
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '1rem 0' }} />

            <div style={{ fontSize: '0.875rem', color: '#6b7280', lineHeight: 1.5 }}>
              🛡️ <strong>Garantía TUS:</strong> Las reservas retienen tu inventario en PostgreSQL sin riesgo de solapamiento. Cancelación y cambios según las políticas del alojamiento.
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Reserva y Checkout */}
      {unidadSeleccionada && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {reservaConfirmada ? '¡Reserva Confirmada!' : 'Confirmar Reserva'}
              </h3>
              <button
                type="button"
                className={styles.btnClose}
                onClick={() => setUnidadSeleccionada(null)}
              >
                ✕
              </button>
            </div>

            {reservaConfirmada ? (
              <div>
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
                  <h4 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
                    Tu estadía está confirmada
                  </h4>
                  <p style={{ color: '#4b5563', fontSize: '0.95rem', marginBottom: '1rem' }}>
                    Código de reserva: <strong>{reservaConfirmada.id}</strong>
                  </p>
                  <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '1rem', textAlign: 'left', fontSize: '0.9rem' }}>
                    <p><strong>Alojamiento:</strong> {reservaConfirmada.alojamientoNombre}</p>
                    <p><strong>Unidad:</strong> {reservaConfirmada.unidadNombre}</p>
                    <p><strong>Titular:</strong> {reservaConfirmada.clienteNombre}</p>
                    <p><strong>Total a pagar en el alojamiento:</strong> {formatPrice(reservaConfirmada.precioFinalSnapshot)}</p>
                  </div>
                </div>
                <Link href={'/alojamientos/reservas' as Route} className={styles.btnSearch} data-reserva="ver" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                  Ver mis reservas
                </Link>
              </div>
            ) : (
              <form onSubmit={handleConfirmarHoldYPago}>
                <div style={{ background: '#f9fafb', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem' }}>
                  <h4 style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{unidadSeleccionada.nombre}</h4>
                  <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>
                    Fechas: {checkIn} al {checkOut} ({personas} personas)
                  </p>
                  {unidadSeleccionada.precioCalculado && (
                    <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ff5a00', marginTop: '0.5rem' }}>
                      Total: {formatPrice(unidadSeleccionada.precioCalculado.total)}
                    </p>
                  )}
                  <p style={{ fontSize: '0.8rem', color: '#4b5563', marginTop: '0.35rem' }}>La reserva queda confirmada al instante y se paga en el alojamiento.</p>
                </div>

                {holdError && (
                  <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem' }}>
                    {holdError}
                    {faltaSesion ? (
                      <>
                        {' '}
                        <a href={`/sign-in?returnTo=${encodeURIComponent(`/alojamientos/${idOrSlug}`)}`} style={{ color: '#b91c1c', fontWeight: 700 }}>
                          Iniciar sesión
                        </a>
                      </>
                    ) : null}
                  </div>
                )}

                <div className={styles.formGroup} style={{ marginBottom: '1rem' }}>
                  <label className={styles.formLabel}>Nombre y apellido completo *</label>
                  <input
                    type="text"
                    required
                    className={styles.formInput}
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                    placeholder="Ej. Juan Pérez"
                  />
                </div>

                <div className={styles.formGroup} style={{ marginBottom: '1rem' }}>
                  <label className={styles.formLabel}>Email de contacto (opcional)</label>
                  <input
                    type="email"
                    className={styles.formInput}
                    value={clienteEmail}
                    onChange={(e) => setClienteEmail(e.target.value)}
                    placeholder="juan@ejemplo.com"
                  />
                </div>

                <div className={styles.formGroup} style={{ marginBottom: '1rem' }}>
                  <label className={styles.formLabel}>Teléfono / WhatsApp (opcional)</label>
                  <input
                    type="tel"
                    className={styles.formInput}
                    value={clienteTelefono}
                    onChange={(e) => setClienteTelefono(e.target.value)}
                    placeholder="+54 9 11 1234-5678"
                  />
                </div>

                <div className={styles.formGroup} style={{ marginBottom: '1.5rem' }}>
                  <label className={styles.formLabel}>Notas o peticiones especiales (opcional)</label>
                  <textarea
                    className={styles.formInput}
                    style={{ minHeight: 70, resize: 'vertical' }}
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    placeholder="Ej. llegada fuera de horario, cuna para bebé..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingHold}
                  className={styles.btnSearch}
                  style={{ width: '100%', minHeight: 48 }}
                >
                  {submittingHold ? 'Reservando...' : 'Confirmar reserva'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
