import {
  CONFIGURATION_ERROR_CODE,
  CONFIGURATION_SCOPE,
  configurationScopeKey,
  resolveConfigurationLayers,
  validateConfigurationRevision,
  ConfigurationValidationError,
  type ConfigurationContext,
  type ConfigurationRevision,
  type ResolvedConfiguration,
} from '@factory/config'
import type { FeatureFlagResolver } from '../../flags/ports.js'
import type {
  ConfigurationStore,
  PublishConfigurationInput,
  RollbackConfigurationInput,
} from '../ports.js'

export class ConfigurationService implements FeatureFlagResolver {
  constructor(private readonly store: ConfigurationStore) {}

  async publish(input: PublishConfigurationInput): Promise<ConfigurationRevision> {
    const revision = validateConfigurationRevision(input)
    const key = configurationScopeKey(revision)
    const history = await this.store.history(key)
    const expectedVersion = (history.at(-1)?.version ?? 0) + 1
    if (revision.version !== expectedVersion) {
      throw new ConfigurationValidationError(
        CONFIGURATION_ERROR_CODE.CONFLICT,
        'version',
        `Configuration version must be ${expectedVersion}`
      )
    }
    await this.store.save(revision)
    await this.store.activate(key, revision.version)
    return revision
  }

  async resolve(context: ConfigurationContext): Promise<ResolvedConfiguration> {
    return resolveConfigurationLayers(await this.store.activeLayers(context), context)
  }

  async isEnabled(flag: string, context: ConfigurationContext): Promise<boolean> {
    if (!flag.trim()) return false
    const resolved = await this.resolve(context)
    return resolved.flags[flag] ?? false
  }

  async rollback(input: RollbackConfigurationInput): Promise<ConfigurationRevision> {
    if (!Number.isInteger(input.targetVersion) || input.targetVersion < 1) {
      throw new ConfigurationValidationError(
        CONFIGURATION_ERROR_CODE.INVALID,
        'targetVersion',
        'Invalid configuration targetVersion: must be a positive integer'
      )
    }

    const key = configurationScopeKey({
      scope: input.scope ?? CONFIGURATION_SCOPE.PROFILE,
      profile: input.profile,
      tenantId: input.tenantId,
      productId: input.productId,
    })
    const revision = await this.store.find(key, input.targetVersion)
    if (!revision) {
      throw new ConfigurationValidationError(
        CONFIGURATION_ERROR_CODE.NOT_FOUND,
        'targetVersion',
        `Configuration revision not found: ${input.targetVersion}`
      )
    }
    await this.store.activate(key, revision.version)
    return revision
  }
}
