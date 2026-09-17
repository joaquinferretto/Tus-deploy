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
  franja?: Pick<TusCalendarSlot, 'slotId' | 'start' | 'end'>
): TusMarketplaceCheckoutIntent {
  const normalizedIntentId = intentId.trim()
  if (normalizedIntentId.length === 0) throw new Error('checkout intent id is required')
  if (publicacion.kind === 'service' && (franja === undefined || !validSlot(franja))) {
    throw new Error('a real service slot is required before checkout')
  }
  const slotStart = publicacion.kind === 'service' ? franja?.start : undefined
  const slotEnd = publicacion.kind === 'service' ? franja?.end : undefined
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
    requestHash: `discovery:${publicacion.listingId}:${publicacion.availabilityVersion}:${franja?.slotId ?? slotStart ?? 'product'}`,
    lines,
    listingId: publicacion.listingId,
  }
}

function validSlot(franja: Pick<TusCalendarSlot, 'slotId' | 'start' | 'end'>): boolean {
  const startMs = Date.parse(franja.start)
  const endMs = Date.parse(franja.end)
  if (franja.slotId.trim().length === 0) return false
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
}

export function publicacionRequierePresupuesto(publicacion: TusMarketplaceDiscoveryItem): boolean {
  return publicacion.kind === 'service'
    && (publicacion.bookingMode === 'requiere_presupuesto'
      || publicacion.priceMode === 'requires_budget'
      || publicacion.priceMode === 'presupuesto')
}

const tusMarketplaceModule = {
  construirIntencionCheckout,
  crearEnlaceCompromiso,
  crearEnlacePublicacion,
  encontrarPublicacion,
  filtrarPublicaciones,
  publicacionRequierePresupuesto,
}

export default tusMarketplaceModule
