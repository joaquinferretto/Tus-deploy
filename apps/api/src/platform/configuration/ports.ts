import type {
  ConfigurationContext,
  ConfigurationRevision,
  ConfigurationScope,
  DeliveryProfile,
} from '@factory/config'

export interface ConfigurationStore {
  save(revision: ConfigurationRevision): Promise<void>
  find(scopeKey: string, version: number): Promise<ConfigurationRevision | undefined>
  active(scopeKey: string): Promise<ConfigurationRevision | undefined>
  history(scopeKey: string): Promise<ConfigurationRevision[]>
  activate(scopeKey: string, version: number): Promise<void>
  activeLayers(context: ConfigurationContext): Promise<ConfigurationRevision[]>
}

export interface PublishConfigurationInput extends ConfigurationRevision {}

export interface RollbackConfigurationInput {
  scope?: ConfigurationScope
  profile: DeliveryProfile
  tenantId?: string
  productId?: string
  targetVersion: number
}
