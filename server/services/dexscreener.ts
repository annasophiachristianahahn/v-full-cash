interface DexScreenerToken {
  url: string;
  chainId: string;
  tokenAddress: string;
  description: string;
  icon?: string;
  header?: string;
  totalAmount?: number;
}

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  volume: {
    h1?: number;
    h6?: number;
    h24?: number;
  };
  priceChange: {
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ url: string }>;
    socials?: Array<{ platform: string; handle: string }>;
  };
  boosts?: {
    active: number;
  };
}

interface TrendingToken {
  symbol: string;
  name: string;
  address: string;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  priceUsd: string;
  icon?: string;
  boost?: number;
}

interface CoinGeckoToken {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price?: number;
  market_cap?: number;
  total_volume?: number;
  price_change_percentage_24h?: number;
}

interface SpecificTokenMapping {
  symbol: string;
  contractAddress: string;
}

export class DexScreenerService {
  private baseUrl = "https://api.dexscreener.com";
  private coinGeckoUrl = "https://api.coingecko.com/api/v3";

  // Rate limiting: 60 requests per minute for boost endpoints, 300 for token data
  private async makeRequest(endpoint: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`);
      
      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status} - ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching from DexScreener:', error);
      throw error;
    }
  }

  // Get boosted tokens as a proxy for trending (since no direct trending endpoint exists)
  async getTrendingTokens(timeframe: '1h' | '24h' = '24h'): Promise<TrendingToken[]> {
    try {
      // Get top boosted tokens (these are often trending/popular)
      const boostedTokens: DexScreenerToken[] = await this.makeRequest('/token-boosts/top/v1');
      
      // Filter for Solana tokens only
      const solanaTokens = boostedTokens.filter(token => token.chainId === 'solana');
      
      // Take first 15 tokens
      const topTokens = solanaTokens.slice(0, 15);
      
      if (topTokens.length === 0) {
        console.log('No Solana tokens found in boosted list');
        return [];
      }

      // Get market data for each token
      const trendingTokens: TrendingToken[] = [];
      
      // Process tokens in batches to respect rate limits
      const batchSize = 10;
      for (let i = 0; i < topTokens.length; i += batchSize) {
        const batch = topTokens.slice(i, i + batchSize);
        const tokenAddresses = batch.map(token => token.tokenAddress).join(',');
        
        try {
          const pairs: DexScreenerPair[] = await this.makeRequest(`/tokens/v1/solana/${tokenAddresses}`);
          
          // Process each token's data
          for (const token of batch) {
            // Find the best pair for this token (highest volume/liquidity)
            const tokenPairs = pairs.filter(pair => 
              pair.baseToken.address === token.tokenAddress
            );
            
            if (tokenPairs.length === 0) {
              console.log(`No pairs found for token: ${token.tokenAddress}`);
              continue;
            }

            // Sort by volume and take the highest volume pair
            const bestPair = tokenPairs.sort((a, b) => {
              const volumeA = timeframe === '1h' ? (a.volume.h1 || 0) : (a.volume.h24 || 0);
              const volumeB = timeframe === '1h' ? (b.volume.h1 || 0) : (b.volume.h24 || 0);
              return volumeB - volumeA;
            })[0];

            const volume = timeframe === '1h' ? (bestPair.volume.h1 || 0) : (bestPair.volume.h24 || 0);
            const priceChange = timeframe === '1h' ? (bestPair.priceChange.h1 || 0) : (bestPair.priceChange.h24 || 0);

            trendingTokens.push({
              symbol: bestPair.baseToken.symbol,
              name: bestPair.baseToken.name,
              address: token.tokenAddress,
              marketCap: bestPair.marketCap || bestPair.fdv || 0,
              volume24h: volume,
              priceChange24h: priceChange,
              priceUsd: bestPair.priceUsd,
              icon: token.icon ? `https://cdn.dexscreener.com/cms/images/${token.icon}?width=64&height=64&fit=crop&quality=95&format=auto` : undefined,
              boost: token.totalAmount
            });
          }
        } catch (error) {
          console.error(`Error fetching token data for batch starting at ${i}:`, error);
        }
        
        // Add delay between batches to respect rate limits
        if (i + batchSize < topTokens.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Sort by volume (or market cap as fallback)
      return trendingTokens.sort((a, b) => {
        if (b.volume24h !== a.volume24h) {
          return b.volume24h - a.volume24h;
        }
        return b.marketCap - a.marketCap;
      });

    } catch (error) {
      console.error('Error fetching trending tokens:', error);
      return [];
    }
  }

  // Get token data by known address (more reliable than symbol search)
  async getTokenDataByAddress(address: string, symbol?: string): Promise<TrendingToken | null> {
    try {
      const pairs: DexScreenerPair[] = await this.makeRequest(`/tokens/v1/solana/${address}`);
      
      if (!pairs || pairs.length === 0) {
        console.log(`No pairs found for address: ${address}`);
        return null;
      }

      // Sort by volume and take the highest volume pair
      const bestPair = pairs.sort((a: DexScreenerPair, b: DexScreenerPair) => {
        const volumeA = a.volume.h24 || 0;
        const volumeB = b.volume.h24 || 0;
        return volumeB - volumeA;
      })[0];

      return {
        symbol: bestPair.baseToken.symbol,
        name: bestPair.baseToken.name,
        address: bestPair.baseToken.address,
        marketCap: bestPair.marketCap || bestPair.fdv || 0,
        volume24h: bestPair.volume.h24 || 0,
        priceChange24h: bestPair.priceChange.h24 || 0,
        priceUsd: bestPair.priceUsd,
        icon: bestPair.info?.imageUrl
      };
    } catch (error) {
      console.error(`Error fetching token data for address ${address}:`, error);
      return null;
    }
  }

  // Search for a token by symbol using trending tokens (fallback method)
  // When multiple coins have the same ticker, prioritize the one with highest market cap
  async getTokenDataBySymbol(symbol: string): Promise<TrendingToken | null> {
    try {
      const allMatchingTokens: TrendingToken[] = [];
      
      // Try to find ALL tokens with matching symbol in trending/boosted tokens
      const trendingTokens = await this.getTrendingTokens();
      const matchingTrending = trendingTokens.filter(token => 
        token.symbol.toUpperCase() === symbol.toUpperCase()
      );
      allMatchingTokens.push(...matchingTrending);

      // Also search in latest tokens
      const latestTokens = await this.getLatestTokens();
      const matchingLatest = latestTokens.filter(token => 
        token.symbol.toUpperCase() === symbol.toUpperCase()
      );
      allMatchingTokens.push(...matchingLatest);
      
      if (allMatchingTokens.length === 0) {
        return null;
      }
      
      // If multiple tokens found with same symbol, return the one with highest market cap
      if (allMatchingTokens.length > 1) {
        console.log(`Found ${allMatchingTokens.length} tokens with symbol ${symbol}, selecting highest market cap`);
        const highestMarketCap = allMatchingTokens.reduce((highest, current) => {
          const highestMcap = highest.marketCap || 0;
          const currentMcap = current.marketCap || 0;
          return currentMcap > highestMcap ? current : highest;
        });
        console.log(`Selected ${highestMarketCap.name} with market cap: $${highestMarketCap.marketCap?.toLocaleString()}`);
        return highestMarketCap;
      }
      
      return allMatchingTokens[0];
    } catch (error) {
      console.error(`Error fetching token data for symbol ${symbol}:`, error);
      return null;
    }
  }

  // Manual fallback data for specific user tokens when APIs don't have them
  private getManualTokenData(symbol: string, contractAddress: string): TrendingToken | null {
    const manualData: { [key: string]: Partial<TrendingToken> } = {
      "CRYPTO": {
        symbol: "CRYPTO",
        name: "CRYPTO Token",
        address: contractAddress,
        marketCap: 0, // Will be updated when real data becomes available
        volume24h: 0,
        priceChange24h: 0,
        priceUsd: "0",
        icon: undefined
      },
      "SIGMA": {
        symbol: "SIGMA", 
        name: "SIGMA Token",
        address: contractAddress,
        marketCap: 0, // Will be updated when real data becomes available
        volume24h: 0,
        priceChange24h: 0,
        priceUsd: "0",
        icon: undefined
      },
      "TROLL": {
        symbol: "TROLL",
        name: "TROLL Token",
        address: contractAddress,
        marketCap: 0, // Will be updated when real data becomes available
        volume24h: 0,
        priceChange24h: 0,
        priceUsd: "0",
        icon: undefined
      }
    };

    const data = manualData[symbol.toUpperCase()];
    if (data) {
      return {
        symbol: data.symbol!,
        name: data.name!,
        address: data.address!,
        marketCap: data.marketCap!,
        volume24h: data.volume24h!,
        priceChange24h: data.priceChange24h!,
        priceUsd: data.priceUsd!,
        icon: data.icon
      };
    }
    return null;
  }

  // Improved CoinGecko API integration using efficient batch endpoints
  private coinGeckoCache = new Map<string, TrendingToken>();
  private lastCoinGeckoCall = 0;
  private readonly COINGECKO_RATE_LIMIT = 3000; // 3 seconds between calls to avoid rate limits

  private async rateLimitedFetch(url: string): Promise<Response> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCoinGeckoCall;
    
    if (timeSinceLastCall < this.COINGECKO_RATE_LIMIT) {
      const waitTime = this.COINGECKO_RATE_LIMIT - timeSinceLastCall;
      console.log(`Rate limiting: waiting ${waitTime}ms before CoinGecko API call`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastCoinGeckoCall = Date.now();
    return fetch(url);
  }

  // Clear cache for specific symbol (useful when contract addresses are updated)
  clearCacheForSymbol(symbol: string): void {
    this.coinGeckoCache.delete(symbol.toUpperCase());
    console.log(`Cleared cache for symbol: ${symbol}`);
  }

  // Clear entire cache
  clearAllCache(): void {
    this.coinGeckoCache.clear();
    console.log('Cleared all CoinGecko cache');
  }

  private async searchCoinGeckoBatch(symbols: string[]): Promise<Map<string, TrendingToken>> {
    const results = new Map<string, TrendingToken>();
    
    try {
      console.log(`Searching CoinGecko for batch: ${symbols.join(', ')} (Solana tokens only)`);
      
      // Step 1: Get all available coins to map symbols to IDs (cached for efficiency)
      const coinsListResponse = await this.rateLimitedFetch(`${this.coinGeckoUrl}/coins/list?include_platform=true`);
      if (!coinsListResponse.ok) {
        console.log(`CoinGecko coins list failed: ${coinsListResponse.status}`);
        return results;
      }
      
      const allCoins = await coinsListResponse.json();
      
      // Step 2: Map our symbols to CoinGecko IDs, but ONLY for Solana tokens
      const symbolToId = new Map<string, string>();
      for (const symbol of symbols) {
        // Filter for Solana tokens only by checking if they have a Solana platform
        const solanaCoins = allCoins.filter((c: any) => 
          c.platforms && c.platforms.solana && 
          c.symbol?.toLowerCase() === symbol.toLowerCase()
        );
        
        let coin;
        if (solanaCoins.length > 0) {
          // If multiple Solana tokens with same symbol, we'll get market cap data to choose the best one
          coin = solanaCoins[0]; // Take first for now, will sort by market cap later
        }
        
        // If no exact symbol match on Solana, try partial name match but still Solana only
        if (!coin) {
          coin = allCoins.find((c: any) => 
            c.platforms && c.platforms.solana &&
            (c.name?.toLowerCase().includes(symbol.toLowerCase()) ||
             c.id?.toLowerCase().includes(symbol.toLowerCase()))
          );
        }
        
        if (coin) {
          symbolToId.set(symbol, coin.id);
          console.log(`Mapped ${symbol} -> ${coin.id} (${coin.name}) [Solana: ${coin.platforms.solana}]`);
        } else {
          console.log(`No Solana token found on CoinGecko for ${symbol}`);
        }
      }
      
      if (symbolToId.size === 0) {
        console.log('No symbols could be mapped to CoinGecko IDs');
        return results;
      }
      
      // Step 3: Get market data for all found coins in one efficient call (sorted by market cap)
      const coinIds = Array.from(symbolToId.values()).join(',');
      const marketsResponse = await this.rateLimitedFetch(
        `${this.coinGeckoUrl}/coins/markets?vs_currency=usd&ids=${coinIds}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`
      );
      
      if (!marketsResponse.ok) {
        console.log(`CoinGecko markets request failed: ${marketsResponse.status}`);
        return results;
      }
      
      const marketsData = await marketsResponse.json();
      
      // Step 4: Map results back to original symbols, ensuring only Solana tokens
      for (const [symbol, coinId] of Array.from(symbolToId.entries())) {
        const coinData = marketsData.find((coin: any) => coin.id === coinId);
        
        if (coinData) {
          // Double-check this is a Solana token by verifying contract address format
          const contractAddress = coinData.contract_address || '';
          const isSolanaToken = contractAddress.length >= 32 && contractAddress.length <= 44; // Solana address format
          
          if (isSolanaToken || contractAddress === '') {
            const tokenData: TrendingToken = {
              symbol: symbol.toUpperCase(),
              name: coinData.name,
              address: contractAddress,
              marketCap: coinData.market_cap || 0,
              volume24h: coinData.total_volume || 0,
              priceChange24h: coinData.price_change_percentage_24h || 0,
              priceUsd: (coinData.current_price || 0).toString(),
              icon: coinData.image
            };
            
            results.set(symbol.toUpperCase(), tokenData);
            // Cache the result
            this.coinGeckoCache.set(symbol.toUpperCase(), tokenData);
            
            console.log(`Found Solana token ${symbol}: $${coinData.market_cap?.toLocaleString()} market cap, $${coinData.total_volume?.toLocaleString()} volume`);
          } else {
            console.log(`Skipped non-Solana token ${symbol} (${coinData.name})`);
          }
        }
      }
      
      return results;
      
    } catch (error) {
      console.error('Error in CoinGecko batch search:', error);
      return results;
    }
  }

  // Get real market data for multiple tokens by symbol - optimized approach
  async getTokensDataBySymbols(symbols: string[]): Promise<Map<string, TrendingToken>> {
    const results = new Map<string, TrendingToken>();
    const symbolsNotFound: string[] = [];
    
    // Define specific token mappings for user's exact contracts
    const specificTokens: SpecificTokenMapping[] = [
      { symbol: "CRYPTO", contractAddress: "4ikwYoNvoGEwtMbziUyYBTz1zRM6nmxspsfw9G7Bpump" },
      { symbol: "SIGMA", contractAddress: "5SVG3T9CNQsm2kEwzbRq6hASqh1oGfjqTtLXYUibpump" },
      { symbol: "TROLL", contractAddress: "5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2" }
    ];
    
    // Step 1: Check cache first
    for (const symbol of symbols) {
      const cached = this.coinGeckoCache.get(symbol.toUpperCase());
      if (cached) {
        results.set(symbol.toUpperCase(), cached);
        console.log(`Using cached data for ${symbol}`);
      } else {
        symbolsNotFound.push(symbol);
      }
    }
    
    if (symbolsNotFound.length === 0) {
      return results; // All found in cache
    }
    
    // Step 2: Try DexScreener first for specific contract addresses
    const stillNotFound: string[] = [];
    for (const symbol of symbolsNotFound) {
      const specificToken = specificTokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
      
      if (specificToken) {
        // Clear any cached data for this symbol to ensure we use the correct contract address
        this.clearCacheForSymbol(symbol);
        console.log(`Using specific contract address for ${symbol}: ${specificToken.contractAddress}`);
        const tokenData = await this.getTokenDataByAddress(specificToken.contractAddress, symbol);
        if (tokenData) {
          results.set(symbol.toUpperCase(), tokenData);
          console.log(`Found ${symbol} using specific contract address`);
          continue;
        } else {
          // Manual fallback for user's specific tokens when DexScreener doesn't have them
          const manualTokenData = this.getManualTokenData(symbol, specificToken.contractAddress);
          if (manualTokenData) {
            results.set(symbol.toUpperCase(), manualTokenData);
            console.log(`Using manual fallback data for ${symbol}`);
            continue;
          }
        }
      }
      
      // Try general DexScreener search
      const tokenData = await this.getTokenDataBySymbol(symbol);
      if (tokenData) {
        results.set(symbol.toUpperCase(), tokenData);
        console.log(`Found ${symbol} on DexScreener`);
      } else {
        stillNotFound.push(symbol);
      }
      
      // Small delay for DexScreener
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Step 3: Use CoinGecko batch search for remaining symbols
    if (stillNotFound.length > 0) {
      console.log(`${stillNotFound.length} symbols not found on DexScreener, trying CoinGecko batch search...`);
      const coinGeckoResults = await this.searchCoinGeckoBatch(stillNotFound);
      
      // Merge CoinGecko results
      for (const [symbol, tokenData] of Array.from(coinGeckoResults.entries())) {
        results.set(symbol, tokenData);
      }
    }
    
    return results;
  }

  // Alternative: Get latest token profiles (another proxy for trending)
  async getLatestTokens(): Promise<TrendingToken[]> {
    try {
      const latestTokens: DexScreenerToken[] = await this.makeRequest('/token-profiles/latest/v1');
      
      // Filter for Solana and take first 15
      const solanaTokens = latestTokens
        .filter(token => token.chainId === 'solana')
        .slice(0, 15);

      if (solanaTokens.length === 0) {
        return [];
      }

      // Similar processing as getTrendingTokens but for latest profiles
      const tokens: TrendingToken[] = [];
      
      const batchSize = 10;
      for (let i = 0; i < solanaTokens.length; i += batchSize) {
        const batch = solanaTokens.slice(i, i + batchSize);
        const tokenAddresses = batch.map(token => token.tokenAddress).join(',');
        
        try {
          const pairs: DexScreenerPair[] = await this.makeRequest(`/tokens/v1/solana/${tokenAddresses}`);
          
          for (const token of batch) {
            const tokenPairs = pairs.filter(pair => 
              pair.baseToken.address === token.tokenAddress
            );
            
            if (tokenPairs.length === 0) continue;

            const bestPair = tokenPairs.sort((a, b) => {
              const volumeA = a.volume.h24 || 0;
              const volumeB = b.volume.h24 || 0;
              return volumeB - volumeA;
            })[0];

            tokens.push({
              symbol: bestPair.baseToken.symbol,
              name: bestPair.baseToken.name,
              address: token.tokenAddress,
              marketCap: bestPair.marketCap || bestPair.fdv || 0,
              volume24h: bestPair.volume.h24 || 0,
              priceChange24h: bestPair.priceChange.h24 || 0,
              priceUsd: bestPair.priceUsd,
              icon: token.icon ? `https://cdn.dexscreener.com/cms/images/${token.icon}?width=64&height=64&fit=crop&quality=95&format=auto` : undefined
            });
          }
        } catch (error) {
          console.error(`Error fetching latest token data for batch starting at ${i}:`, error);
        }
        
        if (i + batchSize < solanaTokens.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return tokens.sort((a, b) => b.volume24h - a.volume24h);

    } catch (error) {
      console.error('Error fetching latest tokens:', error);
      return [];
    }
  }
}