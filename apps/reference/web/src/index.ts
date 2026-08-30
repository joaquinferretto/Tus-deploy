import {
  createNeutralIntentClient,
  createNeutralStateClient,
  type NeutralContractApi,
  type NeutralIntentClient,
  type NeutralStateClient,
} from '../../api/src/index'

export interface NeutralWebClients {
  state: NeutralStateClient
  intent: NeutralIntentClient
}

export function createNeutralWebClients(api: NeutralContractApi): NeutralWebClients {
  return {
    state: createNeutralStateClient(api),
    intent: createNeutralIntentClient(api),
  }
}

export default { createNeutralWebClients }
