import type { ReconciliationReport } from '../jobs/ports.js'
import { DurableJobService } from '../jobs/application/durable-job-service.js'

export class ReconciliationService {
  constructor(private readonly jobs: DurableJobService) {}

  reconcile(input: { tenantId: string; now: number }): Promise<ReconciliationReport> {
    return this.jobs.reconcile(input)
  }
}

export type { ReconciliationReport } from '../jobs/ports.js'
export default { ReconciliationService }
