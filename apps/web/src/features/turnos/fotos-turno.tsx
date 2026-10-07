'use client'

import { useEffect, useRef, useState } from 'react'

import { turnosErrorDe, turnosFetch } from '../../lib/tus-turnos-client'

// TURNOS-WHATSAPP-01: the pictures of a request of turno (at most two). They are private: only
// the client and the provider of that turno read them, through the session, so they are fetched
// (never linked by address). The client of a request that still waits may add them.
const MAXIMO = 2

function Foto({ turnoId, orden }: { turnoId: string; orden: number }): React.ReactNode {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vigente = true
    let creada: string | null = null
    void turnosFetch(`/tus/v1/turnos/${encodeURIComponent(turnoId)}/imagenes/${orden}`, { headers: { Accept: 'image/*' } })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || !vigente) return
        creada = URL.createObjectURL(blob)
        setUrl(creada)
      })
      .catch(() => undefined)
    return () => {
      vigente = false
      if (creada) URL.revokeObjectURL(creada)
    }
  }, [turnoId, orden])
  if (!url) return <span aria-hidden style={{ width: 72, height: 72, borderRadius: 8, background: '#f3f4f6', display: 'inline-block' }} />
  return (
    <a href={url} rel="noreferrer" target="_blank">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`Foto ${orden + 1} de la solicitud`} data-foto-turno={orden} src={url} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', display: 'block' }} />
    </a>
  )
}

export function FotosTurno({ turnoId, cantidad, puedeAgregar = false }: { turnoId: string; cantidad: number; puedeAgregar?: boolean }): React.ReactNode {
  const [total, setTotal] = useState(Math.min(MAXIMO, Math.max(0, cantidad)))
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const archivo = useRef<HTMLInputElement>(null)

  const subir = async (file: File) => {
    setError('')
    if (file.size > 2 * 1024 * 1024) return setError('Usá una foto de hasta 2 MB.')
    setSubiendo(true)
    try {
      // The raw bytes: the API decides the type by the content, not by the name.
      const response = await turnosFetch(`/tus/v1/cliente/turnos/${encodeURIComponent(turnoId)}/imagenes`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } })
      if (!response.ok) throw await turnosErrorDe(response, 'No pudimos sumar la foto. Usá un JPG, PNG o WEBP de hasta 2 MB.')
      const hecho = (await response.json()) as { total: number }
      setTotal(Math.min(MAXIMO, hecho.total))
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No pudimos sumar la foto.')
    } finally {
      setSubiendo(false)
    }
  }

  if (total === 0 && !puedeAgregar) return null
  return (
    <div data-fotos-turno={total} style={{ display: 'grid', gap: 6 }}>
      {total > 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Array.from({ length: total }, (_, orden) => <Foto key={orden} orden={orden} turnoId={turnoId} />)}
        </div>
      ) : null}
      {puedeAgregar && total < MAXIMO ? (
        <div>
          <input
            accept="image/jpeg,image/png,image/webp"
            data-fotos-turno-archivo
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void subir(file)
            }}
            ref={archivo}
            type="file"
          />
          <button data-fotos-turno-agregar disabled={subiendo} onClick={() => archivo.current?.click()} style={{ minHeight: 40, padding: '0.35rem 0.8rem', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }} type="button">
            {subiendo ? 'Subiendo…' : total === 0 ? 'Sumar una foto (opcional)' : 'Sumar otra foto'}
          </button>
          <span style={{ marginLeft: 8, fontSize: '0.85rem', color: '#6b7280' }}>Hasta {MAXIMO} fotos de lo que necesitás.</span>
        </div>
      ) : null}
      {error ? <span role="alert" style={{ color: '#b91c1c', fontSize: '0.9rem' }}>{error}</span> : null}
    </div>
  )
}
