import express, { type Request, type Response, type Router } from 'express'
import type { TenancyService } from '../application/tenancy-service.js'
import type { TusAuthenticatedTenantContext, TusSessionResolverPort } from '../../tus/ports/index.ts'
import { asyncHandler, createErrorEnvelope } from '../../presentation/middleware/error.ts'
import { getCorrelationId } from '../../presentation/middleware/correlation.ts'

export interface TenancyRouterDependencies {
  service?: TenancyService
  sessions: TusSessionResolverPort
}

export function createTenancyRouter({ service, sessions }: TenancyRouterDependencies): Router {
  const router = express.Router()

  router.post('/tenancy/organizations', asyncHandler(async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context) {
      response.status(401).json(createErrorEnvelope(new Error('authentication required'), getCorrelationId(request), 'UNAUTHORIZED'))
      return
    }
    const body = asRecord(request.body)
    if (hasSpoofedAuthority(body, context)) {
      response.status(403).json(createErrorEnvelope(new Error('client authority rejected'), getCorrelationId(request), 'FORBIDDEN'))
      return
    }
    if (!service) {
      response.status(503).json(createErrorEnvelope(new Error('tenant persistence unavailable'), getCorrelationId(request), 'UNAVAILABLE'))
      return
    }
    const result = await service.createOrganization({
      actorId: context.subjectId,
      name: readString(body['name']),
      slug: readString(body['slug']),
      correlationId: context.correlationId,
      organizationId: context.tenantId,
    })
    sendResult(response, result, 201, getCorrelationId(request))
  }))

  router.post('/tenancy/invitations', asyncHandler(async (request: Request, response: Response) => {
    const context = await authenticate(request, sessions)
    if (!context || !service) {
      response.status(context ? 503 : 401).json(createErrorEnvelope(new Error(context ? 'tenant persistence unavailable' : 'authentication required'), getCorrelationId(request), context ? 'UNAVAILABLE' : 'UNAUTHORIZED'))
      return
    }
    const body = asRecord(request.body)
    const result = await service.inviteMember({
      context: tenancyContext(context),
      email: readString(body['email']),
      roleIds: readStringArray(body['roleIds']),
    })
    sendResult(response, result, 201, getCorrelationId(request))
  }))

  router.delete(
    '/tenancy/memberships/:membershipId',
    asyncHandler(async (request: Request, response: Response) => {
      const context = await authenticate(request, sessions)
      if (!context || !service) {
        response.status(context ? 503 : 401).json(createErrorEnvelope(new Error(context ? 'tenant persistence unavailable' : 'authentication required'), getCorrelationId(request), context ? 'UNAVAILABLE' : 'UNAUTHORIZED'))
        return
      }
      const result = await service.revokeMembership({
        context: tenancyContext(context),
        membershipId: readString(request.params['membershipId']),
      })
      sendResult(response, result, 204, getCorrelationId(request))
    })
  )

  return router
}

async function authenticate(
  request: Request,
  sessions: TusSessionResolverPort
): Promise<TusAuthenticatedTenantContext | null> {
  const authorization = request.header('authorization') ?? ''
  const correlationId = request.header('x-correlation-id')?.trim() ?? ''
  if (!authorization.startsWith('Bearer ') || !correlationId) return null
  const accessToken = authorization.slice('Bearer '.length).trim()
  return accessToken ? sessions.resolve(accessToken, correlationId) : null
}

function hasSpoofedAuthority(body: Record<string, unknown>, context: TusAuthenticatedTenantContext): boolean {
  const tenantId = body['tenantId']
  const actorId = body['actorId']
  return (typeof tenantId === 'string' && tenantId !== context.tenantId)
    || (typeof actorId === 'string' && actorId !== context.subjectId)
}

function tenancyContext(context: TusAuthenticatedTenantContext) {
  return {
    tenantId: context.tenantId,
    actorId: context.subjectId,
    correlationId: context.correlationId,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function sendResult(
  response: Response,
  result: { ok: boolean; code?: string; message?: string },
  successStatus: number,
  correlationId: string,
): void {
  if (!result.ok) {
    response
      .status(result.code === 'FORBIDDEN' || result.code === 'INVALID_TENANT_CONTEXT' ? 403 : 422)
      .json(createErrorEnvelope(new Error(result.message ?? 'tenant request rejected'), correlationId, result.code ?? 'TENANT_REQUEST_REJECTED'))
    return
  }
  response.status(successStatus).json(result)
}

export default { createTenancyRouter }
