'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { AdminMfaGate } from './admin-mfa-gate'
import styles from './admin.module.css'

// Only sections with real functionality behind them.
const NAV = [
  { href: '/tus/admin', label: 'Inicio' },
  { href: '/tus/admin/usuarios', label: 'Usuarios' },
  { href: '/tus/admin/prestadores', label: 'Prestadores' },
  { href: '/tus/admin/solicitudes', label: 'Solicitudes' },
  { href: '/tus/admin/servicios', label: 'Servicios' },
  { href: '/tus/admin/zonas', label: 'Zonas' },
  { href: '/tus/admin/whatsapp', label: 'WhatsApp' },
  { href: '/tus/admin/identidad', label: 'Identidad' },
  { href: '/tus/admin/seguridad', label: 'Seguridad' },
] as const

// Frame of the platform administration: sidebar + content, in the TUS visual identity. The MFA gate
// wraps everything; the API still authorizes every admin request.
export function AdminLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  const pathname = usePathname() ?? '/tus/admin'
  const [open, setOpen] = useState(false)
  const current = (href: string) => (href === '/tus/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)) ? 'page' : undefined

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topActions}>
          <button aria-controls="admin-sidebar" aria-expanded={open} className={styles.menuButton} onClick={() => setOpen((value) => !value)} type="button">
            Menú
          </button>
          <Link className={styles.brand} href="/tus/admin">
            TUS <span>Admin</span>
          </Link>
        </div>
        <Link className={styles.accountLink} href="/mi-perfil">
          Mi cuenta
        </Link>
      </header>
      <nav aria-label="Administración" className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`} id="admin-sidebar">
        {NAV.map((item) => (
          <Link aria-current={current(item.href)} href={item.href as Route} key={item.href} onClick={() => setOpen(false)}>
            {item.label}
          </Link>
        ))}
        <div className={styles.sidebarFooter}>
          <Link href="/">← Volver al mapa</Link>
        </div>
      </nav>
      {open ? <button aria-label="Cerrar el menú" className={styles.overlay} onClick={() => setOpen(false)} type="button" /> : null}
      <main className={styles.content} id="contenido">
        <AdminMfaGate returnTo={pathname}>{children}</AdminMfaGate>
      </main>
    </div>
  )
}

export function AdminPageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }): React.ReactNode {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.toolbar} style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  )
}

export function AdminEmpty({ text, action }: { text: string; action?: React.ReactNode }): React.ReactNode {
  return (
    <div className={styles.empty}>
      <p>{text}</p>
      {action}
    </div>
  )
}
