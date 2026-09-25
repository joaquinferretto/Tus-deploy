import Link from 'next/link'
import { buildTusJourneyLinks } from '../lib/tus-journeys'
import { TusSkipLink } from './tus/tus-ui'

export default function HomePage(): React.ReactNode {
  const journeys = buildTusJourneyLinks({
    roles: ['customer', 'merchant', 'operations', 'staff'],
    permissions: ['tus:read', 'tus:operations:read', 'tus:pos:write'],
  })

  return (
    <>
      <TusSkipLink />
      <main className="tus-shell" id="tus-main-content">
        <nav className="tus-nav" aria-label="TUS primary navigation">
          <Link className="tus-mark" href="/">
            TUS / field notes
          </Link>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/recovery">Recover access</Link>
        </nav>
        <section className="tus-hero tus-reveal" aria-labelledby="home-title">
          <div>
            <p className="tus-kicker">Marketplace · merchant work · Argentina</p>
            <h1 id="home-title">
              Work with
              <br />
              <em>the facts.</em>
            </h1>
          </div>
          <p className="tus-intro">
            <strong>A quieter kind of commerce</strong>TUS keeps product promises, service promises,
            operations, and payment boundaries visible—then asks the server what is true.
          </p>
        </section>
        <section className="tus-grid" aria-label="TUS customer and staff journeys">
          <article className="tus-card tus-card-landing">
            <div>
              <p className="tus-kicker">01 / Start here</p>
              <h3>Enter without guessing.</h3>
              <p>
                Sign in through the approved boundary. Your tenant and permissions come from the
                confirmed session, never from a form field.
              </p>
            </div>
            <Link className="tus-card-footer" href="/sign-in">
              Open secure entry <span aria-hidden="true">→</span>
            </Link>
          </article>
          {journeys.map((journey, index) => (
            <article
              className="tus-card tus-journey-card"
              data-journey={journey.key}
              key={journey.key}
            >
              <div>
                <p className="tus-kicker">
                  {String(index + 2).padStart(2, '0')} / {journey.label}
                </p>
                <h3>{journey.label}</h3>
                <p>{journey.description}</p>
              </div>
              <a className="tus-card-footer" href={journey.href}>
                Open {journey.label} journey <span aria-hidden="true">→</span>
              </a>
            </article>
          ))}
        </section>
        <section
          className="tus-boundary-note tus-landing-boundary"
          aria-label="TUS evidence boundary"
        >
          <strong>One clear boundary</strong>
           <p>
             Payment provider capture, settlement, delivery completion, and support handoff are only
             shown when TUS returns those facts. A pending or unavailable state stays named. Online
             operation requires connectivity; installability does not promise offline operation.
           </p>
          <Link href="/tus?surface=commitments">Review the promise ledger →</Link>
        </section>
        <section className="tus-boundary-note" aria-label="TUS PWA capabilities">
          <strong>Installable, not magically offline</strong>
          <p>
            Install TUS for faster return. Updates are announced before replacement, and offline
            records remain queued until the server can acknowledge the same intent.
          </p>
          <span data-pwa-capability="install update offline">Install · update · offline queue</span>
        </section>
        <p className="tus-footer-note">
          <span>Buenos Aires / 2026</span>
          <span>Protected surfaces stay protected.</span>
        </p>
      </main>
    </>
  )
}
