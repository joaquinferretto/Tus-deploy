'use client'

import { usePathname } from 'next/navigation'

// The navigation of the provider side, in ONE place (it used to be written by hand on every
// /prestador page). Real routes only.
export const PROVIDER_NAV = [
  { href: '/prestador/solicitudes', label: 'Solicitudes' },
  { href: '/prestador/turnos', label: 'Turnos y agenda' },
  { href: '/trabajos', label: 'Mis trabajos' },
  { href: '/prestador/perfil-publico', label: 'Servicios y perfil' },
  { href: '/prestador/pagos', label: 'Pagos' },
  { href: '/prestador/ubicacion', label: 'Ubicación' },
  { href: '/ayuda/prestadores', label: 'Manual' },
] as const

export function ProviderNav(): React.ReactNode {
  const pathname = usePathname() ?? ''
  return (
    <nav aria-label="Prestador" data-nav-prestador style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 16 }}>
      {PROVIDER_NAV.map((item) => {
        const actual = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <a aria-current={actual ? 'page' : undefined} href={item.href} key={item.href} style={actual ? { fontWeight: 700, color: 'var(--tus-orange, #ff5a00)' } : undefined}>
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}
