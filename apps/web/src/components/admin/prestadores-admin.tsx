'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import type { CatalogoOficios } from '@factory/contracts'
import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { authorizationHeader } from '@/lib/session-credentials'
import { apiBase, createDirectoryClient } from '@/features/directory/directory-client'
import { TusActionButton } from '@/app/tus/tus-ui'

export function PrestadoresAdmin() {
  const [catalog, setCatalog] = useState<CatalogoOficios | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  useEffect(() => {
    void createDirectoryClient().catalog().then(setCatalog).catch(() => setMessage('No pudimos cargar los oficios. Recargá la página.'))
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    setProfileId(null)
    try {
      const restored = await createTusWebAuthClient().restore('/tus/admin/prestadores')
      if (!restored.session) { setMessage('Iniciá sesión nuevamente.'); return }
      const session = toTusWebSession(restored.session)
      const response = await fetch(`${apiBase()}/tus/v1/admin/prestadores`, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { ...authorizationHeader(session.accessToken), 'Content-Type': 'application/json', 'X-Correlation-Id': crypto.randomUUID() },
        body: JSON.stringify({
          email: form.get('email'), displayName: form.get('displayName'), profession: form.get('profession'),
          zone: form.get('zone'), serviceZones: [form.get('zone')], serviceMode: form.get('serviceMode'),
          description: form.get('description'), visible: form.get('visible') === 'on',
        }),
      })
      const result = await response.json() as { code?: string; profile?: { id: string }; fields?: string[] }
      if (!response.ok) {
        setMessage(response.status === 403 ? 'Volvé a Seguridad y confirmá tu segundo factor; después iniciá sesión nuevamente si te faltan permisos.'
          : result.code === 'VERIFIED_ACCOUNT_REQUIRED' ? 'Ese email tiene un registro pendiente de confirmar de otra persona: usá otro email.'
          : result.code === 'PROVIDER_NOT_APPROVED' ? 'El prestador no está aprobado. Esta pantalla no cambia ese estado.'
          : result.fields?.length ? `Revisá los campos: ${result.fields.join(', ')}.` : 'No pudimos guardar el perfil. Revisá los datos e intentá nuevamente.')
        return
      }
      setMessage('Perfil guardado. La identidad y los trabajos completados se verifican por sus procesos habituales.')
      setProfileId(result.profile?.id ?? null)
    } catch { setMessage('No pudimos contactar al servidor. Intentá nuevamente.') }
    finally { setBusy(false) }
  }

  return <>
    <nav className="tus-nav-links"><Link href="/tus/admin/seguridad">Seguridad y autenticador</Link><Link href="/tus/admin/identidad">Verificación de identidad</Link></nav>
    <header className="tus-workspace-header"><div><p className="tus-kicker">Administración</p><h1>Cargar o editar un prestador</h1></div></header>
    <p>Si el email ya tiene una cuenta confirmada, se actualiza su perfil (su contraseña no cambia). Si no tiene cuenta, se crea un prestador administrado: sin contraseña y sin email para confirmar, nadie puede iniciar sesión con él; sirve para cargar prestadores a mano y probar la búsqueda.</p>
    <form className="tus-support-form" onSubmit={event => void save(event)}>
      <label htmlFor="provider-email">Email de la cuenta del prestador</label><input id="provider-email" name="email" type="email" maxLength={254} required autoComplete="off" />
      <label htmlFor="provider-name">Nombre público</label><input id="provider-name" name="displayName" minLength={2} maxLength={60} required />
      <label htmlFor="provider-profession">Oficio</label><select id="provider-profession" name="profession" required defaultValue=""><option value="" disabled>Elegí un oficio</option>{catalog?.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <label htmlFor="provider-zone">Barrio / zona</label><select id="provider-zone" name="zone" required defaultValue=""><option value="" disabled>Elegí una zona</option>{catalog?.zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select>
      <label htmlFor="provider-mode">Modalidad</label><select id="provider-mode" name="serviceMode" defaultValue="domicilio"><option value="domicilio">A domicilio</option><option value="local">En su local</option><option value="mixto">Ambas</option></select>
      <label htmlFor="provider-description">Descripción del servicio</label><textarea id="provider-description" name="description" maxLength={600} />
      <label><input type="checkbox" name="visible" defaultChecked /> Mostrar en el directorio</label>
      <TusActionButton type="submit" disabled={!catalog} loading={busy}>Guardar prestador</TusActionButton>
    </form>
    {message ? <p role="status">{message}</p> : null}
    {profileId ? <Link href={{ pathname: `/trabajadores/${profileId}` }}>Ver perfil público</Link> : null}
  </>
}
