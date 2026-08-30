export const TUS_SURFACE = {
  DISCOVERY: 'discovery',
  COMMITMENTS: 'commitments',
  OPERATIONS: 'operations',
  POS: 'pos',
} as const

export type TusSurface = (typeof TUS_SURFACE)[keyof typeof TUS_SURFACE]

export const TUS_LOCALE = 'en-AR' as const
export const TUS_TIME_ZONE = 'America/Argentina/Buenos_Aires' as const
export const TUS_PUBLIC_ORIGIN = 'https://tusservicios.com' as const

export function resolveTusPublicOrigin(value = process.env['NEXT_PUBLIC_SITE_URL']): string {
  if (value !== undefined && value.trim().length > 0) {
    try {
      const origin = new URL(value)
      if (origin.protocol === 'https:' && !origin.username && !origin.password && !origin.pathname.replaceAll('/', '') && !origin.search && !origin.hash) {
        return origin.origin
      }
    } catch {
      // Fall through to the documented public origin.
    }
  }
  return TUS_PUBLIC_ORIGIN
}

export interface TusJourneyAccessInput {
  roles?: readonly string[]
  permissions?: readonly string[]
}

export interface TusJourneyLink {
  key: TusSurface
  label: string
  href: string
  description: string
  allowed: boolean
}

export interface TusSurfaceHrefOptions {
  filter?: 'products' | 'services'
  returnTo?: string
}

export interface TusCatalogFactsInput {
  kind: 'product' | 'service'
  price: number
  currency: string
  availableQuantity?: number
  capacity?: number
  durationMinutes?: number
}

export interface TusCatalogFacts {
  context: 'Product' | 'Service'
  price: string
  availability: string
  policy: string
}

export function formatTusCurrency(amount: number, currency: string | undefined): string {
  const normalizedCurrency = currency?.trim().toUpperCase()
  if (!normalizedCurrency || !Number.isFinite(amount)) return 'Amount not provided by server.'
  try {
    return new Intl.NumberFormat(TUS_LOCALE, {
      currency: normalizedCurrency,
      currencyDisplay: 'symbol',
      style: 'currency',
    }).format(amount)
  } catch {
    return `${new Intl.NumberFormat(TUS_LOCALE).format(amount)} ${normalizedCurrency}`
  }
}

export function formatTusDate(value: string | null | undefined): string {
  if (value === undefined || value === null || value.trim().length === 0) {
    return 'Date not provided by server.'
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Date not provided by server.'
  return new Intl.DateTimeFormat(TUS_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TUS_TIME_ZONE,
  }).format(date)
}

export function formatTusNumber(value: number): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(TUS_LOCALE).format(value) : '—'
}

export function createTusSupportDestination(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  try {
    const destination = new URL(value)
    if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash) return undefined
    if (destination.hostname !== 'wa.me' && destination.hostname !== 'api.whatsapp.com') return undefined
    return destination.toString()
  } catch {
    return undefined
  }
}

export interface TusFreshnessPresentation {
  status: 'ready' | 'pending'
  label: string
  message: string
  action: 'none' | 'refresh'
}

const SURFACE_DEFINITIONS: ReadonlyArray<Omit<TusJourneyLink, 'href' | 'allowed'>> = [
  { key: TUS_SURFACE.DISCOVERY, label: 'Discover', description: 'Find current product and service offers.' },
  { key: TUS_SURFACE.COMMITMENTS, label: 'Commitments', description: 'Review separate product and service promises.' },
  { key: TUS_SURFACE.OPERATIONS, label: 'Operations', description: 'Review tenant-scoped inventory and reporting.' },
  { key: TUS_SURFACE.POS, label: 'Staff POS', description: 'Record a bounded product or service operation.' },
]

export function buildTusJourneyLinks(input: TusJourneyAccessInput = {}): TusJourneyLink[] {
  return SURFACE_DEFINITIONS.map((definition) => {
    const allowed = canAccessSurface(definition.key, input)
    return {
      ...definition,
      href: definition.key === TUS_SURFACE.OPERATIONS ? '/tus/operations' : definition.key === TUS_SURFACE.POS ? '/tus/pos' : createTusSurfaceHref(definition.key),
      description: allowed ? definition.description : 'This destination is unavailable for the authorized scope.',
      allowed,
    }
  })
}

export function createTusSurfaceHref(surface: TusSurface, options: TusSurfaceHrefOptions = {}): string {
  const params = new URLSearchParams({ surface })
  if (options.filter !== undefined) params.set('filter', options.filter)
  const returnTo = sanitizeInternalPath(options.returnTo)
  if (returnTo !== undefined) params.set('returnTo', returnTo)
  return `/tus?${params.toString()}`
}

export function resolveTusRoleLabel(roles: readonly string[] = []): string {
  const normalized = roles.map((role) => role.trim().toLowerCase())
  if (normalized.some((role) => role === 'operations' || role === 'admin' || role === 'operator')) return 'Operations · reporting'
  if (normalized.some((role) => role === 'merchant' || role === 'seller')) return 'Merchant · catalog'
  if (normalized.some((role) => role === 'staff' || role === 'pos')) return 'Staff · POS'
  return 'Customer · discovery'
}

export function resolveTusCatalogFacts(input: TusCatalogFactsInput): TusCatalogFacts {
  const price = formatTusCurrency(input.price, input.currency)
  if (input.kind === 'product') {
    return {
      context: 'Product',
      price,
      availability: `${input.availableQuantity ?? 0} units available`,
      policy: 'Stock is rechecked by TUS before the product commitment is created.',
    }
  }
  return {
    context: 'Service',
    price,
    availability: `${input.durationMinutes ?? 0} min · capacity ${input.capacity ?? 0}`,
    policy: 'Slot capacity is rechecked by TUS before the service commitment is created.',
  }
}

export function resolveTusFreshness(stale: boolean): TusFreshnessPresentation {
  if (stale) {
    return {
      status: 'pending',
      label: 'Report needs a fresh read',
      message: 'Refresh the server report before acting; settlement, delivery, and support completion are not inferred.',
      action: 'refresh',
    }
  }
  return {
    status: 'ready',
    label: 'Freshness window current',
    message: 'Current server facts are available. Finance, delivery, and support remain separate boundaries.',
    action: 'none',
  }
}

function canAccessSurface(surface: TusSurface, input: TusJourneyAccessInput): boolean {
  const roles = new Set((input.roles ?? []).map((role) => role.trim().toLowerCase()))
  const permissions = new Set(input.permissions ?? [])
  if (surface === TUS_SURFACE.DISCOVERY || surface === TUS_SURFACE.COMMITMENTS) return permissions.has('tus:read') || permissions.has('tus:marketplace:read')
  if (surface === TUS_SURFACE.OPERATIONS) return permissions.has('tus:operations:read') || permissions.has('tus:operations') || roles.has('operations') || roles.has('admin')
  return permissions.has('tus:pos:write') || permissions.has('tus:pos') || roles.has('staff') || roles.has('pos') || roles.has('merchant') || roles.has('admin')
}

function sanitizeInternalPath(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  const candidate = value.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return undefined
  try {
    const parsed = new URL(candidate, 'https://tus.internal')
    if (parsed.origin !== 'https://tus.internal') return undefined
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return undefined
  }
}

export default {
  TUS_LOCALE,
  TUS_PUBLIC_ORIGIN,
  TUS_TIME_ZONE,
  buildTusJourneyLinks,
  createTusSupportDestination,
  createTusSurfaceHref,
  formatTusCurrency,
  formatTusDate,
  formatTusNumber,
  resolveTusCatalogFacts,
  resolveTusFreshness,
  resolveTusRoleLabel,
  resolveTusPublicOrigin,
}
