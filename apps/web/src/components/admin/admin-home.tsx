import Link from 'next/link'

// Platform administration home: only the admin surfaces that exist. Rendered behind AdminMfaGate;
// every action is authorized again by the API (allowlist + verified email + MFA of this session).
const SECTIONS = [
  { href: '/tus/admin/prestadores', title: 'Prestadores', text: 'Cargar o editar prestadores del directorio.' },
  { href: '/tus/admin/identidad', title: 'Verificación de identidad', text: 'Revisar las verificaciones pendientes.' },
  { href: '/tus/admin/whatsapp', title: 'WhatsApp', text: 'Conversaciones del asistente de WhatsApp.' },
  { href: '/tus/admin/seguridad', title: 'Seguridad', text: 'Segundo factor y códigos de recuperación.' },
] as const

export function AdminHome() {
  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <Link href="/">Volver al inicio</Link>
        <Link href="/mi-perfil">Mi perfil</Link>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">Administración</p>
          <h1>Panel admin</h1>
        </div>
      </header>
      <ul style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', listStyle: 'none', margin: 0, padding: 0 }}>
        {SECTIONS.map((section) => (
          <li className="tus-state-box" key={section.href}>
            <Link href={section.href}>
              <strong>{section.title}</strong>
            </Link>
            <p style={{ margin: '6px 0 0' }}>{section.text}</p>
          </li>
        ))}
      </ul>
    </>
  )
}
