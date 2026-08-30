import type { Stage1Cohort } from '@factory/contracts'

export type Stage1PublicationDecision =
  | { allowed: true; reason: 'approved_stage_1_cohort' }
  | { allowed: false; reason: 'regulated_vertical_excluded' | 'cohort_not_enabled' }

export function evaluateStage1Publication(input: {
  cohort: Stage1Cohort | string
  regulatedHealthcare: boolean
}): Stage1PublicationDecision {
  if (input.regulatedHealthcare) return { allowed: false, reason: 'regulated_vertical_excluded' }
  if (input.cohort !== 'beauty-personal-care' && input.cohort !== 'repairs-trades') {
    return { allowed: false, reason: 'cohort_not_enabled' }
  }
  return { allowed: true, reason: 'approved_stage_1_cohort' }
}
