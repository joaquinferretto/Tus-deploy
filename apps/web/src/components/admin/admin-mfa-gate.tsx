'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { AdminMfaError, adminMfa, agruparSecreto, mensajeErrorMfa, type AdminMfaEnrollment, type AdminMfaStatus } from '@/lib/tus-admin-mfa'
import type { TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from '../../app/tus/tus-ui'

// Second factor for platform administration. The API only honors admin permissions for a session
// that passed MFA; this gate asks for the enrollment (first time) or the code (every new session)
// before rendering the admin surface. It never decides authorization by itself.

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'sin-sesion' }
  | { tipo: 'bloqueado'; mensaje: string }
  | { tipo: 'listo'; status: AdminMfaStatus }

export function AdminMfaGate({ children, returnTo }: { children: ReactNode; returnTo: string }): ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const [codigosNuevos, setCodigosNuevos] = useState<string[] | null>(null)

  useEffect(() => {
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => setSession(result.session === undefined ? null : toTusWebSession(result.session)))
  }, [])

  const cargar = useCallback(async (current: TusWebSession) => {
    try {
      setEstado({ tipo: 'listo', status: await adminMfa.status(current) })
    } catch (error) {
      if (error instanceof AdminMfaError && error.status === 401) setEstado({ tipo: 'sin-sesion' })
      else setEstado({ tipo: 'bloqueado', mensaje: mensajeErrorMfa(error) })
    }
  }, [])

  useEffect(() => {
    if (session === null) setEstado({ tipo: 'sin-sesion' })
    else if (session) void cargar(session)
  }, [session, cargar])

  if (estado.tipo === 'cargando') return <TusStateMessage state={{ status: 'loading', message: 'Verificando la seguridad de la sesión.' }} />
  if (estado.tipo === 'sin-sesion' || !session)
    return (
      <TusStateMessage state={{ status: 'disabled', message: 'Ingresá con tu cuenta de administración.' }}>
        <a className="tus-action-button tus-action-link" href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
          Ingresar
        </a>
      </TusStateMessage>
    )
  if (estado.tipo === 'bloqueado') return <TusStateMessage state={{ status: 'disabled', message: estado.mensaje }} />

  if (codigosNuevos) return <CodigosRecuperacion codigos={codigosNuevos} onListo={() => setCodigosNuevos(null)} />
  if (!estado.status.enrolled)
    return (
      <Enrolamiento
        session={session}
        onConfirmado={(codigos) => {
          setCodigosNuevos(codigos)
          void cargar(session)
        }}
      />
    )
  if (!estado.status.elevated) return <Desafio session={session} onVerificado={() => void cargar(session)} />
  return <>{children}</>
}

function Enrolamiento({ session, onConfirmado }: { session: TusWebSession; onConfirmado: (codigos: string[]) => void }): ReactNode {
  const [inscripcion, setInscripcion] = useState<AdminMfaEnrollment | null>(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function iniciar() {
    setEnviando(true)
    setError('')
    try {
      setInscripcion(await adminMfa.enroll(session))
    } catch (cause) {
      setError(mensajeErrorMfa(cause))
    } finally {
      setEnviando(false)
    }
  }

  async function confirmar(event: FormEvent) {
    event.preventDefault()
    if (!inscripcion || enviando || !/^\d{6}$/u.test(codigo)) return
    setEnviando(true)
    setError('')
    try {
      const result = await adminMfa.confirm(session, inscripcion.enrollmentId, codigo.trim())
      setInscripcion(null)
      onConfirmado(result.recoveryCodes)
    } catch (cause) {
      setError(mensajeErrorMfa(cause))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section aria-labelledby="mfa-enroll-title" className="tus-state-box">
      <p className="tus-kicker">Seguridad de administración</p>
      <h1 id="mfa-enroll-title">Activá el segundo factor</h1>
      <p>
        La administración de TUS exige un código de una app autenticadora (Google Authenticator, Microsoft
        Authenticator, 1Password…). Sin eso, el servidor no habilita ningún permiso de administrador.
      </p>
      {!inscripcion ? (
        <TusActionButton loading={enviando} loadingLabel="Generando…" onClick={() => void iniciar()} type="button">
          Configurar autenticador
        </TusActionButton>
      ) : (
        <form className="tus-support-form" onSubmit={(event) => void confirmar(event)} noValidate>
          <p>
            1. En la app, elegí <strong>Ingresar clave de configuración</strong> y cargá esta clave (tipo: basada en el
            tiempo). Se muestra una sola vez.
          </p>
          <p>
            <code aria-label="Clave de configuración" style={{ fontSize: '1.1rem', letterSpacing: '0.08em', wordBreak: 'break-all' }}>
              {agruparSecreto(inscripcion.secret)}
            </code>
          </p>
          <p>
            En el teléfono también podés <a href={inscripcion.otpauthUri}>abrir la clave directamente en la app</a>.
          </p>
          <label htmlFor="mfa-enroll-code">2. Escribí el código de 6 dígitos que muestra la app</label>
          <input
            autoComplete="one-time-code"
            id="mfa-enroll-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setCodigo(event.target.value.replace(/\D/gu, '').slice(0, 6))}
            pattern="[0-9]{6}"
            required
            value={codigo}
          />
          <TusActionButton disabled={enviando || !/^\d{6}$/u.test(codigo)} loading={enviando} loadingLabel="Verificando…" type="submit">
            Activar
          </TusActionButton>
        </form>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}

function Desafio({ session, onVerificado }: { session: TusWebSession; onVerificado: () => void }): ReactNode {
  const [modoRecuperacion, setModoRecuperacion] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(event: FormEvent) {
    event.preventDefault()
    const valido = modoRecuperacion ? /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/u.test(codigo.trim()) : /^\d{6}$/u.test(codigo)
    if (enviando || !valido) return
    setEnviando(true)
    setError('')
    try {
      if (modoRecuperacion) await adminMfa.recover(session, codigo.trim())
      else await adminMfa.verify(session, codigo.trim())
      onVerificado()
    } catch (cause) {
      setError(mensajeErrorMfa(cause))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section aria-labelledby="mfa-challenge-title" className="tus-state-box">
      <p className="tus-kicker">Seguridad de administración</p>
      <h1 id="mfa-challenge-title">Confirmá que sos vos</h1>
      <form className="tus-support-form" onSubmit={(event) => void enviar(event)} noValidate>
        <label htmlFor="mfa-code">
          {modoRecuperacion ? 'Código de recuperación (XXXX-XXXX-XXXX, se usa una sola vez)' : 'Código de 6 dígitos de tu app autenticadora'}
        </label>
        <input
          autoComplete="one-time-code"
          id="mfa-code"
          inputMode={modoRecuperacion ? 'text' : 'numeric'}
          maxLength={modoRecuperacion ? 14 : 6}
          onChange={(event) => setCodigo(modoRecuperacion ? event.target.value.toUpperCase().slice(0, 14) : event.target.value.replace(/\D/gu, '').slice(0, 6))}
          pattern={modoRecuperacion ? '[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}' : '[0-9]{6}'}
          required
          value={codigo}
        />
        <TusActionButton disabled={enviando || (modoRecuperacion ? !/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/u.test(codigo.trim()) : !/^\d{6}$/u.test(codigo))} loading={enviando} loadingLabel="Verificando…" type="submit">
          Continuar
        </TusActionButton>
      </form>
      <button
        className="tus-link-button"
        onClick={() => {
          setModoRecuperacion(!modoRecuperacion)
          setCodigo('')
          setError('')
        }}
        type="button"
      >
        {modoRecuperacion ? 'Usar la app autenticadora' : '¿No tenés acceso al teléfono? Usar código de recuperación'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}

export function CodigosRecuperacion({ codigos, onListo }: { codigos: string[]; onListo: () => void }): ReactNode {
  const [guardados, setGuardados] = useState(false)
  return (
    <section aria-labelledby="mfa-codes-title" className="tus-state-box">
      <p className="tus-kicker">Seguridad de administración</p>
      <h1 id="mfa-codes-title">Guardá tus códigos de recuperación</h1>
      <p>
        Si perdés el teléfono, cada código sirve <strong>una sola vez</strong> para entrar. No se vuelven a mostrar:
        guardalos fuera de este equipo (gestor de contraseñas o papel).
      </p>
      <ul style={{ columns: 2, fontFamily: 'monospace', fontSize: '1.05rem' }}>
        {codigos.map((codigo) => (
          <li key={codigo}>{codigo}</li>
        ))}
      </ul>
      <label>
        <input checked={guardados} onChange={(event) => setGuardados(event.target.checked)} type="checkbox" /> Ya los guardé
      </label>
      <TusActionButton disabled={!guardados} onClick={onListo} type="button">
        Continuar
      </TusActionButton>
    </section>
  )
}
