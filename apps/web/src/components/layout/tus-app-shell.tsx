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
          <Link href="/tus?surface=discovery">Market</Link>
          <Link href="/tus?surface=commitments">Commitments</Link>
          <Link href="/tus/operations">Operations</Link>
          <Link href="/tus/pos">POS</Link>
        </div>
      </nav>
      {children}
    </main>
  )
}
