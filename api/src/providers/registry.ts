import type { Platform, Provider } from './types.js';

/** Providers grouped by platform, ordered by priority. */
export class ProviderRegistry {
  private readonly byPlatform = new Map<string, Provider[]>();

  constructor(providers: readonly Provider[], readonly platforms: readonly Platform[]) {
    for (const provider of providers) {
      const list = this.byPlatform.get(provider.platform) ?? [];
      list.push(provider);
      this.byPlatform.set(provider.platform, list);
    }
    for (const list of this.byPlatform.values()) list.sort((a, b) => a.priority - b.priority);
  }

  providersFor(platform: string): readonly Provider[] {
    return this.byPlatform.get(platform) ?? [];
  }

  /** Platforms that actually have at least one provider behind them. */
  availablePlatforms(): readonly Platform[] {
    return this.platforms.filter((p) => this.providersFor(p.id).length > 0);
  }

  allProviders(): readonly Provider[] {
    return [...this.byPlatform.values()].flat();
  }
}
