'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

import { createTusWebAuthClient, toTusWebSession } from '@/lib/tus-auth-client'
import { TrabajoPrestador } from '@/components/prestador/trabajo-prestador'
import { CuentaCobro } from '@/components/prestador/cuenta-cobro'
import {
  createTusWebClient,
  createTusWebFetchTransport,
  type TusMerchantBookingMode,
  type TusMerchantCohort,
  type TusMerchantListing,
  type TusMerchantListingKind,
  type TusMerchantListingInput,
  type TusMerchantOperationsResponse,
  type TusMerchantPriceMode,
  type TusMerchantProfile,
} from '@/lib/tus-client'
import { formatTusDate, type TusWebSession } from '@/lib/tus-ui-contract'
import { TusActionButton, TusStateMessage } from './tus-ui'

type ProviderState = {
  status: 'loading' | 'ready' | 'empty' | 'error' | 'disabled'
  profile: TusMerchantProfile | null
  listings: readonly TusMerchantListing[]
  message: string
}

type FormState = {
  status: 'idle' | 'submitting' | 'success' | 'error'
  message: string
}

type ProfileDraft = {
  merchantId: string
  cohort: TusMerchantCohort
  locationId: string
  timezone: string
  staffRoles: string
  operatingPolicyVersion: string
}

type ListingDraft = {
  kind: TusMerchantListingKind
  name: string
  description: string
  currency: string
  price: string
  stock: string
  bookingMode: TusMerchantBookingMode
  priceMode: TusMerchantPriceMode
  capacity: string
  durationMinutes: string
  estimatedDurationMinutes: string
  workingDay: string
  workingStart: string
  workingEnd: string
}

const EMPTY_PROVIDER_STATE: ProviderState = {
  status: 'loading',
  profile: null,
  listings: [],
  message: 'Loading the provider workspace from TUS…',
}

const DEFAULT_PROFILE_DRAFT: ProfileDraft = {
  merchantId: '',
  cohort: 'beauty-personal-care',
  locationId: '',
  timezone: 'America/Argentina/Buenos_Aires',
  staffRoles: 'owner',
  operatingPolicyVersion: 'tus-marketplace-v1',
}

const DEFAULT_LISTING_DRAFT: ListingDraft = {
  kind: 'service',
  name: '',
  description: '',
  currency: 'ARS',
  price: '',
  stock: '1',
  bookingMode: 'fixed_shift',
  priceMode: 'fixed',
  capacity: '1',
  durationMinutes: '60',
  estimatedDurationMinutes: '60',
  workingDay: '1',
  workingStart: '09:00',
  workingEnd: '18:00',
}

export function TusPrestadorSurface(): React.ReactNode {
  const [session, setSession] = useState<TusWebSession | null | undefined>(undefined)
  const [authMessage, setAuthMessage] = useState('Restoring your secure session.')
  const [authStatus, setAuthStatus] = useState<
    'restoring' | 'unauthenticated' | 'expired' | 'unavailable' | 'authenticated'
  >('restoring')
  const [providerState, setProviderState] = useState<ProviderState>(EMPTY_PROVIDER_STATE)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(DEFAULT_PROFILE_DRAFT)
  const [listingDraft, setListingDraft] = useState<ListingDraft>(DEFAULT_LISTING_DRAFT)
  const [profileForm, setProfileForm] = useState<FormState>({ status: 'idle', message: '' })
  const [listingForm, setListingForm] = useState<FormState>({ status: 'idle', message: '' })
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [publishMessage, setPublishMessage] = useState('')

  useEffect(() => {
    void createTusWebAuthClient()
      .restore(window.location.pathname)
      .then((result) => {
        setAuthStatus(result.status)
        setAuthMessage(result.message)
        setSession(result.session === undefined ? null : toTusWebSession(result.session))
      })
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (session === null) {
      setProviderState({
        status: 'disabled',
        profile: null,
        listings: [],
        message: 'An authenticated TUS session is required.',
      })
      return
    }
    if (!hasPermission(session, 'tus:marketplace:read')) {
      setProviderState({
        status: 'disabled',
        profile: null,
        listings: [],
        message:
          'This session does not have the marketplace read permission required by the current API.',
      })
      return
    }
    let cancelled = false
    setProviderState({ ...EMPTY_PROVIDER_STATE })
    void loadProviderData(session)
      .then((data) => {
        if (cancelled) return
        const listings = data.listings ?? data.items ?? []
        setProviderState({
          status: data.merchant === null || data.merchant === undefined ? 'empty' : 'ready',
          profile: data.merchant ?? null,
          listings,
          message:
            data.merchant === null || data.merchant === undefined
              ? 'No provider profile is recorded for this tenant yet.'
              : 'Provider facts and listings are current from TUS.',
        })
        if (data.merchant !== null && data.merchant !== undefined) {
          setProfileDraft((current) => ({
            merchantId: data.merchant?.merchantId ?? current.merchantId,
            cohort: data.merchant?.cohort ?? current.cohort,
            locationId: data.merchant?.locationId ?? current.locationId,
            timezone: data.merchant?.timezone ?? current.timezone,
            staffRoles: data.merchant?.staffRoles.join(', ') ?? current.staffRoles,
            operatingPolicyVersion:
              data.merchant?.operatingPolicyVersion ?? current.operatingPolicyVersion,
          }))
        }
      })
      .catch((error) => {
        if (cancelled) return
        if (errorStatus(error) === 401) {
          createTusWebAuthClient().clearLocalSession()
          setSession(null)
        }
        setProviderState({
          status: 'error',
          profile: null,
          listings: [],
          message: providerErrorMessage(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [session])

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (session === null || session === undefined || profileForm.status === 'submitting') return
    const staffRoles = profileDraft.staffRoles
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean)
    if (
      !profileDraft.merchantId.trim() ||
      !profileDraft.locationId.trim() ||
      !profileDraft.timezone.trim() ||
      staffRoles.length === 0 ||
      !profileDraft.operatingPolicyVersion.trim()
    ) {
      setProfileForm({
        status: 'error',
        message: 'Merchant, location, timezone, staff roles, and policy version are required.',
      })
      return
    }
    if (!hasPermission(session, 'tus:marketplace:write')) {
      setProfileForm({
        status: 'error',
        message: 'This session cannot change marketplace provider facts.',
      })
      return
    }
    setProfileForm({ status: 'submitting', message: 'Saving the provider profile in TUS…' })
    try {
      const profile = await createTusWebClient(createTusWebFetchTransport()).onboardMerchant({
        ...session,
        merchantId: profileDraft.merchantId.trim(),
        cohort: profileDraft.cohort,
        locationId: profileDraft.locationId.trim(),
        timezone: profileDraft.timezone.trim(),
        staffRoles,
        operatingPolicyVersion: profileDraft.operatingPolicyVersion.trim(),
      })
      setProviderState((current) => ({
        ...current,
        status: 'ready',
        profile,
        message: 'Provider facts are current from TUS.',
      }))
      setProfileForm({ status: 'success', message: 'Provider profile saved and approved by TUS.' })
    } catch (error) {
      setProfileForm({ status: 'error', message: providerErrorMessage(error) })
    }
  }

  async function createListing(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (
      session === null ||
      session === undefined ||
      providerState.profile === null ||
      listingForm.status === 'submitting'
    )
      return
    if (!hasPermission(session, 'tus:marketplace:write')) {
      setListingForm({
        status: 'error',
        message: 'This session cannot create marketplace listings.',
      })
      return
    }
    const price = Number(listingDraft.price)
    if (
      !listingDraft.name.trim() ||
      !listingDraft.description.trim() ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      setListingForm({
        status: 'error',
        message: 'Name, description, and a positive price are required.',
      })
      return
    }
    const common = {
      ...session,
      merchantId: providerState.profile.merchantId,
      kind: listingDraft.kind,
      name: listingDraft.name.trim(),
      description: listingDraft.description.trim(),
      cohort: providerState.profile.cohort,
      locationId: providerState.profile.locationId,
      currency: listingDraft.currency.trim().toUpperCase(),
      price,
    }
    const stock =
      listingDraft.kind === 'product'
        ? parsePositiveInteger(listingDraft.stock, 'stock', true)
        : undefined
    if (typeof stock === 'string') {
      setListingForm({ status: 'error', message: stock })
      return
    }
    const input: TusMerchantListingInput | { error: string } =
      listingDraft.kind === 'product'
        ? { ...common, stock }
        : buildServiceListingInput(common, listingDraft)
    if ('error' in input) {
      setListingForm({ status: 'error', message: input.error })
      return
    }
    setListingForm({ status: 'submitting', message: 'Creating the listing in TUS…' })
    try {
      const listing = await createTusWebClient(createTusWebFetchTransport()).createMerchantListing(
        input
      )
      setProviderState((current) => ({
        ...current,
        status: 'ready',
        listings: [listing, ...current.listings],
        message: 'Provider facts and listings are current from TUS.',
      }))
      setListingDraft((current) => ({
        ...DEFAULT_LISTING_DRAFT,
        kind: current.kind,
        currency: current.currency,
      }))
      setListingForm({
        status: 'success',
        message: 'Listing created as a draft. Publish it only after reviewing the server facts.',
      })
    } catch (error) {
      setListingForm({ status: 'error', message: providerErrorMessage(error) })
    }
  }

  async function publishListing(listingId: string): Promise<void> {
    if (session === null || session === undefined || publishingId !== null) return
    if (!hasPermission(session, 'tus:marketplace:write')) {
      setPublishMessage('This session cannot publish marketplace listings.')
      return
    }
    setPublishingId(listingId)
    setPublishMessage('Publishing the listing through TUS…')
    try {
      const listing = await createTusWebClient(createTusWebFetchTransport()).publishMerchantListing(
        session,
        listingId
      )
      setProviderState((current) => ({
        ...current,
        listings: current.listings.map((item) =>
          item.listingId === listing.listingId ? listing : item
        ),
        message: 'Provider facts and listings are current from TUS.',
      }))
      setPublishMessage('TUS confirmed the listing as published.')
    } catch (error) {
      setPublishMessage(providerErrorMessage(error))
    } finally {
      setPublishingId(null)
    }
  }

  return (
    <>
      <div className="tus-nav-links tus-session-actions">
        <Link href="/tus?surface=discovery">Market</Link>
        <Link href="/tus/operations">Operations</Link>
        <Link href="/tus/pos">POS</Link>
        <Link href="/tus/soporte">Support</Link>
      </div>
      <header className="tus-workspace-header">
        <div>
          <p className="tus-kicker">TUS / provider</p>
          <h1>
            Put the offer
            <br />
            <em>on solid ground.</em>
          </h1>
        </div>
        <p className="tus-intro">
          <strong>Server facts first</strong>Onboarding, listings, and publication status come from
          the authenticated tenant. TUS does not infer calendar readiness or provider activation.
        </p>
      </header>
      {session === undefined ? (
        <TusStateMessage state={{ status: 'loading', message: 'Restoring your secure session…' }} />
      ) : session === null ? (
        <TusStateMessage
          state={{
            status: authStatus === 'unavailable' ? 'error' : 'disabled',
            message: authMessage,
          }}
        >
          <a
            className="tus-action-button tus-action-link"
            href={`/sign-in?returnTo=${encodeURIComponent('/tus/prestador')}`}
          >
            Sign in through TUS
          </a>
        </TusStateMessage>
      ) : (
        <div className="tus-prestador-workspace">
          <section className="tus-prestador-overview" aria-labelledby="provider-overview-title">
            <div className="tus-section-label">
              <span>01</span>
              <h2 id="provider-overview-title">Provider record.</h2>
            </div>
            <TusStateMessage
              state={{
                status: providerState.status,
                message: providerState.message,
                resource: 'Provider operations',
                retry:
                  providerState.status === 'error' ? () => window.location.reload() : undefined,
              }}
            />
            {providerState.profile === null ? null : (
              <dl className="tus-prestador-facts">
                <div>
                  <dt>Merchant</dt>
                  <dd>{providerState.profile.merchantId}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{providerState.profile.locationId}</dd>
                </div>
                <div>
                  <dt>Cohort</dt>
                  <dd>{providerState.profile.cohort}</dd>
                </div>
                <div>
                  <dt>Policy</dt>
                  <dd>{providerState.profile.operatingPolicyVersion}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {providerState.profile.status} ·{' '}
                    {formatTusDate(providerState.profile.updatedAt)}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section className="tus-prestador-panel" aria-labelledby="provider-profile-title">
            <div className="tus-section-label">
              <span>02</span>
              <h2 id="provider-profile-title">Onboard or update.</h2>
            </div>
            <form
              className="tus-prestador-form"
              onSubmit={(event) => void saveProfile(event)}
              noValidate
            >
              <label htmlFor="provider-merchant-id">
                Merchant ID
                <input
                  id="provider-merchant-id"
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, merchantId: event.target.value }))
                  }
                  required
                  value={profileDraft.merchantId}
                />
              </label>
              <label htmlFor="provider-location-id">
                Location ID
                <input
                  id="provider-location-id"
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, locationId: event.target.value }))
                  }
                  required
                  value={profileDraft.locationId}
                />
              </label>
              <label htmlFor="provider-cohort">
                Cohort
                <select
                  id="provider-cohort"
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      cohort: event.target.value as TusMerchantCohort,
                    }))
                  }
                  value={profileDraft.cohort}
                >
                  <option value="beauty-personal-care">Beauty and personal care</option>
                  <option value="repairs-trades">Repairs and trades</option>
                </select>
              </label>
              <label htmlFor="provider-timezone">
                Timezone
                <input
                  id="provider-timezone"
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, timezone: event.target.value }))
                  }
                  required
                  value={profileDraft.timezone}
                />
              </label>
              <label htmlFor="provider-staff-roles">
                Staff roles
                <input
                  id="provider-staff-roles"
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, staffRoles: event.target.value }))
                  }
                  placeholder="owner, operator"
                  required
                  value={profileDraft.staffRoles}
                />
              </label>
              <label htmlFor="provider-policy-version">
                Operating policy
                <input
                  id="provider-policy-version"
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      operatingPolicyVersion: event.target.value,
                    }))
                  }
                  required
                  value={profileDraft.operatingPolicyVersion}
                />
              </label>
              <TusActionButton
                disabled={!hasPermission(session, 'tus:marketplace:write')}
                loading={profileForm.status === 'submitting'}
                loadingLabel="Saving provider…"
                type="submit"
              >
                Save provider profile
              </TusActionButton>
              <FormFeedback state={profileForm} />
            </form>
          </section>

          <section className="tus-prestador-panel" aria-labelledby="provider-listing-title">
            <div className="tus-section-label">
              <span>03</span>
              <h2 id="provider-listing-title">Create a listing.</h2>
            </div>
            {providerState.profile === null ? (
              <TusStateMessage
                state={{
                  status: 'disabled',
                  message: 'Complete provider onboarding before creating a listing.',
                }}
              />
            ) : (
              <form
                className="tus-prestador-form"
                onSubmit={(event) => void createListing(event)}
                noValidate
              >
                <label htmlFor="listing-kind">
                  Kind
                  <select
                    id="listing-kind"
                    onChange={(event) =>
                      setListingDraft((current) => ({
                        ...current,
                        kind: event.target.value as TusMerchantListingKind,
                      }))
                    }
                    value={listingDraft.kind}
                  >
                    <option value="service">Service</option>
                    <option value="product">Product</option>
                  </select>
                </label>
                <label htmlFor="listing-name">
                  Name
                  <input
                    id="listing-name"
                    onChange={(event) =>
                      setListingDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                    value={listingDraft.name}
                  />
                </label>
                <label htmlFor="listing-description">
                  Description
                  <textarea
                    id="listing-description"
                    onChange={(event) =>
                      setListingDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    required
                    rows={4}
                    value={listingDraft.description}
                  />
                </label>
                <div className="tus-prestador-form-grid">
                  <label htmlFor="listing-price">
                    Price
                    <input
                      id="listing-price"
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) =>
                        setListingDraft((current) => ({ ...current, price: event.target.value }))
                      }
                      required
                      step="0.01"
                      type="number"
                      value={listingDraft.price}
                    />
                  </label>
                  <label htmlFor="listing-currency">
                    Currency
                    <input
                      id="listing-currency"
                      maxLength={3}
                      onChange={(event) =>
                        setListingDraft((current) => ({ ...current, currency: event.target.value }))
                      }
                      required
                      value={listingDraft.currency}
                    />
                  </label>
                </div>
                {listingDraft.kind === 'product' ? (
                  <label htmlFor="listing-stock">
                    Stock
                    <input
                      id="listing-stock"
                      min="0"
                      onChange={(event) =>
                        setListingDraft((current) => ({ ...current, stock: event.target.value }))
                      }
                      required
                      type="number"
                      value={listingDraft.stock}
                    />
                  </label>
                ) : (
                  <>
                    <div className="tus-prestador-form-grid">
                      <label htmlFor="listing-booking-mode">
                        Booking mode
                        <select
                          id="listing-booking-mode"
                          onChange={(event) =>
                            setListingDraft((current) => ({
                              ...current,
                              bookingMode: event.target.value as TusMerchantBookingMode,
                            }))
                          }
                          value={listingDraft.bookingMode}
                        >
                          <option value="fixed_shift">Fixed shift</option>
                          <option value="visita_diagnostico">Diagnostic visit</option>
                          <option value="variable_duration">Variable duration</option>
                          <option value="duracion_estimada">Estimated duration</option>
                          <option value="requiere_presupuesto">Requires budget</option>
                        </select>
                      </label>
                      <label htmlFor="listing-price-mode">
                        Price mode
                        <select
                          id="listing-price-mode"
                          onChange={(event) =>
                            setListingDraft((current) => ({
                              ...current,
                              priceMode: event.target.value as TusMerchantPriceMode,
                            }))
                          }
                          value={listingDraft.priceMode}
                        >
                          <option value="fixed">Fixed</option>
                          <option value="precio_desde">From price</option>
                          <option value="por_hora">Hourly</option>
                          <option value="requires_budget">Requires budget</option>
                        </select>
                      </label>
                    </div>
                    <div className="tus-prestador-form-grid">
                      <label htmlFor="listing-capacity">
                        Capacity
                        <input
                          id="listing-capacity"
                          min="1"
                          onChange={(event) =>
                            setListingDraft((current) => ({
                              ...current,
                              capacity: event.target.value,
                            }))
                          }
                          required
                          type="number"
                          value={listingDraft.capacity}
                        />
                      </label>
                      {requiresFixedDuration(listingDraft.bookingMode) ? (
                        <label htmlFor="listing-duration">
                          Duration minutes
                          <input
                            id="listing-duration"
                            min="1"
                            onChange={(event) =>
                              setListingDraft((current) => ({
                                ...current,
                                durationMinutes: event.target.value,
                              }))
                            }
                            required
                            type="number"
                            value={listingDraft.durationMinutes}
                          />
                        </label>
                      ) : null}
                      {requiresEstimatedDuration(listingDraft.bookingMode) ? (
                        <label htmlFor="listing-estimated-duration">
                          Estimated minutes
                          <input
                            id="listing-estimated-duration"
                            min="1"
                            onChange={(event) =>
                              setListingDraft((current) => ({
                                ...current,
                                estimatedDurationMinutes: event.target.value,
                              }))
                            }
                            required
                            type="number"
                            value={listingDraft.estimatedDurationMinutes}
                          />
                        </label>
                      ) : null}
                    </div>
                    <div className="tus-prestador-form-grid tus-prestador-hours">
                      <label htmlFor="listing-working-day">
                        Working day (0-6)
                        <input
                          id="listing-working-day"
                          max="6"
                          min="0"
                          onChange={(event) =>
                            setListingDraft((current) => ({
                              ...current,
                              workingDay: event.target.value,
                            }))
                          }
                          required
                          type="number"
                          value={listingDraft.workingDay}
                        />
                      </label>
                      <label htmlFor="listing-working-start">
                        Starts
                        <input
                          id="listing-working-start"
                          onChange={(event) =>
                            setListingDraft((current) => ({
                              ...current,
                              workingStart: event.target.value,
                            }))
                          }
                          required
                          type="time"
                          value={listingDraft.workingStart}
                        />
                      </label>
                      <label htmlFor="listing-working-end">
                        Ends
                        <input
                          id="listing-working-end"
                          onChange={(event) =>
                            setListingDraft((current) => ({
                              ...current,
                              workingEnd: event.target.value,
                            }))
                          }
                          required
                          type="time"
                          value={listingDraft.workingEnd}
                        />
                      </label>
                    </div>
                  </>
                )}
                <TusActionButton
                  disabled={!hasPermission(session, 'tus:marketplace:write')}
                  loading={listingForm.status === 'submitting'}
                  loadingLabel="Creating listing…"
                  type="submit"
                >
                  Create draft listing
                </TusActionButton>
                <FormFeedback state={listingForm} />
              </form>
            )}
          </section>

          <section className="tus-prestador-panel" aria-labelledby="provider-listings-title">
            <div className="tus-section-label">
              <span>04</span>
              <h2 id="provider-listings-title">Review and publish.</h2>
            </div>
            {providerState.listings.length === 0 ? (
              <TusStateMessage
                state={{ status: 'empty', message: 'No tenant-owned listings are recorded yet.' }}
              />
            ) : (
              <ul className="tus-prestador-listings">
                {providerState.listings.map((listing) => (
                  <li key={listing.listingId}>
                    <div>
                      <strong>{listing.name}</strong>
                      <span>
                        {listing.kind} · {listing.published ? 'published' : 'draft'} ·{' '}
                        {listing.currency} {listing.price}
                      </span>
                      <small>
                        {listing.listingId} · updated {formatTusDate(listing.updatedAt)}
                      </small>
                    </div>
                    {!listing.published ? (
                      <TusActionButton
                        disabled={
                          publishingId !== null || !hasPermission(session, 'tus:marketplace:write')
                        }
                        loading={publishingId === listing.listingId}
                        loadingLabel="Publishing…"
                        onClick={() => void publishListing(listing.listingId)}
                        type="button"
                      >
                        Publish
                      </TusActionButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {publishMessage === '' ? null : (
              <p className="tus-prestador-publish-message" role="status">
                {publishMessage}
              </p>
            )}
            <p className="tus-prestador-note">
              Service listings can be published with the current API, but availability remains{' '}
              <strong>not configured</strong> until an active provider calendar is exposed and
              confirmed by TUS.
            </p>
          </section>
          <CuentaCobro
            onUnauthorized={() => {
              createTusWebAuthClient().clearLocalSession()
              setAuthStatus('expired')
              setAuthMessage('Your TUS session expired. Sign in again to continue.')
              setSession(null)
            }}
            session={session}
          />
          <TrabajoPrestador
            onUnauthorized={() => {
              createTusWebAuthClient().clearLocalSession()
              setAuthStatus('expired')
              setAuthMessage('Your TUS session expired. Sign in again to continue.')
              setSession(null)
            }}
            session={session}
          />
        </div>
      )}
    </>
  )
}

async function loadProviderData(session: TusWebSession): Promise<TusMerchantOperationsResponse> {
  return createTusWebClient(createTusWebFetchTransport()).merchantMarketplaceOperations(session)
}

function buildServiceListingInput(
  common: {
    accessToken?: string
    tenantId: string
    actorId: string
    correlationId: string
    sessionId?: string
    merchantId: string
    kind: TusMerchantListingKind
    name: string
    description: string
    cohort: TusMerchantCohort
    locationId: string
    currency: string
    price: number
  },
  draft: ListingDraft
): TusMerchantListingInput | { error: string } {
  const capacity = parsePositiveInteger(draft.capacity, 'capacity')
  const workingDay = parseNonNegativeInteger(draft.workingDay, 'working day')
  if (typeof capacity === 'string') return { error: capacity }
  if (typeof workingDay === 'string') return { error: workingDay }
  if (workingDay > 6) return { error: 'Working day must be between 0 and 6.' }
  if (!draft.workingStart || !draft.workingEnd || draft.workingStart >= draft.workingEnd)
    return { error: 'Working hours must have a valid start and end.' }
  const durationMinutes = requiresFixedDuration(draft.bookingMode)
    ? parsePositiveInteger(draft.durationMinutes, 'duration')
    : undefined
  const estimatedDurationMinutes = requiresEstimatedDuration(draft.bookingMode)
    ? parsePositiveInteger(draft.estimatedDurationMinutes, 'estimated duration')
    : undefined
  if (typeof durationMinutes === 'string') return { error: durationMinutes }
  if (typeof estimatedDurationMinutes === 'string') return { error: estimatedDurationMinutes }
  return {
    ...common,
    capacity,
    workingHours: [{ day: workingDay, start: draft.workingStart, end: draft.workingEnd }],
    bookingMode: draft.bookingMode,
    priceMode: draft.priceMode,
    ...(durationMinutes === undefined ? {} : { durationMinutes }),
    ...(estimatedDurationMinutes === undefined ? {} : { estimatedDurationMinutes }),
  }
}

function requiresFixedDuration(mode: TusMerchantBookingMode): boolean {
  return mode === 'fixed_shift' || mode === 'visita_diagnostico'
}

function requiresEstimatedDuration(mode: TusMerchantBookingMode): boolean {
  return mode === 'variable_duration' || mode === 'duracion_estimada'
}

function parsePositiveInteger(value: string, label: string, allowZero = false): number | string {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0))
    return `${label} must be a ${allowZero ? 'non-negative' : 'positive'} integer.`
  return parsed
}

function parseNonNegativeInteger(value: string, label: string): number | string {
  return parsePositiveInteger(value, label, true)
}

function hasPermission(session: TusWebSession, permission: string): boolean {
  return (
    session.permissions?.includes(permission) === true ||
    session.permissions?.includes('tus:*') === true
  )
}

function errorStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  )
    return error.status
  return undefined
}

function providerErrorMessage(error: unknown): string {
  if (errorStatus(error) === 403)
    return 'This authenticated session is not authorized for the provider operation.'
  if (errorStatus(error) === 409)
    return 'TUS rejected the operation because the provider facts are not ready or conflict with the listing.'
  if (errorStatus(error) === 503)
    return 'The provider operation is unavailable until its TUS gate is enabled.'
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return 'TUS did not confirm the provider operation. No success is claimed.'
}

function FormFeedback({ state }: { state: FormState }): React.ReactNode {
  return state.message === '' ? null : (
    <p
      className={`tus-prestador-feedback tus-feedback-${state.status}`}
      role={state.status === 'error' ? 'alert' : 'status'}
    >
      {state.message}
    </p>
  )
}

const tusPrestadorModule = { TusPrestadorSurface }

export default tusPrestadorModule
