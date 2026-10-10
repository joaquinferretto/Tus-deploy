'use client'

import { usePathname } from 'next/navigation'

import layout from '../layout/layout.module.css'

// The navigation of the provider side, in ONE place (it used to be written by hand on every
// /prestador page). Real routes only.
export const PROVIDER_NAV = [
  { href: '/prestador/solicitudes', label: 'Solicitudes' },
  { href: '/prestador/turnos', label: 'Agenda' },
  { href: '/trabajos', label: 'Trabajos' },
  { href: '/prestador/perfil-publico', label: 'Servicios y perfil' },
  { href: '/prestador/pagos', label: 'Ganancias' },
  { href: '/prestador/ubicacion', label: 'Ubicación' },
] as const
const AYUDA_PRESTADOR = { href: '/ayuda/prestadores', label: 'Manual del prestador' } as const

export function ProviderNav(): React.ReactNode {
  const pathname = usePathname() ?? ''
  return (
    <nav aria-label="Prestador" className={layout.tabs} data-nav-prestador>
      {PROVIDER_NAV.map((item) => {
        const actual = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <a aria-current={actual ? 'page' : undefined} href={item.href} key={item.href}>
            {item.label}
          </a>
        )
      })}
      <a className={layout.tabAside} href={AYUDA_PRESTADOR.href}>
        {AYUDA_PRESTADOR.label}
      </a>
    </nav>
  )
}
