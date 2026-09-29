import type { Trabajo, Presupuesto } from './tus.ts'

export interface WorkActions {
  canStart: boolean
  canComplete: boolean
  canCancel: boolean
  canCreateBudget: boolean
  canAcceptBudget: boolean
  canRejectBudget: boolean
  canSendMessage: boolean
}

export interface WorkSummary {
  id: string
  origin: 'marketplace' | 'solicitud'
  solicitudId: string | null
  status: Trabajo['status']
  version: number
  budgetRequired: boolean
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
