import {
  createNeutralIntentClient,
  createNeutralStateClient,
  type NeutralContractApi,
  type NeutralIntentClient,
  type NeutralStateClient,
} from '../../../reference/api/src/index'

export interface NeutralMobileClients {
  state: NeutralStateClient
  intent: NeutralIntentClient
}

export function createNeutralMobileClients(api: NeutralContractApi): NeutralMobileClients {
  return {
    state: createNeutralStateClient(api),
    intent: createNeutralIntentClient(api),
  }
}

export default { createNeutralMobileClients }
