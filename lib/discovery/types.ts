export type DiscoveryHit = {
  title: string;
  url: string;
  snippet: string;
  sourceType: string;
  sourceName: string;
  query: string;
};

export type DiscoveryInput = {
  query: string;
  limit: number;
  language?: string;
  country?: string;
};

export type ProviderHealth = {
  ok: boolean;
  detail: string;
};

export interface DiscoveryProvider {
  getName(): string;
  isEnabled(): boolean;
  discover(input: DiscoveryInput): Promise<DiscoveryHit[]>;
  healthCheck(): Promise<ProviderHealth>;
}
