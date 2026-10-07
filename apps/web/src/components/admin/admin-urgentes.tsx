'use client'

import { useEffect, useState } from 'react'

import { adminApi, adminErrorMessage, formatFecha, type AdminUrgente } from '@/lib/tus-admin-api'
import { AdminPagination } from './admin-pagination'
import styles from './admin.module.css'

// SERVICIO-URGENTE-01 in the administration: each urgent request with the providers it was offered
// to, who was really told (and what WhatsApp reported), who said no, who took it and who gave it
// back. Read only: nothing here assigns or reopens a request.
const ESTADO: Record<AdminUrgente['status'], { label: string; tone: 'ok' | 'brand' | 'off' | 'warn' }> = {
  pendiente: { label: 'Buscando prestador', tone: 'brand' },
  tomada: { label: 'Tomada', tone: 'ok' },
  sin_candidatos: { label: 'Sin candidatos', tone: 'warn' },
  todos_rechazaron: { label: 'Todos rechazaron', tone: 'warn' },
  vencida: { label: 'Vencida', tone: 'warn' },
  cancelada: { label: 'Cancelada', tone: 'off' },
}

const OFERTA: Record<string, string> = {
  notificada: 'Sin respuesta',
  no_enviada: 'No se le pudo avisar',
  acepto: 'Aceptó (asignado)',
  no_puede: 'No puede',
  cerrada_por_otro: 'La tomó otro',
  renuncio: 'Aceptó y después renunció',
  vencida: 'Sin respuesta (venció)',
}

const NO_ENVIADA: Record<string, string> = {
  sin_cuenta: 'el prestador no tiene una cuenta asociada',
  sin_whatsapp: 'no tiene un WhatsApp vinculado',
  requiere_plantilla: 'fuera de la ventana de 24 h y sin plantilla aprobada',
  con_operador: 'su conversación está tomada por una persona de TUS',
  fallo_envio: 'falló el envío',
}

const ENTREGA: Record<string, string> = { pending_send: 'Enviando', unknown: 'Sin confirmación de Meta', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Falló' }
const ORIGEN: Record<string, string> = { whatsapp: 'WhatsApp', web_publica: 'Web', web_assistant: 'Asistente Web', web_directory: 'Web' }

export function AdminUrgentes(): React.ReactNode {
  const [items, setItems] = useState<AdminUrgente[] | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    adminApi.urgentes({ page, pageSize })
      .then((result) => { setItems(result.items); setTotalPages(result.totalPages); setError('') })
      .catch((cause) => setError(adminErrorMessage(cause)))
  }, [page, pageSize])

  const tone = (value: 'ok' | 'brand' | 'off' | 'warn') => (value === 'ok' ? styles.badgeOk : value === 'brand' ? styles.badgeBrand : value === 'warn' ? styles.badgeWarn : styles.badgeOff)

  return (
    <section aria-labelledby="admin-urgentes" data-admin-urgentes style={{ marginBottom: 28 }}>
      <h2 id="admin-urgentes" style={{ fontSize: '1.1rem', margin: '0 0 4px' }}>Servicios urgentes</h2>
      <p className={styles.muted} style={{ margin: '0 0 12px' }}>Se ofrecen a la vez a todos los prestadores compatibles; el primero que acepta queda asignado.</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando servicios urgentes…</p> : null}
      {items && items.length === 0 ? <p className={styles.muted}>Todavía no hay servicios urgentes.</p> : null}
      {items && items.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr><th>Cliente y servicio</th><th>Dirección</th><th>Estado</th><th>Candidatos</th><th>Fechas</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr data-urgente-admin={item.status} key={item.id}>
                  <td data-label="Cliente y servicio">
                    <strong>{item.service}</strong>
                    <div>{item.client} · vía {ORIGEN[item.origin] ?? item.origin}</div>
                    {item.description ? <div className={styles.muted}>{item.description}</div> : null}
                  </td>
                  <td data-label="Dirección">{item.address}<div className={styles.muted}>{item.zone}</div></td>
                  <td data-label="Estado">
                    <span className={`${styles.badge} ${tone(ESTADO[item.status].tone)}`}>{ESTADO[item.status].label}</span>
                    {item.winner ? <div><strong>{item.winner.name}</strong>{item.winner.acceptedAt ? <span className={styles.muted}> · {formatFecha(item.winner.acceptedAt)}</span> : null}</div> : null}
                    {item.reopenings > 0 ? <div className={styles.muted}>Reabierta {item.reopenings === 1 ? '1 vez' : `${item.reopenings} veces`} por renuncia</div> : null}
                    {item.workId ? <div><a href={`/tus/admin/trabajos?id=${encodeURIComponent(item.workId)}`}>Ver trabajo</a></div> : null}
                  </td>
                  <td data-label="Candidatos">
                    <div>
                      {item.counts.candidates} encontrados · {item.counts.notified} notificados · {item.counts.rejected} rechazaron · {item.counts.unanswered} sin respuesta
                      {item.counts.resigned > 0 ? ` · ${item.counts.resigned} renunció` : ''}
                      {item.counts.deliveryFailed > 0 ? <span className={`${styles.badge} ${styles.badgeWarn}`} style={{ marginLeft: 6 }}>{item.counts.deliveryFailed} con error de entrega</span> : null}
                    </div>
                    {item.candidates.length > 0 ? (
                      <details>
                        <summary>Ver cada prestador</summary>
                        <ul style={{ display: 'grid', gap: 6, listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
                          {item.candidates.map((candidato, index) => (
                            <li key={`${candidato.provider.id ?? candidato.provider.name}-${index}`}>
                              <strong>{candidato.provider.name}</strong> · {OFERTA[candidato.status] ?? candidato.status}
                              <div className={styles.muted}>
                                {candidato.notifiedAt
                                  ? `Avisado por WhatsApp${candidato.delivery?.waIdMasked ? ` ${candidato.delivery.waIdMasked.replace(/\*/gu, '•')}` : ''} · ${formatFecha(candidato.notifiedAt)}${candidato.round > 1 ? ` · ronda ${candidato.round}` : ''}${candidato.delivery ? ` · ${ENTREGA[candidato.delivery.status] ?? candidato.delivery.status}${candidato.delivery.error ? ` (${candidato.delivery.error})` : ''}` : ''}`
                                  : `No avisado: ${NO_ENVIADA[candidato.notSentReason ?? ''] ?? 'no se pudo escribir a ese prestador'}`}
                              </div>
                              {candidato.acceptedAt ? <div className={styles.muted}>Aceptó · {formatFecha(candidato.acceptedAt)}{candidato.answerChannel ? ` · por ${candidato.answerChannel === 'whatsapp' ? 'WhatsApp' : 'la Web'}` : ''}</div> : null}
                              {candidato.resignedAt ? <div className={styles.muted}>Renunció · {formatFecha(candidato.resignedAt)}{candidato.resignationReason ? ` · “${candidato.resignationReason}”` : ''}</div> : null}
                              {!candidato.acceptedAt && candidato.answeredAt ? <div className={styles.muted}>Respondió · {formatFecha(candidato.answeredAt)}</div> : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </td>
                  <td className={styles.muted} data-label="Fechas">Creada {formatFecha(item.createdAt)}<div>{item.status === 'pendiente' ? 'Vence' : 'Vencía'} {formatFecha(item.expiresAt)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {items && totalPages > 1 ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={totalPages} /> : null}
    </section>
  )
}
