import {
  createStableIdempotencyKey,
  type TusMarketplaceCheckoutInput,
  type TusMarketplaceDiscoveryItem,
  type TusMarketplaceLine,
  type TusCalendarSlot,
} from './tus-client'

export type MercadoServiciosFilter = 'all' | 'products' | 'services'

export type TusMarketplaceCheckoutIntent = Pick<
  TusMarketplaceCheckoutInput,
  'idempotencyKey' | 'cartId' | 'requestHash' | 'lines'
> & {
  intentId: string
  listingId: string
}

export function filtrarPublicaciones(
  publicaciones: readonly TusMarketplaceDiscoveryItem[],
  filtro: MercadoServiciosFilter
): TusMarketplaceDiscoveryItem[] {
  if (filtro === 'all') return [...publicaciones]
  const tipo = filtro === 'products' ? 'product' : 'service'
  return publicaciones.filter((publicacion) => publicacion.kind === tipo)
}

export function encontrarPublicacion(
  publicaciones: readonly TusMarketplaceDiscoveryItem[],
  listingId: string
): TusMarketplaceDiscoveryItem | undefined {
  const normalizedId = listingId.trim()
  if (normalizedId.length === 0) return undefined
  return publicaciones.find((publicacion) => publicacion.listingId === normalizedId)
}

export function crearEnlacePublicacion(listingId: string): string {
  return `/tus/mercado/${encodeURIComponent(listingId)}`
}

export function crearEnlaceCompromiso(commitmentId: string): string {
  return `/tus/compromisos/${encodeURIComponent(commitmentId)}`
}

export function construirIntencionCheckout(
  publicacion: TusMarketplaceDiscoveryItem,
  intentId: string,
  now = Date.now(),
  franja?: Pick<TusCalendarSlot, 'start' | 'end'>
): TusMarketplaceCheckoutIntent {
  const normalizedIntentId = intentId.trim()
  if (normalizedIntentId.length === 0) throw new Error('checkout intent id is required')
  const slotStart =
    publicacion.kind !== 'service'
      ? undefined
      : franja?.start ?? new Date(now + 24 * 60 * 60 * 1000).toISOString()
  const slotEnd =
    publicacion.kind === 'service' && slotStart !== undefined
      ? franja?.end ?? new Date(Date.parse(slotStart) + (publicacion.durationMinutes ?? 0) * 60 * 1000).toISOString()
      : undefined
  const lines: TusMarketplaceLine[] = [
    {
      lineId: `line-${normalizedIntentId}`,
      listingId: publicacion.listingId,
      context: publicacion.kind,
      quantity: 1,
      availabilityVersion: publicacion.availabilityVersion,
      ...(slotStart === undefined ? {} : { slotStart, slotEnd }),
    },
  ]
  return {
    intentId: normalizedIntentId,
    idempotencyKey: createStableIdempotencyKey('checkout', normalizedIntentId),
    cartId: `cart-${normalizedIntentId}`,
    requestHash: `discovery:${publicacion.listingId}:${publicacion.availabilityVersion}:${slotStart ?? 'product'}`,
    lines,
    listingId: publicacion.listingId,
  }
}

const tusMarketplaceModule = {
  construirIntencionCheckout,
  crearEnlaceCompromiso,
  crearEnlacePublicacion,
  encontrarPublicacion,
  filtrarPublicaciones,
}

export default tusMarketplaceModule
