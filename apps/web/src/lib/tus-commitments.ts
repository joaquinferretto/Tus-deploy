import type { CompromisoMercadoServicios } from '@factory/contracts/tus'

export const ESTADOS_COMPROMISO_VISIBLES = {
  pending: { label: 'Pendiente', tone: 'warning' },
  confirmed: { label: 'Confirmado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
  fulfilled: { label: 'Cumplido', tone: 'success' },
  frozen: { label: 'Congelado', tone: 'danger' },
  released: { label: 'Liberado', tone: 'success' },
  compensated: { label: 'Compensado', tone: 'neutral' },
} as const

export type EstadoCompromisoVisible = keyof typeof ESTADOS_COMPROMISO_VISIBLES

export function encontrarCompromiso(
  compromisos: readonly CompromisoMercadoServicios[],
  commitmentId: string
): CompromisoMercadoServicios | undefined {
  const normalizedId = commitmentId.trim()
  if (normalizedId.length === 0) return undefined
  return compromisos.find((compromiso) => compromiso.commitmentId === normalizedId)
}

export function crearEnlaceCompromiso(commitmentId: string): string {
  return `/tus/compromisos/${encodeURIComponent(commitmentId)}`
}

export function presentarEstadoCompromiso(status: EstadoCompromisoVisible): {
  label: string
  tone: (typeof ESTADOS_COMPROMISO_VISIBLES)[EstadoCompromisoVisible]['tone']
} {
  return ESTADOS_COMPROMISO_VISIBLES[status]
}

const tusCommitmentsModule = {
  crearEnlaceCompromiso,
  encontrarCompromiso,
  presentarEstadoCompromiso,
}

export default tusCommitmentsModule
