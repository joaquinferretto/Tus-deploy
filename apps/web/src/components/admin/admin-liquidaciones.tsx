'use client'

import { useCallback, useEffect, useState } from 'react'

import type { DetalleLiquidacionAdminDTO, LiquidacionAdminDTO } from '@factory/contracts'

import { AdminApiError, adminApi, adminErrorMessage, formatFecha } from '@/lib/tus-admin-api'
import { formatMoney } from '@/lib/tus-money'
import { AdminEmpty, AdminPageHeader } from './admin-layout'
import { AdminPagination } from './admin-pagination'
import styles from './admin.module.css'

// TUS-GANANCIAS-01: provider payout requests. A request is paid by sending a Mercado Pago Payouts
// transfer from TUS's account (its result comes only from Mercado Pago) or, when the administration
// paid by another means, by recording that operation with its reference. The API decides every
// amount and state; this page only sends the action and what the administrator types.
const ESTADO: Record<LiquidacionAdminDTO['status'], { label: string; tone: 'ok' | 'brand' | 'off' | 'warn' }> = {
  requested: { label: 'Solicitada', tone: 'warn' },
  processing: { label: 'En proceso', tone: 'brand' },
  paid: { label: 'Pagada', tone: 'ok' },
  failed: { label: 'Fallida', tone: 'off' },
  cancelled: { label: 'Cancelada', tone: 'off' },
}
const MECANISMO: Record<string, string> = { mercado_pago_payouts: 'Mercado Pago Payouts', manual: 'Otro medio (registrado por la administración)' }
const ACCION_AUDITORIA: Record<DetalleLiquidacionAdminDTO['audit'][number]['action'], string> = {
  requested: 'Solicitada por el prestador',
  processing: 'Procesamiento iniciado',
  send_confirmed: 'Envío confirmado por Mercado Pago',
  send_unconfirmed: 'Envío sin confirmar',
  send_rejected: 'Envío rechazado por Mercado Pago',
  provider_status: 'Estado informado por Mercado Pago',
  paid: 'Pagada',
  failed: 'Fallida',
  cancelled: 'Cancelada',
}

const FILTROS = [['open', 'Abiertas'], ['requested', 'Solicitadas'], ['processing', 'En proceso'], ['paid', 'Pagadas'], ['failed', 'Fallidas'], ['cancelled', 'Canceladas'], ['', 'Todas']] as const
const TIPO_ITEM: Record<string, string> = { earning: 'Ganancia', mercado_pago_fee: 'Tarifa Mercado Pago', refund: 'Devolución', chargeback: 'Contracargo', adjustment: 'Ajuste' }

function mensajeDe(cause: unknown): string {
  if (cause instanceof AdminApiError) {
    if (cause.code === 'PAYOUTS_NOT_CONFIGURED') return 'Mercado Pago Payouts no está configurado en este entorno. Podés pagar por otro medio y registrarlo con su comprobante.'
    if (cause.code === 'PAYOUT_SENT_TO_PROVIDER') return 'La transferencia ya se envió a Mercado Pago: su resultado lo informa Mercado Pago (usá "Consultar estado").'
    if (cause.code === 'PAYOUT_SEND_UNCONFIRMED') return 'Mercado Pago no confirmó el envío. Reenvialo (no se duplica) o consultá su estado.'
    if (cause.code === 'INVALID_TRANSITION') return 'La solicitud ya cambió de estado. Recargá el detalle.'
    if (cause.code === 'VERSION_CONFLICT') return 'Otra persona modificó la solicitud. Recargá el detalle.'
    if (cause.code === 'INVALID') return 'Revisá los datos: una línea de 3 a 200 caracteres.'
    if (cause.status === 502) return 'Mercado Pago no respondió. Reintentá en unos minutos.'
  }
  return adminErrorMessage(cause)
}

export function AdminLiquidaciones(): React.ReactNode {
  const [items, setItems] = useState<LiquidacionAdminDTO[] | null>(null)
  const [automatico, setAutomatico] = useState(false)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number][0]>('open')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)
  const [abierta, setAbierta] = useState<string | null>(null)

  const load = useCallback(() => {
    adminApi.liquidaciones({ status: filtro, page, pageSize })
      .then((result) => { setItems(result.items); setTotal(result.total); setAutomatico(result.automaticAvailable); setError('') })
      .catch((cause) => setError(adminErrorMessage(cause)))
  }, [filtro, page, pageSize])
  useEffect(() => { load() }, [load])

  const tone = (value: 'ok' | 'brand' | 'off' | 'warn') => (value === 'ok' ? styles.badgeOk : value === 'brand' ? styles.badgeBrand : value === 'warn' ? styles.badgeWarn : styles.badgeOff)

  return (
    <>
      <AdminPageHeader subtitle="Pagos de las ganancias que TUS cobró por prestadores sin Mercado Pago" title="Liquidaciones" />
      <p className={styles.muted}>
        {automatico
          ? 'Mercado Pago Payouts está configurado: "Pagar con Mercado Pago" transfiere desde la cuenta de TUS a la cuenta de Mercado Pago del prestador.'
          : 'Mercado Pago Payouts no está configurado en este entorno: solo se puede pagar por otro medio y registrarlo con su comprobante.'}
      </p>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          {FILTROS.map(([value, label]) => (
            <button aria-pressed={filtro === value} key={value || 'todas'} onClick={() => { setFiltro(value); setPage(1) }} type="button">{label}</button>
          ))}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {items === null && !error ? <p className={styles.muted} role="status">Cargando liquidaciones…</p> : null}
      {items && items.length === 0 ? <AdminEmpty text="No hay liquidaciones con ese estado." /> : null}
      {items && items.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr><th>Prestador</th><th>Monto</th><th>Cuenta destino</th><th>Estado</th><th>Medio</th><th>Solicitada</th><th /></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.payoutId}>
                <td data-label="Prestador">{item.providerName ?? item.providerId}</td>
                <td data-label="Monto"><strong>{formatMoney(item.amountMinor, item.currency)}</strong></td>
                <td data-label="Cuenta destino">{item.destinationEmail}</td>
                <td data-label="Estado"><span className={`${styles.badge} ${tone(ESTADO[item.status].tone)}`}>{ESTADO[item.status].label}</span></td>
                <td data-label="Medio">{item.mechanism ? MECANISMO[item.mechanism] : '—'}</td>
                <td className={styles.muted} data-label="Solicitada">{formatFecha(item.createdAt)}</td>
                <td><button onClick={() => setAbierta(abierta === item.payoutId ? null : item.payoutId)} type="button">{abierta === item.payoutId ? 'Cerrar' : 'Ver detalle'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {items ? <AdminPagination onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} page={page} pageSize={pageSize} totalPages={Math.max(1, Math.ceil(total / pageSize))} /> : null}
      {abierta ? <DetalleLiquidacion id={abierta} onChange={load} /> : null}
    </>
  )
}

function DetalleLiquidacion({ id, onChange }: { id: string; onChange: () => void }): React.ReactNode {
  const [detalle, setDetalle] = useState<DetalleLiquidacionAdminDTO | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [busy, setBusy] = useState(false)
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [motivo, setMotivo] = useState('')

  const load = useCallback(() => {
    adminApi.liquidacion(id).then((value) => { setDetalle(value); setError('') }).catch((cause) => setError(mensajeDe(cause)))
  }, [id])
  useEffect(() => { load() }, [load])

  async function accion(action: 'process' | 'resend' | 'refresh' | 'paid' | 'failed' | 'cancel', body: Record<string, string>, exito: string) {
    if (busy) return
    setBusy(true)
    setAviso('')
    try {
      await adminApi.accionLiquidacion(id, action, body)
      setAviso(exito)
      setReferencia('')
      setMotivo('')
      load()
      onChange()
    } catch (cause) {
      setError(mensajeDe(cause))
      load()
    } finally {
      setBusy(false)
    }
  }

  if (error && !detalle) return <p className={styles.error} role="alert">{error}</p>
  if (!detalle) return <p className={styles.muted} role="status">Cargando detalle…</p>
  const { payout, account, items, movements, automaticAvailable, audit } = detalle
  const enviadaAMercadoPago = payout.mechanism === 'mercado_pago_payouts'
  return (
    <section aria-label="Detalle de la liquidación" className={styles.card}>
      <h2>Liquidación de {formatMoney(payout.amountMinor, payout.currency)} a {payout.providerName ?? payout.providerId}</h2>
      {aviso ? <p role="status">{aviso}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <dl>
        <dt>Estado</dt><dd>{ESTADO[payout.status].label}{payout.providerStatus ? ` · Mercado Pago: ${payout.providerStatus}` : ''}</dd>
        <dt>Cuenta de Mercado Pago destino</dt><dd>{payout.destinationEmail}</dd>
        <dt>Cuenta vinculada</dt><dd>{account.status === 'connected' ? 'Conectada' : account.status}{account.externalAccountId ? ` (usuario ${account.externalAccountId})` : ''}{account.liveMode === false ? ' · modo prueba' : ''}</dd>
        <dt>Medio</dt><dd>{payout.mechanism ? MECANISMO[payout.mechanism] : 'Todavía no se procesó'}</dd>
        <dt>Referencia</dt><dd>{payout.externalReference ?? '—'}</dd>
        <dt>Observación</dt><dd>{payout.note ?? '—'}</dd>
        <dt>Solicitada</dt><dd>{formatFecha(payout.createdAt)} por {payout.requestedBy}</dd>
        <dt>Procesada por</dt><dd>{payout.processedBy ?? '—'}</dd>
        <dt>Resuelta por</dt><dd>{payout.resolvedBy ?? '—'}{payout.failureReason ? ` · ${payout.failureReason}` : ''}</dd>
      </dl>

      <h3>Ganancias incluidas</h3>
      <table className={styles.table}>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Servicio</th><th>Turno</th><th>Importe</th></tr></thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.date}-${index}`}>
              <td>{formatFecha(item.date)}</td><td>{TIPO_ITEM[item.kind] ?? item.kind}</td><td>{item.concept}</td><td>{item.service ?? '—'}</td><td>{item.appointmentAt ? formatFecha(item.appointmentAt) : '—'}</td>
              <td>{item.amountMinor.startsWith('-') ? `- ${formatMoney(item.amountMinor.slice(1), 'ARS')}` : formatMoney(item.amountMinor, 'ARS')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Movimientos contables</h3>
      <ul>{movements.map((item) => <li key={item.kind}>{item.kind === 'payout_reserve' ? 'Reserva' : item.kind === 'payout_release' ? 'Liberación' : 'Pago completado'}: {formatMoney(item.amountMinor, 'ARS')} · {formatFecha(item.date)} · {item.actorId}</li>)}</ul>
      <h3>Auditoría</h3>
      <ol aria-label="Auditoría de la liquidación">
        {audit.map((item) => (
          <li key={item.version}>
            {formatFecha(item.date)} · {ACCION_AUDITORIA[item.action]} · {item.previousStatus ? `${ESTADO[item.previousStatus].label} → ` : ''}{ESTADO[item.status].label} · {item.actorId}
            {Object.keys(item.detail).length > 0 ? ` · ${Object.entries(item.detail).map(([clave, valor]) => `${clave}: ${valor}`).join(', ')}` : ''}
          </li>
        ))}
      </ol>

      {payout.status === 'requested' ? (
        <div className={styles.toolbar}>
          <label>Observación (opcional) <input onChange={(event) => setNota(event.target.value)} value={nota} /></label>
          <button disabled={busy || !automaticAvailable} onClick={() => void accion('process', { mechanism: 'mercado_pago_payouts', ...(nota.trim() ? { note: nota.trim() } : {}) }, 'Transferencia enviada a Mercado Pago. El resultado lo confirma Mercado Pago.')} type="button">Pagar con Mercado Pago</button>
          <button disabled={busy} onClick={() => void accion('process', { mechanism: 'manual', ...(nota.trim() ? { note: nota.trim() } : {}) }, 'Marcada en proceso: pagala por otro medio y registrá su comprobante.')} type="button">Pagar por otro medio</button>
        </div>
      ) : null}
      {payout.status === 'processing' && enviadaAMercadoPago ? (
        <div className={styles.toolbar}>
          <button disabled={busy} onClick={() => void accion('refresh', {}, 'Estado consultado a Mercado Pago.')} type="button">Consultar estado en Mercado Pago</button>
          {!payout.providerPayoutId ? <button disabled={busy} onClick={() => void accion('resend', {}, 'Envío confirmado por Mercado Pago.')} type="button">Reenviar a Mercado Pago</button> : null}
        </div>
      ) : null}
      {payout.status === 'processing' && payout.mechanism === 'manual' ? (
        <form className={styles.toolbar} onSubmit={(event) => { event.preventDefault(); void accion('paid', { externalReference: referencia.trim(), ...(nota.trim() ? { note: nota.trim() } : {}) }, 'Liquidación registrada como pagada.') }}>
          <label>Comprobante de la operación realizada <input minLength={3} onChange={(event) => setReferencia(event.target.value)} required value={referencia} /></label>
          <label>Observación <input onChange={(event) => setNota(event.target.value)} value={nota} /></label>
          <button disabled={busy || referencia.trim().length < 3} type="submit">Marcar como pagada</button>
        </form>
      ) : null}
      {(payout.status === 'requested' || (payout.status === 'processing' && !enviadaAMercadoPago)) ? (
        <div className={styles.toolbar}>
          <label>Motivo <input onChange={(event) => setMotivo(event.target.value)} value={motivo} /></label>
          <button disabled={busy || motivo.trim().length < 3} onClick={() => void accion('failed', { reason: motivo.trim() }, 'Marcada como fallida: el monto volvió a estar disponible para el prestador.')} type="button">Marcar como fallida</button>
          <button disabled={busy || motivo.trim().length < 3} onClick={() => void accion('cancel', { reason: motivo.trim() }, 'Cancelada: el monto volvió a estar disponible para el prestador.')} type="button">Cancelar</button>
        </div>
      ) : null}
    </section>
  )
}
