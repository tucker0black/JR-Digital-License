import type { TopUpProvider } from './provider.js';

export interface TopUpProviderRecord {
  name: string;
  apiUrl: string;
  apiKey: string;
}

const PROVIDER_REGISTRY = new Map<string, () => Promise<{ new (config: { apiUrl: string; apiKey: string }): TopUpProvider }>>();

PROVIDER_REGISTRY.set('fazercards', async () => {
  const { FazerCardsTopUpProvider } = await import('./fazercards-provider.js');
  return FazerCardsTopUpProvider;
});

export async function createTopUpProvider(record: TopUpProviderRecord): Promise<TopUpProvider> {
  const normalizedName = (record.name ?? '').toLowerCase().replace(/[\s_-]/g, '');

  for (const [key, loader] of PROVIDER_REGISTRY) {
    if (normalizedName.includes(key)) {
      const ProviderClass = await loader();
      return new ProviderClass({ apiUrl: record.apiUrl, apiKey: record.apiKey });
    }
  }

  const { FazerCardsTopUpProvider } = await import('./fazercards-provider.js');
  return new FazerCardsTopUpProvider({ apiUrl: record.apiUrl, apiKey: record.apiKey });
}
