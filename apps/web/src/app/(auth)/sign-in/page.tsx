'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createTusWebAuthClient, sanitizeTusReturnTo } from '@/lib/tus-auth-client'
import { TusActionButton, TusFieldError, TusSkipLink } from '@/app/tus/tus-ui'

export default function SignInPage(): React.ReactNode {
  const router = useRouter()
  const [returnTo, setReturnTo] = useState('/tus')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setReturnTo(sanitizeTusReturnTo(new URLSearchParams(window.location.search).get('returnTo') ?? undefined))
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setStatus('submitting')
    setMessage('')
    const result = await createTusWebAuthClient().signIn({ email, password })
    if (result.status !== 'authenticated' || result.session === undefined) {
      setStatus('error')
      setMessage(result.message)
      return
    }
    // The protected route is entered only after both auth endpoints confirm scope.
    router.replace((result.returnTo ?? returnTo) as Parameters<typeof router.replace>[0])
  }

  return (
    <>
      <TusSkipLink />
      <main className="tus-shell tus-auth-page" id="tus-main-content">
      <nav className="tus-nav" aria-label="TUS primary navigation"><Link className="tus-mark" href="/">TUS / entry</Link><Link href="/">Back to overview</Link></nav>
      <section className="tus-auth-panel" aria-labelledby="sign-in-title">
        <p className="tus-kicker">Argentina-first workspace</p>
        <h1 id="sign-in-title">Come back to the work<br /><em>with the facts intact.</em></h1>
        <p className="tus-auth-lede">TUS confirms your identity and tenant scope with the server before showing workspace data. Nothing is inferred from this form.</p>
          <form aria-describedby={message === '' ? undefined : 'sign-in-error'} className="tus-auth-form" onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="email">Email address<input aria-describedby={message === '' ? undefined : 'sign-in-error'} aria-invalid={status === 'error'} id="email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label htmlFor="password">Password<input aria-describedby={message === '' ? undefined : 'sign-in-error'} aria-invalid={status === 'error'} id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {message === '' ? null : <TusFieldError id="sign-in-error" message={message} />}
          <TusActionButton loading={status === 'submitting'} loadingLabel="Verifying with TUS…" type="submit">Sign in securely</TusActionButton>
        </form>
        <p className="tus-boundary-note"><a href={`/recovery?returnTo=${encodeURIComponent(returnTo)}`}>Session expired or unavailable?</a> Recovery clears the local credential before asking you to authenticate again.</p>
      </section>
      </main>
    </>
  )
}
