'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { TusRequestError } from '@/lib/tus-client'
import {
  ETIQUETAS_ESTADO_IDENTIDAD,
  clienteIdentidad,
  validarArchivoDni,
  type VistaIdentidadPrestador,
} from '@/lib/tus-identidad'
import { type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

// IDENTITY-NOSIS: the provider verifies their identity (DNI front and back) before publishing
// services, accepting work, linking Mercado Pago or receiving money. Sending only queues the
// verification; the result arrives later.

const EN_CURSO = new Set(['queued', 'processing', 'retry_pending', 'session_required'])
const POLL_MS = 15_000

const ERRORES: Record<string, string> = {
  DOCUMENT_TYPE_NOT_ALLOWED: 'Solo se aceptan fotos JPG, PNG o WEBP.',
  DOCUMENT_TOO_LARGE: 'La foto supera el tamaño permitido.',
  DOCUMENT_TOO_SMALL: 'La foto es demasiado chica para leerse bien.',
  DOCUMENT_CORRUPT: 'La foto está dañada. Probá sacarla de nuevo.',
  CONSENT_REQUIRED: 'Aceptá la autorización antes de continuar.',
  DOCUMENTS_REQUIRED: 'Subí el frente y el dorso del DNI.',
  VERIFICATION_LOCKED: 'La verificación ya está en curso.',
  DOCUMENT_STORAGE_NOT_CONFIGURED:
    'La verificación de identidad todavía no está habilitada en TUS.',
}

export function VerificacionIdentidad({
  session,
  onUnauthorized,
}: {
  session: TusWebSession
  onUnauthorized: () => void
}): ReactNode {
  const [view, setView] = useState<VistaIdentidadPrestador | null>(null)
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; message: string }>({
    status: 'loading',
    message: 'Consultando tu verificación de identidad.',
  })
  const [consent, setConsent] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<'consent' | 'front' | 'back' | 'submit' | null>(null)
  const requestRef = useRef(0)

  const fail = useCallback(
    (error: unknown, fallback: string) => {
      const status = error instanceof TusRequestError ? error.status : undefined
      if (status === 401) onUnauthorized()
      const code = error instanceof TusRequestError ? error.code : undefined
      setNotice(
        (code && ERRORES[code]) ||
          (status === 403 ? 'Esta sesión no puede verificar la identidad del prestador.' : fallback)
      )
    },
    [onUnauthorized]
  )

  const load = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    try {
      const current = await clienteIdentidad.estado(session)
      if (requestId !== requestRef.current) return
      setView(current)
      setState({ status: 'ready', message: '' })
    } catch (error) {
      if (requestId !== requestRef.current) return
      if (error instanceof TusRequestError && error.status === 401) onUnauthorized()
      setState({ status: 'error', message: 'No pudimos consultar tu verificación. Reintentá.' })
    }
  }, [onUnauthorized, session])

  useEffect(() => {
    void load()
  }, [load])

  // While the worker processes the verification, refresh periodically (no browser waiting).
  useEffect(() => {
    if (!view || !EN_CURSO.has(view.status)) return
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [load, view])

  async function acceptConsent(): Promise<void> {
    if (!view || !consent || busy) return
    setBusy('consent')
    setNotice('')
    try {
      setView(await clienteIdentidad.aceptarConsentimiento(session, view.consentVersion))
    } catch (error) {
      fail(error, 'No se pudo registrar la autorización. Reintentá.')
    } finally {
      setBusy(null)
    }
  }

  async function upload(side: 'front' | 'back', file: File | undefined): Promise<void> {
    if (!file || busy) return
    const invalid = validarArchivoDni(file)
    if (invalid) {
      setNotice(invalid)
      return
    }
    setBusy(side)
    setNotice('')
    try {
      setView(await clienteIdentidad.subirDocumento(session, side, file))
    } catch (error) {
      fail(error, 'No se pudo subir la foto. Reintentá.')
    } finally {
      setBusy(null)
    }
  }

  async function submit(): Promise<void> {
    if (busy) return
    setBusy('submit')
    setNotice('')
    try {
      const result = await clienteIdentidad.enviar(session)
      setNotice(result.message)
      await load()
    } catch (error) {
      fail(error, 'No se pudo enviar la verificación. Reintentá.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="provider-identity-title">
      <div className="tus-section-label">
        <span>02</span>
        <h2 id="provider-identity-title">Verificación de identidad.</h2>
      </div>
      <p className="tus-evidence-line">
        Para publicar servicios, aceptar trabajos, conectar Mercado Pago y cobrar, TUS necesita
        verificar tu identidad con el frente y el dorso de tu DNI.
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {state.status !== 'ready' || !view ? (
        <TusStateMessage
          state={{
            status: state.status === 'ready' ? 'loading' : state.status,
            message: state.message,
            resource: 'Verificación de identidad',
            retry: state.status === 'error' ? () => void load() : undefined,
          }}
        />
      ) : (
        <div className="tus-state-box">
          <p>
            <strong>{ETIQUETAS_ESTADO_IDENTIDAD[view.status]}</strong>
            {view.documentNumberMasked ? ` · DNI ${view.documentNumberMasked}` : null}
          </p>
          <p role="status">{view.message}</p>
          {view.status === 'not_started' ? (
            <div>
              <label>
                <input
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  type="checkbox"
                />{' '}
                {view.consentText}
              </label>
              <TusActionButton
                disabled={!consent}
                loading={busy === 'consent'}
                loadingLabel="Registrando…"
                onClick={() => void acceptConsent()}
                type="button"
              >
                Aceptar y continuar
              </TusActionButton>
            </div>
          ) : null}
          {view.status === 'pending_upload' ? (
            <div>
              {(['front', 'back'] as const).map((side) => (
                <p key={side}>
                  <label>
                    {side === 'front' ? 'Frente del DNI' : 'Dorso del DNI'}
                    {view.documents[side] ? ' (cargado)' : ''}:{' '}
                    <input
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy !== null}
                      onChange={(event) => void upload(side, event.target.files?.[0])}
                      type="file"
                    />
                  </label>
                </p>
              ))}
              <TusActionButton
                disabled={!view.documents.front || !view.documents.back}
                loading={busy === 'submit'}
                loadingLabel="Enviando…"
                onClick={() => void submit()}
                type="button"
              >
                Enviar para verificar
              </TusActionButton>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

const verificacionIdentidadModule = { VerificacionIdentidad }

export default verificacionIdentidadModule
