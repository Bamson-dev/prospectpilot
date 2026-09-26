export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type SearchOptions = {
  limit: number;
};

export interface SearchProvider {
  readonly name: string;
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}
