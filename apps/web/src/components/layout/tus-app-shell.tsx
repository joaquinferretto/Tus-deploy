import Link from 'next/link'

export function TusAppShell({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <main className="tus-shell tus-dashboard" id="tus-main-content">
      <a className="tus-skip-link" href="#tus-main-content">
        Skip to main content
      </a>
      <nav className="tus-nav" aria-label="TUS workspace navigation">
        <Link className="tus-mark" href="/tus">
          TUS / workspace
        </Link>
        <div className="tus-nav-links">
          <Link href="/tus">Workspace</Link>
          <a href="/tus/mercado">Mercado</a>
          <a href="/tus/compromisos">Compromisos</a>
          <Link href="/tus/operations">Operations</Link>
          <Link href="/tus/pos">POS</Link>
          <a href="/tus/soporte">Support</a>
        </div>
      </nav>
      {children}
    </main>
  )
}
