'use client'

import { useCallback, useEffect, useState } from 'react'

import { AdminApiError, adminApi, adminErrorMessage, formatFecha, type AdminEvidenciaHabilitacion, type AdminEvidenciasHabilitacion } from '@/lib/tus-admin-api'
import styles from './admin.module.css'

// Readiness evidence of the platform (service payments and settlement). The page only sends what
// the administrator types; tenant, actor, scope and status are decided by the API, which also
// refuses anything that looks like a credential or personal data.
// The evidence stored as `service-payments` is the readiness for the public launch: shown, never
// a blocker of a payment (PAGOS-HABILITACION-TECNICA-01).
const CAPACIDAD: Record<string, string> = { 'service-payments': 'Readiness para lanzamiento público', settlement: 'Marketplace general (settlement)' }
const REQUISITO: Record<string, string> = {
  legal: 'Legal',
  tax: 'Fiscal',
  kyc: 'Identidad de prestadores (KYC)',
  kyb: 'Verificación comercial (KYB)',
  mercadoPago: 'Mercado Pago',
  runtimeProvider: 'Runtime de producción',
  posPilot: 'POS Pilot',
  aws: 'AWS',
}
// A conditional requirement that does not apply here: shown as such, never as a missing one.
const NO_REQUERIDO: Record<string, string> = {
  not_required_in_runtime: 'No requerido en este runtime',
  not_required_for_flow: 'No requerido para este flujo',
}
const ESTADO: Record<string, string> = { current: 'Vigente', revoked: 'Revocada', expired: 'Vencido', not_yet_valid: 'Todavía no vigente' }
const CAMPO: Record<string, string> = { owner: 'Responsable', evidenceType: 'Tipo', evidenceRef: 'Referencia', policyVersion: 'Versión de política', issuedAt: 'Emitida', expiresAt: 'Vence', reason: 'Motivo', capability: 'Capacidad', gate: 'Requisito' }

function mensajeDe(cause: unknown): string {
  if (cause instanceof AdminApiError) {
    const campos = cause.fields.map((campo) => CAMPO[campo] ?? campo).join(', ')
    if (cause.code === 'SENSITIVE_EVIDENCE_VALUE') return `No se guardó: ${campos || 'un campo'} parece contener una credencial, un payload o un dato personal. Acá va solo una referencia al documento.`
    if (cause.code === 'EVIDENCE_ALREADY_CURRENT') return 'Ese requisito ya tiene una evidencia vigente. Revocala antes de registrar otra.'
    if (cause.code === 'EVIDENCE_REFERENCE_ALREADY_USED') return 'Esa referencia ya se usó para ese requisito. Una evidencia nueva necesita su propia referencia.'
    if (cause.code === 'INVALID' || cause.code === 'UNTRUSTED_EVIDENCE_FIELDS') return `Revisá ${campos || 'los datos'}: una línea de 3 a 200 caracteres por campo, y un vencimiento futuro.`
    if (cause.code === 'NOT_FOUND') return 'Esa evidencia ya no existe o ya estaba revocada.'
  }
  return adminErrorMessage(cause)
}

const VACIO = { owner: '', evidenceType: '', evidenceRef: '', policyVersion: '', expiresAt: '' }

export function AdminEvidencias({ onChange }: { onChange: () => void }): React.ReactNode {
  const [datos, setDatos] = useState<AdminEvidenciasHabilitacion | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [busy, setBusy] = useState(false)
  const [capability, setCapability] = useState('service-payments')
  const [gate, setGate] = useState('legal')
  const [form, setForm] = useState(VACIO)
  const [revocando, setRevocando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')

  const load = useCallback(() => {
    adminApi.evidenciasHabilitacion().then((value) => { setDatos(value); setError('') }).catch((cause) => setError(adminErrorMessage(cause)))
  }, [])
  useEffect(() => { load() }, [load])

  const actual = datos?.capabilities.find((item) => item.capability === capability) ?? null
  const requisitos = actual?.requiredGates ?? []

  async function registrar(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!window.confirm('Vas a registrar que este requisito está respaldado por un documento real y autorizado. ¿Confirmás?')) return
    setBusy(true)
    try {
      await adminApi.registrarEvidenciaHabilitacion({
        capability,
        gate,
        owner: form.owner,
        evidenceType: form.evidenceType,
        evidenceRef: form.evidenceRef,
        policyVersion: form.policyVersion,
        ...(form.expiresAt ? { expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() } : {}),
      })
      setAviso('Evidencia registrada.')
      setForm(VACIO)
      load()
      onChange()
    } catch (cause) {
      setAviso(mensajeDe(cause))
    } finally {
      setBusy(false)
    }
  }

  async function revocar(evidencia: AdminEvidenciaHabilitacion) {
    if (busy) return
    if (motivo.trim().length < 3) {
      setAviso('Escribí el motivo de la revocación.')
      return
    }
    setBusy(true)
    try {
      await adminApi.revocarEvidenciaHabilitacion(evidencia.evidenceId, motivo.trim())
      setAviso('Evidencia revocada. La capacidad queda bloqueada hasta registrar una nueva.')
      setRevocando(null)
      setMotivo('')
      load()
      onChange()
    } catch (cause) {
      setAviso(mensajeDe(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className={styles.card}>
      <summary>Evidencias de habilitación</summary>
      <p className={styles.muted}>
        Cada requisito necesita una evidencia real y autorizada, vigente y única. Se guarda una referencia al documento (acta, expediente, carpeta), nunca el documento, credenciales ni datos personales. Cada registro y cada revocación quedan auditados.
      </p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {!datos && !error ? <p className={styles.muted} role="status">Cargando evidencias…</p> : null}
      {datos ? (
        <>
          <div className={styles.chips}>
            {datos.capabilities.map((item) => (
              <button aria-pressed={capability === item.capability} key={item.capability} onClick={() => { setCapability(item.capability); setGate(item.requiredGates[0] ?? 'legal') }} type="button">
                {CAPACIDAD[item.capability] ?? item.capability}
              </button>
            ))}
          </div>
          <table className={styles.table}>
            <thead>
              <tr><th>Requisito</th><th>Estado</th><th>Referencia</th><th>Responsable</th><th>Tipo</th><th>Vence</th><th></th></tr>
            </thead>
            <tbody>
              {requisitos.map((requisito) => {
                const registros = actual?.evidence.filter((item) => item.gate === requisito) ?? []
                if (registros.length === 0) return <tr key={requisito}><td>{REQUISITO[requisito] ?? requisito}</td><td colSpan={6}><span className={styles.badgeOff}>Pendiente</span></td></tr>
                return registros.map((item) => (
                  <tr key={item.evidenceId}>
                    <td>{REQUISITO[requisito] ?? requisito}</td>
                    <td><span className={item.status === 'current' ? styles.badgeOk : styles.badgeOff}>{ESTADO[item.status] ?? item.status}</span></td>
                    <td>{item.evidenceRef}</td>
                    <td>{item.owner}</td>
                    <td>{item.evidenceType}</td>
                    <td>{item.expiresAt ? formatFecha(item.expiresAt) : 'Sin vencimiento'}</td>
                    <td>
                      {item.revoked ? null : revocando === item.evidenceId ? (
                        <>
                          <label className={styles.srOnlyLabel} htmlFor={`motivo-${item.evidenceId}`}>Motivo de la revocación</label>
                          <input id={`motivo-${item.evidenceId}`} maxLength={200} onChange={(event) => setMotivo(event.target.value)} placeholder="Motivo" value={motivo} />
                          <button className={styles.buttonDanger} disabled={busy} onClick={() => void revocar(item)} type="button">Confirmar</button>
                          <button onClick={() => { setRevocando(null); setMotivo('') }} type="button">Cancelar</button>
                        </>
                      ) : (
                        <button onClick={() => { setRevocando(item.evidenceId); setMotivo('') }} type="button">Revocar</button>
                      )}
                    </td>
                  </tr>
                ))
              })}
              {(actual?.notRequired ?? []).map((item) => (
                <tr data-no-requerido={item.gate} key={item.gate}>
                  <td>{REQUISITO[item.gate] ?? item.gate}</td>
                  <td colSpan={6}><span className={styles.badgeOk}>{NO_REQUERIDO[item.reason] ?? 'No requerido'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Registrar evidencia</h3>
          <form className={styles.form} onSubmit={(event) => void registrar(event)}>
            <div className={styles.formGrid}>
              <label>
                Requisito
                <select onChange={(event) => setGate(event.target.value)} value={gate}>
                  {requisitos.map((requisito) => <option key={requisito} value={requisito}>{REQUISITO[requisito] ?? requisito}</option>)}
                </select>
              </label>
              <label>
                Responsable
                <input maxLength={200} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="Área o rol que aprueba" required value={form.owner} />
              </label>
              <label>
                Tipo de evidencia
                <input maxLength={200} onChange={(event) => setForm({ ...form, evidenceType: event.target.value })} placeholder="Acta, dictamen, contrato…" required value={form.evidenceType} />
              </label>
              <label>
                Referencia
                <input maxLength={200} onChange={(event) => setForm({ ...form, evidenceRef: event.target.value })} placeholder="Identificador del documento" required value={form.evidenceRef} />
              </label>
              <label>
                Versión de política
                <input maxLength={200} onChange={(event) => setForm({ ...form, policyVersion: event.target.value })} required value={form.policyVersion} />
              </label>
              <label>
                Vence (opcional)
                <input onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} type="date" value={form.expiresAt} />
              </label>
            </div>
            <p><button className={styles.buttonPrimary} disabled={busy} type="submit">Registrar evidencia de {CAPACIDAD[capability] ?? capability}</button></p>
          </form>
          {aviso ? <p role="status">{aviso}</p> : null}
        </>
      ) : null}
    </details>
  )
}
