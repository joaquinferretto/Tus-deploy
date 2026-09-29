import type { EstadoObligacionPagoServicio, Presupuesto, Trabajo } from './tus.ts'

export interface WorkActions {
  canStart: boolean
  canComplete: boolean
  canCancel: boolean
  canCreateBudget: boolean
  canAcceptBudget: boolean
  canRejectBudget: boolean
  canSendMessage: boolean
  // Client: pay the deposit (before start) or the balance (after the provider finished).
  canPayDeposit: boolean
  canPayBalance: boolean
  // Client of a started request-born work: ask the provider/support to cancel (never cancels).
  canRequestCancellation: boolean
  // Client of a completed work that was not rated yet.
  canRate: boolean
}

export interface WorkRating {
  score: number
  comment: string | null
  createdAt: string
}

// Request-born works with an accepted budget: 50% deposit + 50% balance through Mercado Pago.
// `required`: platform payments enabled (the deposit gates the start; the balance completes the
// work). `online`: chargeable now; required && !online = the provider must link Mercado Pago.
export interface WorkPaymentPart {
  amountMinor: string
  status: EstadoObligacionPagoServicio | 'not_created'
}
export interface WorkPayment {
  required: boolean
  online: boolean
  unavailableReason: string | null
  currency: string
  totalMinor: string
  deposit: WorkPaymentPart
  balance: WorkPaymentPart
}

export interface WorkSummary {
  id: string
  origin: 'marketplace' | 'solicitud'
  solicitudId: string | null
  status: Trabajo['status']
  version: number
  budgetRequired: boolean
  finishedAt: string | null
  createdAt: string
  updatedAt: string
  title: string
  role: 'cliente' | 'prestador'
  counterpart: { displayName: string; profession: string | null }
  request: {
    title: string
    description: string | null
    category: string
    area: string
    images: string[]
  } | null
  budget: Pick<
    Presupuesto,
    'presupuestoId' | 'version' | 'status' | 'currency' | 'totalMinor' | 'scope' | 'validUntil'
  > | null
  // Only in the detail (null in the list, which never shows actions).
  payment: WorkPayment | null
  cancellation: { byRole: 'cliente' | 'prestador' | 'admin'; reason: string } | null
  cancellationRequest: { requestedAt: string; reason: string } | null
  // A registered payment locks the work: cancelling it is a platform-support case.
  cancellationNeedsSupport: boolean
  // The client's rating of the provider (detail only; null in the list or when not rated).
  rating: WorkRating | null
  actions: WorkActions
}

export interface WorkMessage {
  id: string
  authorRole: 'cliente' | 'prestador'
  mine: boolean
  text: string
  createdAt: string
}

export const WORK_MESSAGE_MAX_LENGTH = 2000
