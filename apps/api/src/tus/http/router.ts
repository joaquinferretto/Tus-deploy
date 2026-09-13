import express, { type Request, type Response, type Router } from 'express'
import { TUS_CONTRACT_VERSION, type TusCartLine } from '@factory/contracts'
import type { TusApplicationService, TusCheckoutResult } from '../application/tus-application-service.ts'
import type {
  TusAuthenticatedTenantContext,
  TusSessionResolverPort,
} from '../ports/index.ts'
import {
  MarketplaceError,
  type MarketplaceCheckoutLine,
  type MarketplaceDiscoveryItem,
  type MarketplaceListing,
  type MarketplaceListingInput,
} from '../catalog/index.ts'
import { TusCommitmentError } from '../commitments/index.ts'
import { FinanceError } from '../finance/index.ts'
import { DeliveryError } from '../delivery/index.ts'
import { PosError } from '../pos/index.ts'
import { ReportingError, createDiscoverySeoModel, createRobots, createSitemap } from '../reporting/index.ts'
import { SupportError } from '../support/index.ts'
import { WhatsAppActionError } from '../whatsapp/index.ts'
import { ServiceCalendarError } from '../calendar/index.ts'
import { HabilitacionBloqueadaError, type EvaluadorHabilitacion, type PerfilHabilitacion } from '../readiness/index.ts'

const TUS_API_VERSION = 'v1'

export interface TusHttpRouterDependencies {
  application: TusApplicationService
  sessions: TusSessionResolverPort
  now?: () => number
  onAuthorizationDenied?: (event: TusAuthorizationDeniedEvent) => Promise<void>
  evaluadorHabilitacion?: EvaluadorHabilitacion
}

export interface TusAuthorizationDeniedEvent {
  action: string
  actorId: string
  tenantId: string
  correlationId: string
  reason: 'spoofed_authority' | 'cross_tenant_resource'
}

function canonicalizeLegacyMarketplacePath(request: Request, _response: Response, next: () => void): void {
  const legacyPrefix = '/tus/marketplace'
  if (request.path === legacyPrefix || request.path.startsWith(`${legacyPrefix}/`)) {
    request.url = `/tus/${TUS_API_VERSION}/marketplace${request.url.slice(legacyPrefix.length)}`
  }
  next()
}

function rejectUnsupportedTusApiVersion(request: Request, response: Response, next: () => void): void {
  const version = request.path.match(/^\/tus\/(v[^/]+)(?:\/|$)/)?.[1]
  if (version !== undefined && version !== TUS_API_VERSION) {
    sendError(response, 404, 'UNSUPPORTED_API_VERSION', 'Unsupported TUS API version')
    return
  }
  next()
}

export function createTusHttpRouter({ application, sessions, now = () => Date.now(), onAuthorizationDenied, evaluadorHabilitacion }: TusHttpRouterDependencies): Router {
  const router = express.Router()
  const guard = evaluadorHabilitacion ?? application.evaluadorHabilitacion

  router.use(canonicalizeLegacyMarketplacePath)
  router.use(rejectUnsupportedTusApiVersion)

  router.use(async (request: Request, response: Response, next) => {
    if (!guard || request.method !== 'POST') {
      next()
      return
    }
    const capability = capacidadHabilitacionPorRuta(request.path)
    if (!capability || routeIsGuardedByApplication(request.path, application)) {
      next()
      return
    }
    const context = await authenticate(request, sessions)
    if (!context || !tienePermisoHabilitacion(context, capability)) {
      next()
      return
    }
    try {
      await guard.require({
        tenantId: context.tenantId,
        actorId: context.subjectId,
        correlationId: context.correlationId,
        capability,
        profile: (readHeader(request, 'x-tus-readiness-profile') || 'native-local') as PerfilHabilitacion,
        scope: readHeader(request, 'x-tus-readiness-scope') || 'argentina-stage-1',
      })
      next()
    } catch (error) {
      enviarErrorHabilitacion(response, error)
    }
  })

  router.post('/tus/checkout', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:checkout')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS checkout is not authorized')
      return
    }

    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      await recordAuthorizationDenied(onAuthorizationDenied, 'tus.checkout', context, 'spoofed_authority')
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }

    const idempotencyKey = readHeader(request, 'idempotency-key')
    const requestHash = readString(body, 'requestHash')
    const cartId = readString(body, 'cartId')
    const lines = readLines(body['lines'])
    if (!idempotencyKey || !requestHash || !cartId || !lines) {
      sendError(response, 400, 'INVALID', 'cartId, requestHash, lines, and idempotency-key are required')
      return
    }

    const createdAt = readString(body, 'createdAt') || new Date(now()).toISOString()
    const expiresAt = readFiniteNumber(body, 'expiresAt') ?? now() + 5 * 60 * 1000
    try {
      const result = await application.checkout({
        tenantId: context.tenantId,
        actorId: context.subjectId,
        correlationId: context.correlationId,
        idempotencyKey,
        cartId,
        createdAt,
        requestHash,
        recordId: `tus-${context.tenantId}-${idempotencyKey}`,
        expiresAt,
        lines,
      })
      sendCheckoutResult(response, result)
    } catch (error) {
      if (error instanceof HabilitacionBloqueadaError) {
        enviarErrorHabilitacion(response, error)
        return
      }
      sendError(response, 500, 'UNAVAILABLE', 'TUS checkout was not committed')
    }
  })

  router.get('/tus/commitments/:commitmentId', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:read')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS commitment access is not authorized')
      return
    }

    if (hasSpoofedAuthority({}, request, context)) {
      await recordAuthorizationDenied(onAuthorizationDenied, 'tus.commitment.read', context, 'spoofed_authority')
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }

    const result = await application.getCommitment(
      { tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId },
      request.params['commitmentId'] ?? '',
    )
    if (result.status === 'forbidden') {
      await recordAuthorizationDenied(onAuthorizationDenied, 'tus.commitment.read', context, 'cross_tenant_resource')
      sendError(response, 403, 'FORBIDDEN', 'TUS commitment access is not authorized')
      return
    }
    if (result.status === 'not_found') {
      sendError(response, 404, 'NOT_FOUND', 'TUS commitment was not found')
      return
    }
    response.status(200).json(result.commitment)
  })

  router.post(['/tus/commitments/:commitmentId/transition', '/tus/v1/commitments/:commitmentId/transition'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasAnyPermission(context, ['tus:commitments:write', 'tus:checkout'])) {
      sendError(response, 403, 'FORBIDDEN', 'TUS commitment lifecycle is not authorized')
      return
    }
    if (hasSpoofedAuthority(body, request, context)) {
      await recordAuthorizationDenied(onAuthorizationDenied, 'tus.commitment.transition', context, 'spoofed_authority')
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    const idempotencyKey = readHeader(request, 'idempotency-key')
    const requestHash = readString(body, 'requestHash')
    const expectedVersion = readFiniteNumber(body, 'expectedVersion')
    if (!idempotencyKey || !requestHash || expectedVersion === undefined || !Number.isInteger(expectedVersion)) {
      sendError(response, 400, 'INVALID', 'expectedVersion, requestHash, and idempotency-key are required')
      return
    }
    try {
      const result = await application.transitionCommitment({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, commitmentId: request.params['commitmentId'] ?? '', toStatus: readString(body, 'toStatus') as never, expectedVersion, idempotencyKey, requestHash, reason: readString(body, 'reason'), createdAt: readString(body, 'createdAt') || new Date(now()).toISOString() })
      response.status(result.status === 'replay' ? 200 : 200).json(result)
    } catch (error) {
      sendCommitmentError(response, error)
    }
  })

  router.post(['/tus/commitments/:commitmentId/compensate', '/tus/v1/commitments/:commitmentId/compensate'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasAnyPermission(context, ['tus:commitments:write', 'tus:checkout'])) {
      sendError(response, 403, 'FORBIDDEN', 'TUS commitment compensation is not authorized')
      return
    }
    if (hasSpoofedAuthority(body, request, context)) {
      await recordAuthorizationDenied(onAuthorizationDenied, 'tus.commitment.compensate', context, 'spoofed_authority')
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    const idempotencyKey = readHeader(request, 'idempotency-key')
    const requestHash = readString(body, 'requestHash')
    const expectedVersion = readFiniteNumber(body, 'expectedVersion')
    const amount = readFiniteNumber(body, 'amount')
    if (!idempotencyKey || !requestHash || expectedVersion === undefined || !Number.isInteger(expectedVersion) || amount === undefined) {
      sendError(response, 400, 'INVALID', 'amount, expectedVersion, requestHash, and idempotency-key are required')
      return
    }
    try {
      const result = await application.compensateCommitment({ tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId, commitmentId: request.params['commitmentId'] ?? '', expectedVersion, idempotencyKey, requestHash, amount, reason: readString(body, 'reason'), createdAt: readString(body, 'createdAt') || new Date(now()).toISOString() })
      response.status(result.status === 'replay' ? 200 : 200).json(result)
    } catch (error) {
      sendCommitmentError(response, error)
    }
  })

  router.post('/tus/v1/marketplace/onboarding', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:marketplace:write')) {
      await recordMarketplaceDenied(application, context, 'merchant.onboard', readString(asRecord(request.body), 'merchantId'))
      sendError(response, 403, 'FORBIDDEN', 'TUS marketplace onboarding is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      await recordMarketplaceDenied(application, context, 'merchant.onboard', readString(body, 'merchantId'))
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const profile = await requireMarketplace(application).onboard(context, body)
      response.status(201).json(profile)
    } catch (error) {
      sendMarketplaceError(response, error)
    }
  })

  router.post('/tus/v1/marketplace/listings', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:marketplace:write')) {
      await recordMarketplaceDenied(application, context, 'listing.create', '')
      sendError(response, 403, 'FORBIDDEN', 'TUS marketplace catalog access is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      await recordMarketplaceDenied(application, context, 'listing.create', readString(body, 'merchantId'))
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const listing = await requireMarketplace(application).createListing(context, body as unknown as MarketplaceListingInput)
      response.status(201).json(toPublicMarketplaceListing(listing))
    } catch (error) {
      sendMarketplaceError(response, error)
    }
  })

  router.post('/tus/v1/marketplace/listings/:listingId/publish', async (request: Request, response: Response) => {
    const pathListingId = request.path.split('/').at(-2) ?? ''
    const listingId = request.params['listingId'] && request.params['listingId'] !== 'undefined' ? request.params['listingId'] : pathListingId
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:marketplace:write')) {
      await recordMarketplaceDenied(application, context, 'listing.publish', listingId)
      sendError(response, 403, 'FORBIDDEN', 'TUS marketplace catalog access is not authorized')
      return
    }
    if (hasSpoofedAuthority({}, request, context)) {
      await recordMarketplaceDenied(application, context, 'listing.publish', listingId)
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const listing = await requireMarketplace(application).publishListing(context, listingId)
      response.status(200).json(toPublicMarketplaceListing(listing))
    } catch (error) {
      sendMarketplaceError(response, error)
    }
  })

  router.get('/tus/v1/marketplace/discovery', async (request: Request, response: Response) => {
    try {
      const discovery = await requireMarketplace(application).discover({
        ...(readQueryString(request.query['locationId']) ? { locationId: readQueryString(request.query['locationId']) } : {}),
        ...(readQueryString(request.query['cohort']) ? { cohort: readQueryString(request.query['cohort']) as 'beauty-personal-care' | 'repairs-trades' } : {}),
      })
      response.status(200).json({ ...discovery, items: discovery.items.map(toPublicMarketplaceListing) })
    } catch (error) {
      sendMarketplaceError(response, error)
    }
  })

  router.get('/tus/v1/marketplace/merchant/operations', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:marketplace:read')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS merchant operations are not authorized')
      return
    }
    if (hasSpoofedAuthority({}, request, context)) {
      await recordMarketplaceDenied(application, context, 'merchant.operations', context.tenantId)
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const operations = await requireMarketplace(application).merchantOperations(context)
      response.status(200).json({ ...operations, listings: operations.listings.map(toPublicMarketplaceListing) })
    } catch (error) {
      sendMarketplaceError(response, error)
    }
  })

  router.post('/tus/v1/marketplace/checkout', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:checkout')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS marketplace checkout is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      await recordMarketplaceDenied(application, context, 'checkout', readString(body, 'cartId'))
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    const idempotencyKey = readHeader(request, 'idempotency-key')
    const cartId = readString(body, 'cartId')
    const requestHash = readString(body, 'requestHash')
    const lines = readMarketplaceLines(body['lines'])
    if (!idempotencyKey || !cartId || !requestHash || !lines) {
      sendError(response, 400, 'INVALID', 'cartId, requestHash, lines, and idempotency-key are required')
      return
    }
    const bodyIdempotencyKey = readOptionalString(body, 'idempotencyKey')
    if (bodyIdempotencyKey !== undefined && bodyIdempotencyKey !== idempotencyKey) {
      sendError(response, 400, 'IDEMPOTENCY_KEY_MISMATCH', 'The idempotency key header and body must match')
      return
    }
    const contractVersion = body['contractVersion']
    if (contractVersion !== undefined && contractVersion !== TUS_CONTRACT_VERSION) {
      sendError(response, 400, 'UNSUPPORTED_CONTRACT_VERSION', 'Unsupported TUS marketplace contract version')
      return
    }
    try {
      const result = await requireMarketplace(application).checkout({
        tenantId: context.tenantId,
        actorId: context.subjectId,
        correlationId: context.correlationId,
        idempotencyKey,
        cartId,
        requestHash,
        createdAt: readString(body, 'createdAt') || new Date().toISOString(),
        lines,
      })
      response.status(result.status === 'replay' ? 200 : 201).json(result)
    } catch (error) {
      sendMarketplaceError(response, error)
    }
  })

  router.get('/tus/v1/marketplace/customer/commitments', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:marketplace:read')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS customer commitments are not authorized')
      return
    }
    if (hasSpoofedAuthority({}, request, context)) {
      await recordMarketplaceDenied(application, context, 'customer.commitments', context.tenantId)
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      response.status(200).json(await requireMarketplace(application).customerCommitments(context))
    } catch (error) {
      sendMarketplaceError(response, error)
    }
  })

  router.get('/tus/v1/marketplace/customer/commitments/:commitmentId', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:marketplace:read')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS customer commitments are not authorized')
      return
    }
    if (hasSpoofedAuthority({}, request, context)) {
      await recordMarketplaceDenied(application, context, 'customer.commitment.read', request.params['commitmentId'] ?? '')
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      response.status(200).json(await requireMarketplace(application).customerCommitment(context, request.params['commitmentId'] ?? ''))
    } catch (error) {
      if (error instanceof MarketplaceError && error.code === 'FORBIDDEN') {
        await recordMarketplaceDenied(application, context, 'customer.commitment.read', request.params['commitmentId'] ?? '')
      }
      sendMarketplaceError(response, error)
    }
  })

  router.post('/tus/v1/calendar', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasAnyPermission(context, ['tus:calendar:write', 'tus:marketplace:write']) || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS calendar management is not authorized')
      return
    }
    try {
      response.status(201).json(await requireCalendar(application).createCalendar(context, body as never))
    } catch (error) { sendCalendarError(response, error) }
  })

  router.get('/tus/v1/calendar/:calendarId/slots', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasAnyPermission(context, ['tus:calendar:read', 'tus:marketplace:read']) || hasSpoofedAuthority({}, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS calendar access is not authorized')
      return
    }
    const date = readQueryString(request.query['date'])
    if (!date) { sendError(response, 400, 'INVALID', 'date is required'); return }
    try {
      response.status(200).json({ slots: await requireCalendar(application).slots(context, request.params['calendarId'] ?? '', date, readQueryString(request.query['now'])) })
    } catch (error) { sendCalendarError(response, error) }
  })

  router.post('/tus/v1/calendar/bookings', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasAnyPermission(context, ['tus:calendar:read', 'tus:marketplace:read']) || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS service booking is not authorized')
      return
    }
    const idempotencyKey = readHeader(request, 'idempotency-key') || readString(body, 'idempotencyKey')
    const requestHash = readString(body, 'requestHash')
    if (!idempotencyKey || !requestHash) { sendError(response, 400, 'INVALID', 'requestHash and idempotency-key are required'); return }
    try {
      const result = await requireCalendar(application).book(context, { calendarId: readString(body, 'calendarId'), serviceId: readString(body, 'serviceId'), customerId: readString(body, 'customerId'), slotId: readString(body, 'slotId'), idempotencyKey, requestHash, now: readString(body, 'now') || new Date(now()).toISOString() })
      response.status(result.status === 'replay' ? 200 : result.status === 'rejected' ? 409 : 201).json(result)
    } catch (error) { sendCalendarError(response, error) }
  })

  router.post('/tus/v1/calendar/bookings/:bookingId/cancel', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasAnyPermission(context, ['tus:calendar:read', 'tus:marketplace:read']) || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS booking cancellation is not authorized')
      return
    }
    try {
      response.status(200).json(await requireCalendar(application).cancel(context, { bookingId: request.params['bookingId'] ?? '', now: readString(body, 'now') || new Date(now()).toISOString(), reason: readString(body, 'reason'), ...(readFiniteNumber(body, 'expectedVersion') === undefined ? {} : { expectedVersion: readFiniteNumber(body, 'expectedVersion') }) }))
    } catch (error) { sendCalendarError(response, error) }
  })

  router.post('/tus/v1/calendar/bookings/:bookingId/no-show', async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:calendar:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS no-show management is not authorized')
      return
    }
    try {
      response.status(200).json(await requireCalendar(application).markNoShow(context, { bookingId: request.params['bookingId'] ?? '', now: readString(body, 'now') || new Date(now()).toISOString() }))
    } catch (error) { sendCalendarError(response, error) }
  })

  router.post(['/tus/finance/payment-intents', '/tus/v1/finance/payment-intents'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasAnyPermission(context, ['tus:finance:write', 'tus:checkout'])) {
      sendError(response, 403, 'FORBIDDEN', 'TUS finance access is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    const commitmentId = readString(body, 'commitmentId')
    const requestHash = readString(body, 'requestHash')
    const idempotencyKey = readHeader(request, 'idempotency-key')
    if (!commitmentId || !requestHash || !idempotencyKey) {
      sendError(response, 400, 'INVALID', 'commitmentId, requestHash, and idempotency-key are required')
      return
    }
    try {
       const result = await requireFinance(application).createPaymentIntent({ ...financeContext(context), commitmentId, orderId: readString(body, 'orderId') || undefined, posOperationId: readString(body, 'posOperationId') || null, requestHash, idempotencyKey })
      response.status(result.status === 'replay' ? 200 : result.status === 'held' ? 202 : 201).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/evidence', '/tus/v1/finance/evidence'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasAnyPermission(context, ['tus:finance:write', 'tus:checkout'])) {
      sendError(response, 403, 'FORBIDDEN', 'TUS finance access is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const evidence = await requireFinance(application).recordEvidence({
        ...financeContext(context),
        commitmentId: readString(body, 'commitmentId'),
        evidenceId: readString(body, 'evidenceId'),
        kind: readString(body, 'kind') as 'completion' | 'check-in' | 'delivery-accepted',
        occurredAt: readString(body, 'occurredAt'),
      })
      response.status(201).json(evidence)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/confirmations', '/tus/v1/finance/confirmations'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasAnyPermission(context, ['tus:finance:confirm', 'tus:checkout'])) {
      sendError(response, 403, 'FORBIDDEN', 'TUS finance confirmation is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const result = await requireFinance(application).confirmCompletion({
        ...financeContext(context),
        commitmentId: readString(body, 'commitmentId'),
        confirmationId: readString(body, 'confirmationId'),
        confirmedAt: readString(body, 'confirmedAt') || new Date(now()).toISOString(),
      })
      response.status(result.status === 'released' ? 200 : 202).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/release', '/tus/v1/finance/release'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:finance:write')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS settlement release is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const result = await requireFinance(application).release({ ...financeContext(context), commitmentId: readString(body, 'commitmentId'), now: readString(body, 'now') || new Date(now()).toISOString() })
      response.status(result.status === 'released' ? 200 : 202).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/release-jobs', '/tus/v1/finance/release-jobs'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:finance:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS release jobs are not authorized')
      return
    }
    try {
      const result = await requireFinance(application).enqueueReleaseJob({ ...financeContext(context), commitmentId: readString(body, 'commitmentId') })
      response.status(202).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/disputes', '/tus/v1/finance/disputes'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:finance:write')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS dispute access is not authorized')
      return
    }
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const result = await requireFinance(application).openDispute({ ...financeContext(context), commitmentId: readString(body, 'commitmentId') })
      response.status(201).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/refunds', '/tus/v1/finance/refunds'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:finance:write')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS refund access is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const result = await requireFinance(application).refund({ ...financeContext(context), commitmentId: readString(body, 'commitmentId'), amount: readFiniteNumber(body, 'amount') ?? NaN, reason: readString(body, 'reason'), idempotencyKey: readHeader(request, 'idempotency-key') })
      response.status(201).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/chargebacks', '/tus/v1/finance/chargebacks'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:finance:write')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS chargeback access is not authorized')
      return
    }
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const result = await requireFinance(application).chargeback({ ...financeContext(context), commitmentId: readString(body, 'commitmentId') })
      response.status(201).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/finance/reconciliation', '/tus/v1/finance/reconciliation'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:finance:write')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS reconciliation access is not authorized')
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    try {
      const result = await requireFinance(application).reconcile({ ...financeContext(context), commitmentId: readString(body, 'commitmentId'), providerReference: readString(body, 'providerReference'), providerAmount: readFiniteNumber(body, 'providerAmount') ?? NaN })
      response.status(result.status === 'clean' ? 200 : 202).json(result)
    } catch (error) {
      sendFinanceError(response, error)
    }
  })

  router.post(['/tus/delivery/zones', '/tus/v1/delivery/zones'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:delivery:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS delivery access is not authorized')
      return
    }
    try {
      response.status(201).json(await requireDelivery(application).createZone(context, { zoneId: readString(body, 'zoneId'), name: readString(body, 'name'), postalCodes: readStringArray(body['postalCodes']) }))
    } catch (error) { sendDeliveryError(response, error) }
  })

  router.post(['/tus/delivery/shifts', '/tus/v1/delivery/shifts'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:delivery:write') || hasSpoofedAuthority(body, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS delivery access is not authorized'); return }
    try {
      response.status(201).json(await requireDelivery(application).openShift(context, { shiftId: readString(body, 'shiftId'), zoneId: readString(body, 'zoneId'), startsAt: readString(body, 'startsAt'), endsAt: readString(body, 'endsAt'), operatorIds: readStringArray(body['operatorIds']) }))
    } catch (error) { sendDeliveryError(response, error) }
  })

  router.post(['/tus/delivery/shifts/:shiftId/close', '/tus/v1/delivery/shifts/:shiftId/close'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:delivery:write') || hasSpoofedAuthority({}, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS delivery access is not authorized'); return }
    try { response.status(200).json(await requireDelivery(application).closeShift(context, request.params['shiftId'] ?? '')) } catch (error) { sendDeliveryError(response, error) }
  })

  router.post(['/tus/delivery/tasks', '/tus/v1/delivery/tasks'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:delivery:write') || hasSpoofedAuthority(body, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS delivery access is not authorized'); return }
    try {
      response.status(201).json(await requireDelivery(application).createTaskFromCommitment(context, { taskId: readString(body, 'taskId'), commitmentId: readString(body, 'commitmentId'), zoneId: readString(body, 'zoneId'), shiftId: readString(body, 'shiftId'), ...(readString(body, 'operatorId') ? { operatorId: readString(body, 'operatorId') } : {}) }))
    } catch (error) { sendDeliveryError(response, error) }
  })

  router.post(['/tus/delivery/tasks/:taskId/accept', '/tus/v1/delivery/tasks/:taskId/accept'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.acceptTask(context, request.params['taskId'] ?? '', readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/assign', '/tus/v1/delivery/tasks/:taskId/assign'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.assignTask(context, request.params['taskId'] ?? '', readString(body, 'operatorId'), readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/pick-up', '/tus/v1/delivery/tasks/:taskId/pick-up'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.transitionTask(context, request.params['taskId'] ?? '', 'picked-up', readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/transit', '/tus/v1/delivery/tasks/:taskId/transit'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.transitionTask(context, request.params['taskId'] ?? '', 'in-transit', readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/handoff', '/tus/v1/delivery/tasks/:taskId/handoff'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body) => application.handoffDelivery(context, request.params['taskId'] ?? '', readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/proof', '/tus/v1/delivery/tasks/:taskId/proof'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body) => application.recordDeliveryProof(context, { taskId: request.params['taskId'] ?? '', proofId: readString(body, 'proofId'), recipientName: readString(body, 'recipientName'), capturedAt: readString(body, 'capturedAt'), evidenceSource: readString(body, 'evidenceSource') as 'authorized' | 'deterministic-test-only' }, readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/fail', '/tus/v1/delivery/tasks/:taskId/fail'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.failTask(context, request.params['taskId'] ?? '', { incidentId: readString(body, 'incidentId'), reason: readString(body, 'reason') }, readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/resolve-incident', '/tus/v1/delivery/tasks/:taskId/resolve-incident'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.resolveIncident(context, request.params['taskId'] ?? '', readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/return', '/tus/v1/delivery/tasks/:taskId/return'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.returnTask(context, request.params['taskId'] ?? '', readVersion(body)))
  })

  router.post(['/tus/delivery/tasks/:taskId/cancel', '/tus/v1/delivery/tasks/:taskId/cancel'], async (request: Request, response: Response) => {
    await deliveryMutation(request, response, sessions, application, (context, body, delivery) => delivery.cancelTask(context, request.params['taskId'] ?? '', readVersion(body), readString(body, 'reason')))
  })

  router.get(['/tus/delivery/tasks', '/tus/v1/delivery/tasks'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:delivery:read') || hasSpoofedAuthority({}, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS delivery access is not authorized'); return }
    try { response.status(200).json({ tasks: await requireDelivery(application).listTasks(context) }) } catch (error) { sendDeliveryError(response, error) }
  })

  router.post(['/tus/delivery/public-bidding', '/tus/v1/delivery/public-bidding'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:delivery:write') || hasSpoofedAuthority(asRecord(request.body), request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS delivery access is not authorized'); return }
    try { await requireDelivery(application).openPublicBidding(context, { taskId: readString(asRecord(request.body), 'taskId') }); } catch (error) { sendDeliveryError(response, error) }
  })

  router.post(['/tus/pos/manual-operations', '/tus/v1/pos/manual-operations'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:pos:write')) { sendError(response, 403, 'FORBIDDEN', 'TUS POS access is not authorized'); return }
    if (hasSpoofedAuthority(body, request, context)) { sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session'); return }
    try {
      const result = await requirePos(application).recordManualOperation(context, body as never)
      response.status(result.status === 'conflict' ? 409 : 201).json(result)
    } catch (error) { sendPosError(response, error) }
  })

  router.get(['/tus/pos/operations/:operationId/status', '/tus/v1/pos/operations/:operationId/status'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasAnyPermission(context, ['tus:pos:write', 'tus:pos:read']) || hasSpoofedAuthority({}, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS status access is not authorized'); return }
    try { response.status(200).json(await requirePos(application).getOperationStatus(context, request.params['operationId'] ?? '')) } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/pos/refunds', '/tus/v1/pos/refunds'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasAnyPermission(context, ['tus:pos:refund', 'tus:pos:write']) || hasSpoofedAuthority(body, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS refund access is not authorized'); return }
    try {
      const result = await requirePos(application).refund(context, { refundId: readString(body, 'refundId'), originalOperationId: readString(body, 'originalOperationId'), idempotencyKey: readHeader(request, 'idempotency-key') || readString(body, 'idempotencyKey'), amount: readFiniteNumber(body, 'amount') ?? NaN, reason: readString(body, 'reason'), expectedVersion: readFiniteNumber(body, 'expectedVersion') ?? NaN })
      response.status(201).json(result)
    } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/pos/operations/:operationId/cancel', '/tus/v1/pos/operations/:operationId/cancel'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasAnyPermission(context, ['tus:pos:refund', 'tus:pos:write']) || hasSpoofedAuthority(body, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS cancellation access is not authorized'); return }
    try {
      const result = await requirePos(application).cancelOperation(context, { cancellationId: readString(body, 'cancellationId'), originalOperationId: request.params['operationId'] ?? '', idempotencyKey: readHeader(request, 'idempotency-key') || readString(body, 'idempotencyKey'), reason: readString(body, 'reason'), expectedVersion: readFiniteNumber(body, 'expectedVersion') ?? NaN })
      response.status(201).json(result)
    } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/pos/printer-failures', '/tus/v1/pos/printer-failures'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:pos:write') || hasSpoofedAuthority(body, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS printer recovery is not authorized'); return }
    try { response.status(201).json(await requirePos(application).recordPrinterFailure(context, { failureId: readString(body, 'failureId'), operationId: readString(body, 'operationId'), reason: readString(body, 'reason') })) } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/pos/devices', '/tus/v1/pos/devices'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:pos:write') || hasSpoofedAuthority({ ...body, sessionId: undefined }, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS access is not authorized'); return }
    try { response.status(201).json(await requirePos(application).registerDevice(context, { deviceId: readString(body, 'deviceId'), label: readString(body, 'label'), fingerprint: readString(body, 'fingerprint') })) } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/pos/sessions', '/tus/v1/pos/sessions'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:pos:write') || hasSpoofedAuthority({ ...body, sessionId: undefined }, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS access is not authorized'); return }
    try { response.status(201).json(await requirePos(application).openSession(context, { sessionId: readString(body, 'sessionId'), deviceId: readString(body, 'deviceId'), shiftId: readString(body, 'shiftId') })) } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/pos/sessions/:sessionId/close', '/tus/v1/pos/sessions/:sessionId/close'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:pos:write') || hasSpoofedAuthority({}, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS access is not authorized'); return }
    try { response.status(200).json(await requirePos(application).closeSession(context, request.params['sessionId'] ?? '')) } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/pos/conflicts/:conflictId/resolve', '/tus/v1/pos/conflicts/:conflictId/resolve'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:pos:write') || hasSpoofedAuthority(body, request, context)) { sendError(response, 403, 'FORBIDDEN', 'TUS POS access is not authorized'); return }
    const resolution = readString(body, 'resolution')
    if (resolution !== 'discard' && resolution !== 'retry') { sendError(response, 400, 'INVALID', 'resolution must be discard or retry'); return }
    try { response.status(200).json(await requirePos(application).resolveConflict(context, request.params['conflictId'] ?? '', resolution)) } catch (error) { sendPosError(response, error) }
  })

  router.post(['/tus/whatsapp/consent', '/tus/v1/whatsapp/consent'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:whatsapp:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS WhatsApp consent is not authorized')
      return
    }
    try {
      response.status(200).json(await requireWhatsApp(application).recordConsent(context, { recipientType: readString(body, 'recipientType') as 'tenant' | 'merchant' | 'customer', recipientId: readString(body, 'recipientId'), source: readString(body, 'source'), granted: body['granted'] === true }))
    } catch (error) { sendWhatsAppError(response, error) }
  })

  router.post(['/tus/whatsapp/templates', '/tus/v1/whatsapp/templates'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:whatsapp:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS WhatsApp templates are not authorized')
      return
    }
    try {
      response.status(202).json(await requireWhatsApp(application).sendTemplate(context, { recipientType: readString(body, 'recipientType') as 'tenant' | 'merchant' | 'customer', recipientId: readString(body, 'recipientId'), template: readString(body, 'template'), templateVersion: readString(body, 'templateVersion'), variables: asRecord(body['variables']), idempotencyKey: readHeader(request, 'idempotency-key') || readString(body, 'idempotencyKey'), requestHash: readString(body, 'requestHash') }))
    } catch (error) { sendWhatsAppError(response, error) }
  })

  router.post(['/tus/whatsapp/support-handoff', '/tus/v1/whatsapp/support-handoff'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:whatsapp:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS WhatsApp handoff is not authorized')
      return
    }
    try { response.status(200).json(await requireWhatsApp(application).handoffToSupport(context, { senderId: readString(body, 'senderId'), reason: readString(body, 'reason') })) } catch (error) { sendWhatsAppError(response, error) }
  })

  router.post(['/tus/whatsapp/actions', '/tus/v1/whatsapp/actions', '/tus/v1/whatsapp/handoff'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:whatsapp:write')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS WhatsApp actions are not authorized')
      return
    }
    if (hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'Client authority fields do not match the authenticated session')
      return
    }
    const actionValue = asRecord(body['action'])
    try {
      const result = await requireWhatsApp(application).execute({
        ...context,
        senderId: readString(body, 'senderId'),
        action: {
          type: readString(actionValue, 'type'),
          tenantId: readString(actionValue, 'tenantId') || context.tenantId,
          ...(readString(actionValue, 'commitmentId') ? { commitmentId: readString(actionValue, 'commitmentId') } : {}),
          ...(readString(actionValue, 'confirmationId') ? { confirmationId: readString(actionValue, 'confirmationId') } : {}),
        },
        consent: body['consent'] === true,
        idempotencyKey: readHeader(request, 'idempotency-key') || readString(body, 'idempotencyKey'),
        requestHash: readString(body, 'requestHash'),
        ...(readString(body, 'confirmationId') ? { confirmationId: readString(body, 'confirmationId') } : {}),
      })
      response.status(result.status === 'replay' ? 200 : 200).json(result)
    } catch (error) {
      sendWhatsAppError(response, error)
    }
  })

  router.post(['/tus/support/cases', '/tus/v1/support/cases'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:support:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS support access is not authorized')
      return
    }
    try {
      response.status(201).json(await requireSupport(application).openCase(context, {
        caseId: readString(body, 'caseId'),
        commitmentId: readString(body, 'commitmentId'),
        category: readString(body, 'category'),
        ...(readString(body, 'disputeId') ? { disputeId: readString(body, 'disputeId') } : {}),
      }))
    } catch (error) {
      sendSupportError(response, error)
    }
  })

  router.post(['/tus/support/cases/:caseId/evidence', '/tus/v1/support/cases/:caseId/evidence'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:support:write') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS support access is not authorized')
      return
    }
    try {
      response.status(201).json(await requireSupport(application).submitEvidence(context, {
        caseId: request.params['caseId'] ?? '',
        evidenceId: readString(body, 'evidenceId'),
        party: readString(body, 'party') as 'customer' | 'merchant',
        summary: readString(body, 'summary'),
      }))
    } catch (error) {
      sendSupportError(response, error)
    }
  })

  router.post(['/tus/support/cases/:caseId/resolve', '/tus/v1/support/cases/:caseId/resolve'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    const body = asRecord(request.body)
    if (!context || !hasPermission(context, 'tus:disputes:decide') || hasSpoofedAuthority(body, request, context)) {
      sendError(response, 403, 'FORBIDDEN', 'TUS dispute resolution is not authorized')
      return
    }
    try {
      response.status(200).json(await requireSupport(application).resolveCase(context, {
        caseId: request.params['caseId'] ?? '',
        outcome: readString(body, 'outcome') as 'no-refund' | 'partial-refund' | 'full-refund',
        amount: readFiniteNumber(body, 'amount'),
        reason: readString(body, 'reason'),
      }))
    } catch (error) {
      sendSupportError(response, error)
    }
  })

  router.get(['/tus/support/cases', '/tus/v1/support/cases'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:support:write')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS support access is not authorized')
      return
    }
    try {
      response.status(200).json({ cases: await requireSupport(application).listCases(context) })
    } catch (error) {
      sendSupportError(response, error)
    }
  })

  router.get(['/tus/reports/operations', '/tus/v1/reports/operations'], async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !hasPermission(context, 'tus:reporting:read')) {
      sendError(response, 403, 'FORBIDDEN', 'TUS reporting access is not authorized')
      return
    }
    try {
      response.status(200).json(await requireReporting(application).operations({
        ...context,
        ...(readQueryString(request.query['from']) ? { from: readQueryString(request.query['from']) } : {}),
        ...(readQueryString(request.query['to']) ? { to: readQueryString(request.query['to']) } : {}),
      }))
    } catch (error) {
      sendReportingError(response, error)
    }
  })

  router.get('/tus/seo/robots.txt', (_request: Request, response: Response) => {
    response.type('text/plain').status(200).send(createRobots())
  })

  router.get('/tus/seo/sitemap', (_request: Request, response: Response) => {
    response.status(200).json(createSitemap([]))
  })

  router.post('/tus/seo/discovery-model', (request: Request, response: Response) => {
    response.status(200).json(createDiscoverySeoModel(request.body as never))
  })

  return router
}

async function authenticate(request: Request, sessions: TusSessionResolverPort): Promise<TusAuthenticatedTenantContext | null> {
  const authorization = readHeader(request, 'authorization')
  const correlationId = readHeader(request, 'x-correlation-id')
  if (!authorization.startsWith('Bearer ') || !correlationId) return null
  const accessToken = authorization.slice('Bearer '.length).trim()
  if (!accessToken) return null
  return sessions.resolve(accessToken, correlationId)
}

function hasPermission(context: TusAuthenticatedTenantContext, permission: string): boolean {
  return context.permissions.includes(permission) || context.permissions.includes('tus:*')
}

function hasAnyPermission(context: TusAuthenticatedTenantContext, permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(context, permission))
}

function financeContext(context: TusAuthenticatedTenantContext) {
  return { tenantId: context.tenantId, actorId: context.subjectId, correlationId: context.correlationId }
}

function hasSpoofedAuthority(body: Record<string, unknown>, request: Request, context: TusAuthenticatedTenantContext): boolean {
  const bodyTenant = readOptionalString(body, 'tenantId')
  const bodyActor = readOptionalString(body, 'actorId')
  const headerTenant = readOptionalHeader(request, 'x-tenant-id')
  const headerActor = readOptionalHeader(request, 'x-actor-id')
  const bodySession = readOptionalString(body, 'sessionId')
  const headerSession = readOptionalHeader(request, 'x-session-id')
  const bodyRoles = readStringArray(body['roles'])
  const bodyPermissions = readStringArray(body['permissions'])
  return [bodyTenant, headerTenant].some((value) => value !== undefined && value !== context.tenantId)
    || [bodyActor, headerActor].some((value) => value !== undefined && value !== context.subjectId)
    || [bodySession, headerSession].some((value) => value !== undefined && value !== context.sessionId)
    || (body['roles'] !== undefined && bodyRoles.join('\u0000') !== context.roles.join('\u0000'))
    || (body['permissions'] !== undefined && bodyPermissions.join('\u0000') !== context.permissions.join('\u0000'))
}

async function recordAuthorizationDenied(
  onAuthorizationDenied: TusHttpRouterDependencies['onAuthorizationDenied'],
  action: string,
  context: TusAuthenticatedTenantContext,
  reason: TusAuthorizationDeniedEvent['reason']
): Promise<void> {
  if (onAuthorizationDenied) {
    await onAuthorizationDenied({
      action,
      actorId: context.subjectId,
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      reason,
    })
  }
}

function readLines(value: unknown): TusCartLine[] | null {
  if (!Array.isArray(value)) return null
  if (value.some((line) => {
    if (!isRecord(line)) return true
    return !['lineId', 'context', 'merchantId', 'currency'].every((field) => typeof line[field] === 'string' && line[field])
      || typeof line['amount'] !== 'number'
      || !Number.isFinite(line['amount'])
      || line['amount'] < 0
  })) return null
  return value as TusCartLine[]
}

function readMarketplaceLines(value: unknown): MarketplaceCheckoutLine[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (value.some((line) => {
    if (!isRecord(line)) return true
    return !['lineId', 'listingId', 'context'].every((field) => typeof line[field] === 'string' && line[field])
      || typeof line['quantity'] !== 'number' || !Number.isInteger(line['quantity']) || line['quantity'] <= 0
      || typeof line['availabilityVersion'] !== 'number' || !Number.isInteger(line['availabilityVersion']) || line['availabilityVersion'] < 0
      || (line['price'] !== undefined && (typeof line['price'] !== 'number' || !Number.isFinite(line['price']) || line['price'] <= 0))
  })) return null
  return value as MarketplaceCheckoutLine[]
}

function requireMarketplace(application: TusApplicationService) {
  if (!application.marketplace) throw new MarketplaceError(503, 'UNAVAILABLE', 'TUS marketplace composition is unavailable')
  return application.marketplace
}

function toPublicMarketplaceListing(listing: MarketplaceListing | MarketplaceDiscoveryItem) {
  const { priceMinor: _priceMinor, priceSnapshot: _priceSnapshot, ...publicListing } = listing
  return publicListing
}

function requireCalendar(application: TusApplicationService) {
  if (!application.calendar) throw new ServiceCalendarError(503, 'UNAVAILABLE', 'TUS calendar composition is unavailable')
  return application.calendar
}

async function recordMarketplaceDenied(application: TusApplicationService, context: TusAuthenticatedTenantContext | null, action: string, resourceId: string): Promise<void> {
  if (context && application.marketplace) await application.marketplace.recordDenied(context, action, resourceId)
}

function sendMarketplaceError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof MarketplaceError) {
    response.status(error.status).json({ code: error.code, error: error.message, ...(error.details ? { details: error.details } : {}) })
    return
  }
  sendError(response, 500, 'UNAVAILABLE', 'TUS marketplace operation was not committed')
}

function sendCalendarError(response: Response, error: unknown): void {
  if (error instanceof ServiceCalendarError) {
    response.status(error.status).json({ code: error.code, error: error.message })
    return
  }
  sendError(response, 500, 'UNAVAILABLE', 'TUS calendar operation was not committed')
}

function sendCommitmentError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof TusCommitmentError) {
    response.status(error.status).json({ code: error.code, error: error.message })
    return
  }
  sendError(response, 500, 'UNAVAILABLE', 'TUS commitment operation was not committed')
}

function requireFinance(application: TusApplicationService) {
  if (!application.finance) throw new FinanceError(503, 'UNAVAILABLE', 'TUS finance composition is unavailable')
  return application.finance
}

function requireDelivery(application: TusApplicationService) {
  if (!application.delivery) throw new DeliveryError(503, 'UNAVAILABLE', 'TUS delivery composition is unavailable')
  return application.delivery
}

function requirePos(application: TusApplicationService) {
  if (!application.pos) throw new PosError(503, 'UNAVAILABLE', 'TUS POS composition is unavailable')
  return application.pos
}

function requireWhatsApp(application: TusApplicationService) {
  if (!application.whatsapp) throw new WhatsAppActionError(503, 'UNAVAILABLE', 'TUS WhatsApp composition is unavailable')
  return application.whatsapp
}

function requireSupport(application: TusApplicationService) {
  if (!application.support) throw new SupportError(503, 'UNAVAILABLE', 'TUS support composition is unavailable')
  return application.support
}

function requireReporting(application: TusApplicationService) {
  if (!application.reporting) throw new ReportingError(503, 'UNAVAILABLE', 'TUS reporting composition is unavailable')
  return application.reporting
}

async function deliveryMutation(
  request: Request,
  response: Response,
  sessions: TusSessionResolverPort,
  application: TusApplicationService,
  operation: (context: TusAuthenticatedTenantContext, body: Record<string, unknown>, delivery: NonNullable<TusApplicationService['delivery']>) => Promise<unknown>,
): Promise<void> {
  const context = await authenticate(request, sessions)
  const body = asRecord(request.body)
  if (!context || !hasPermission(context, 'tus:delivery:write') || hasSpoofedAuthority(body, request, context)) {
    sendError(response, 403, 'FORBIDDEN', 'TUS delivery access is not authorized')
    return
  }
  try { response.status(200).json(await operation(context, body, requireDelivery(application))) } catch (error) { sendDeliveryError(response, error) }
}

function sendFinanceError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof FinanceError) {
    response.status(error.status).json({ code: error.code, error: error.message })
    return
  }
  sendError(response, 500, 'UNAVAILABLE', 'TUS finance operation was not committed')
}

function sendDeliveryError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof DeliveryError) { response.status(error.status).json({ code: error.code, error: error.message }); return }
  sendError(response, 500, 'UNAVAILABLE', 'TUS delivery operation was not committed')
}

function sendPosError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof PosError) { response.status(error.status).json({ code: error.code, error: error.message }); return }
  sendError(response, 500, 'UNAVAILABLE', 'TUS POS operation was not committed')
}

function sendWhatsAppError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof WhatsAppActionError) { response.status(error.status).json({ code: error.code, error: error.message }); return }
  sendError(response, 500, 'UNAVAILABLE', 'TUS WhatsApp action was not committed')
}

function sendSupportError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof SupportError) { response.status(error.status).json({ code: error.code, error: error.message }); return }
  sendError(response, 500, 'UNAVAILABLE', 'TUS support operation was not committed')
}

function sendReportingError(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    enviarErrorHabilitacion(response, error)
    return
  }
  if (error instanceof ReportingError) { response.status(error.status).json({ code: error.code, error: error.message }); return }
  sendError(response, 500, 'UNAVAILABLE', 'TUS report was not generated')
}

function sendCheckoutResult(response: Response, result: TusCheckoutResult): void {
  if (result.status === 'executed') {
    response.status(201).json(result)
    return
  }
  if (result.status === 'replay') {
    response.status(200).json(result)
    return
  }
  if (result.status === 'conflict') {
    sendError(response, 409, 'CONFLICT', 'Idempotency key was already used for another request')
    return
  }
  if (result.status === 'in_progress') {
    sendError(response, 409, 'IN_PROGRESS', 'The idempotent request is already in progress')
    return
  }
  sendError(response, 403, 'FORBIDDEN', 'TUS checkout is not authorized')
}

function sendError(response: Response, status: number, code: string, error: string): void {
  response.status(status).json({ code, error })
}

function enviarErrorHabilitacion(response: Response, error: unknown): void {
  if (error instanceof HabilitacionBloqueadaError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  sendError(response, 409, 'TUS_READINESS_BLOCKED', 'TUS readiness requirements are not satisfied')
}

function capacidadHabilitacionPorRuta(path: string): 'publication' | 'provider-actions' | 'settlement' | 'fleet' | null {
  if (path.includes('/marketplace/checkout') || path.includes('/finance/release') || path.includes('/finance/disputes') || path.includes('/finance/refunds') || path.includes('/finance/chargebacks') || path.includes('/finance/reconciliation') || path.includes('/support/')) return 'settlement'
  if (path.includes('/marketplace/') || path.includes('/seo/')) return 'publication'
  if (path.includes('/finance/')) return path.includes('/payment-intents') || path.includes('/evidence') || path.includes('/confirmations') ? 'provider-actions' : 'settlement'
  if (path.includes('/whatsapp/')) return 'provider-actions'
  if (path.includes('/delivery/') || path.includes('/pos/')) return 'fleet'
  if (path.includes('/commitments/')) return 'settlement'
  return null
}

function routeIsGuardedByApplication(path: string, application: TusApplicationService): boolean {
  if (!application.evaluadorHabilitacion) return false
  return path.includes('/checkout') || path.includes('/marketplace/onboarding') || path.includes('/marketplace/listings')
}

function tienePermisoHabilitacion(context: TusAuthenticatedTenantContext, capability: ReturnType<typeof capacidadHabilitacionPorRuta>): boolean {
  if (capability === 'publication') return hasPermission(context, 'tus:marketplace:write') || hasPermission(context, 'tus:reporting:write')
  if (capability === 'provider-actions') return hasPermission(context, 'tus:finance:write') || hasPermission(context, 'tus:whatsapp:write')
  if (capability === 'settlement') return hasPermission(context, 'tus:checkout') || hasPermission(context, 'tus:finance:write') || hasPermission(context, 'tus:support:write') || hasPermission(context, 'tus:commitments:write')
  if (capability === 'fleet') return hasPermission(context, 'tus:delivery:write') || hasPermission(context, 'tus:pos:write')
  return false
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readQueryString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : undefined
}

function readFiniteNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readVersion(body: Record<string, unknown>): number {
  return readFiniteNumber(body, 'expectedVersion') ?? NaN
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value.map((entry) => entry.trim()) : []
}

function readHeader(request: Request, key: string): string {
  return request.header(key)?.trim() ?? ''
}

function readOptionalHeader(request: Request, key: string): string | undefined {
  const value = request.header(key)
  return value?.trim() || undefined
}

export default { createTusHttpRouter }
