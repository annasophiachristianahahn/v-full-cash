import { Tweet, TweetSearch } from "@shared/schema";

export interface ProcessingStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  timestamp?: string;
}

export interface SearchStats {
  total: number;
  filtered: number;
  bots: number;
}

export interface SearchResult {
  search: TweetSearch;
  tweets: Tweet[];
  stats: SearchStats;
}
