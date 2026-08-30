'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { sanitizeTusReturnTo } from '@/lib/tus-auth-client'
import { TusSkipLink } from '@/app/tus/tus-ui'

export default function RecoveryPage(): React.ReactNode {
  const [returnTo, setReturnTo] = useState('/tus')

  useEffect(() => {
    setReturnTo(
      sanitizeTusReturnTo(new URLSearchParams(window.location.search).get('returnTo') ?? undefined)
    )
  }, [])

  return (
    <>
      <TusSkipLink />
      <main className="tus-shell tus-auth-page" id="tus-main-content">
        <nav className="tus-nav" aria-label="TUS recovery navigation">
          <Link className="tus-mark" href="/">
            TUS / recovery
          </Link>
          <Link href="/">Back to overview</Link>
        </nav>
        <section className="tus-auth-panel" aria-labelledby="recovery-title">
          <p className="tus-kicker">Session recovery</p>
          <h1 id="recovery-title">
            The door is closed
            <br />
            <em>until TUS confirms you.</em>
          </h1>
          <p className="tus-auth-lede">
            Your previous session is expired, revoked, malformed, or temporarily unavailable.
            Protected tenant data remains withheld.
          </p>
          <Link
            className="tus-action-button tus-action-link"
            href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
          >
            Return to secure sign in
          </Link>
          <p className="tus-boundary-note">
            No token, tenant, actor, or permission is displayed or accepted on this recovery page.
          </p>
        </section>
      </main>
    </>
  )
}
