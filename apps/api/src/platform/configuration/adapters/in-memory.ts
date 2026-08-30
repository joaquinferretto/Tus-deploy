import {
  cloneRevision,
  configurationScopeKey,
  type ConfigurationContext,
  type ConfigurationRevision,
} from '@factory/config'
import type { ConfigurationStore } from '../ports.js'

export class InMemoryConfigurationStore implements ConfigurationStore {
  private readonly revisions = new Map<string, Map<number, ConfigurationRevision>>()
  private readonly activeVersions = new Map<string, number>()

  async save(revision: ConfigurationRevision): Promise<void> {
    const key = configurationScopeKey(revision)
    const versions = this.revisions.get(key) ?? new Map<number, ConfigurationRevision>()
    versions.set(revision.version, cloneRevision(revision))
    this.revisions.set(key, versions)
  }

  async find(scopeKey: string, version: number): Promise<ConfigurationRevision | undefined> {
    const revision = this.revisions.get(scopeKey)?.get(version)
    return revision ? cloneRevision(revision) : undefined
  }

  async active(scopeKey: string): Promise<ConfigurationRevision | undefined> {
    const version = this.activeVersions.get(scopeKey)
    return version === undefined ? undefined : this.find(scopeKey, version)
  }

  async history(scopeKey: string): Promise<ConfigurationRevision[]> {
    return [...(this.revisions.get(scopeKey)?.values() ?? [])]
      .sort((left, right) => left.version - right.version)
      .map(cloneRevision)
  }

  async activate(scopeKey: string, version: number): Promise<void> {
    const revision = await this.find(scopeKey, version)
    if (!revision) throw new Error(`Configuration revision not found: ${scopeKey}@${version}`)
    this.activeVersions.set(scopeKey, version)
  }

  async activeLayers(context: ConfigurationContext): Promise<ConfigurationRevision[]> {
    const layers: ConfigurationRevision[] = []
    for (const [key] of this.revisions) {
      const revision = await this.active(key)
      if (revision) layers.push(revision)
    }
    return layers
  }
}
