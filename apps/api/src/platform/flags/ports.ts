import type { ConfigurationContext, ResolvedConfiguration } from '@factory/config'

export interface FeatureFlagResolver {
  resolve(context: ConfigurationContext): Promise<ResolvedConfiguration>
  isEnabled(flag: string, context: ConfigurationContext): Promise<boolean>
}
