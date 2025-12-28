import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TrendingUp, Clock, ChevronDown, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { formatNumber } from "@/lib/formatters";
import { queryClient } from "@/lib/queryClient";

interface PinnedTrendingToken {
  id: string;
  symbol: string;
  createdAt: Date;
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

interface TrendingTokensResponse {
  timeframe: string;
  tokens: TrendingToken[];
  count: number;
}

interface TrendingTokensProps {
  onTokenClick?: (symbol: string) => void;
}

function TokenItem({ token, isPinned, onTogglePin }: { 
  token: TrendingToken; 
  isPinned: boolean;
  onTogglePin: (symbol: string, pin: boolean) => void;
}) {
  const isPositive = token.priceChange24h > 0;
  
  return (
    <div 
      className={cn(
        "flex items-center justify-between p-3 md:p-2 rounded border bg-card hover:bg-accent transition-colors cursor-pointer group relative",
        isPinned && "ring-2 ring-yellow-500 dark:ring-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10"
      )}
      onClick={() => onTogglePin(token.symbol, !isPinned)}
      data-testid={`token-item-${token.symbol}`}
    >
      {isPinned && (
        <div className="absolute -top-2 -right-2 bg-yellow-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
          PINNED
        </div>
      )}
      <div className="flex items-center space-x-3 md:space-x-2 flex-1 min-w-0">
        {token.icon && (
          <img 
            src={token.icon} 
            alt={token.symbol}
            className="w-6 h-6 md:w-4 md:h-4 rounded-full flex-shrink-0"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm md:text-xs truncate block" data-testid={`text-symbol-${token.symbol}`}>
            ${token.symbol}
          </span>
          <div className="space-y-1 md:space-y-0.5">
            <span className="text-sm md:text-xs text-muted-foreground block" data-testid={`text-marketcap-${token.symbol}`}>
              MC: {formatNumber(token.marketCap)}
            </span>
            <span className="text-sm md:text-xs text-muted-foreground block" data-testid={`text-volume-${token.symbol}`}>
              Vol: {formatNumber(token.volume24h)}
            </span>
          </div>
        </div>
      </div>
      
      <div className="flex items-center space-x-2">
        {isPinned && (
          <Pin className="w-4 h-4 text-yellow-500 fill-current flex-shrink-0" />
        )}
        <span 
          className={cn(
            "text-sm md:text-xs font-medium px-2 py-1 md:px-1 md:py-0.5 rounded flex-shrink-0",
            isPositive 
              ? "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/20" 
              : "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/20"
          )}
          data-testid={`text-change-${token.symbol}`}
        >
          {isPositive ? '+' : ''}{token.priceChange24h.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function TokenList({ timeframe, pinnedSymbols, onTogglePin }: { 
  timeframe: '1h' | '24h'; 
  pinnedSymbols: Set<string>;
  onTogglePin: (symbol: string, pin: boolean) => void;
}) {
  const { data, isLoading, error } = useQuery<TrendingTokensResponse>({
    queryKey: ['/api/trending', timeframe],
    refetchInterval: 60000, // Refresh every minute
    enabled: true, // Always enabled to load on page load
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-2">
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="flex items-center space-x-2 p-2 rounded border bg-card animate-pulse">
            <div className="w-4 h-4 bg-muted rounded-full"></div>
            <div className="flex-1 space-y-1">
              <div className="w-12 h-3 bg-muted rounded"></div>
              <div className="w-16 h-3 bg-muted rounded"></div>
            </div>
            <div className="w-8 h-3 bg-muted rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-muted-foreground py-4">
        <p className="text-sm">Failed to load trending tokens</p>
      </div>
    );
  }

  if (!data || data.tokens.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4">
        <p className="text-sm">No trending tokens found</p>
      </div>
    );
  }

  // Show all 15 tokens in a grid layout, pinned first
  const displayTokens = data.tokens.slice(0, 15);
  const sortedTokens = [...displayTokens].sort((a, b) => {
    const aPinned = pinnedSymbols.has(a.symbol.toUpperCase());
    const bPinned = pinnedSymbols.has(b.symbol.toUpperCase());
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return 0;
  });

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-2">
      {sortedTokens.map((token) => (
        <TokenItem 
          key={token.address} 
          token={token} 
          isPinned={pinnedSymbols.has(token.symbol.toUpperCase())}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
}

export function TrendingTokens() {
  const [isOpen, setIsOpen] = useState(true);

  // Fetch pinned trending tokens
  const { data: pinnedTokens = [] } = useQuery<PinnedTrendingToken[]>({
    queryKey: ['/api/pinned-trending-tokens'],
  });

  const pinnedSymbols = new Set(pinnedTokens.map(t => t.symbol.toUpperCase()));
  const pinnedCount = pinnedSymbols.size;

  // Add pin mutation with optimistic update
  const addPinMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const response = await fetch('/api/pinned-trending-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.toUpperCase() }),
      });
      if (!response.ok) throw new Error('Failed to pin token');
      return response.json();
    },
    onMutate: async (symbol: string) => {
      await queryClient.cancelQueries({ queryKey: ['/api/pinned-trending-tokens'] });
      const previous = queryClient.getQueryData<PinnedTrendingToken[]>(['/api/pinned-trending-tokens']);
      queryClient.setQueryData<PinnedTrendingToken[]>(['/api/pinned-trending-tokens'], (old = []) => [
        ...old,
        { id: `temp-${symbol}`, symbol: symbol.toUpperCase(), createdAt: new Date() }
      ]);
      return { previous };
    },
    onError: (_err, _symbol, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['/api/pinned-trending-tokens'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pinned-trending-tokens'] });
    }
  });

  // Remove pin mutation with optimistic update
  const removePinMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const response = await fetch(`/api/pinned-trending-tokens/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to unpin token');
      return response.json();
    },
    onMutate: async (symbol: string) => {
      await queryClient.cancelQueries({ queryKey: ['/api/pinned-trending-tokens'] });
      const previous = queryClient.getQueryData<PinnedTrendingToken[]>(['/api/pinned-trending-tokens']);
      queryClient.setQueryData<PinnedTrendingToken[]>(['/api/pinned-trending-tokens'], (old = []) =>
        old.filter(t => t.symbol.toUpperCase() !== symbol.toUpperCase())
      );
      return { previous };
    },
    onError: (_err, _symbol, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['/api/pinned-trending-tokens'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pinned-trending-tokens'] });
    }
  });

  const handleTogglePin = (symbol: string, pin: boolean) => {
    if (pin) {
      addPinMutation.mutate(symbol);
    } else {
      removePinMutation.mutate(symbol);
    }
  };

  return (
    <div className="mb-4 rounded-lg border bg-card">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-accent transition-colors relative overflow-hidden">
          {/* Animated candle chart positioned after text when collapsed */}
          {!isOpen && (
            <div className="absolute left-72 top-1/2 -translate-y-1/2 flex items-end space-x-1">
              <div className="animate-candle-1 w-1 bg-gradient-to-t from-green-400 via-green-300 to-green-200 rounded-t" style={{ animationDelay: '0s', backgroundColor: '#00ff7f' }}></div>
              <div className="animate-candle-2 w-1 bg-gradient-to-t from-green-400 via-green-300 to-green-200 rounded-t" style={{ animationDelay: '0.5s', backgroundColor: '#00ff7f' }}></div>
              <div className="animate-candle-3 w-1 bg-gradient-to-t from-green-400 via-green-300 to-green-200 rounded-t" style={{ animationDelay: '1s', backgroundColor: '#00ff7f' }}></div>
              <div className="animate-candle-4 w-1 bg-gradient-to-t from-green-400 via-green-300 to-green-200 rounded-t" style={{ animationDelay: '1.5s', backgroundColor: '#00ff7f' }}></div>
              <div className="animate-candle-5 w-1 bg-gradient-to-t from-green-400 via-green-300 to-green-200 rounded-t" style={{ animationDelay: '2s', backgroundColor: '#00ff7f' }}></div>
            </div>
          )}
          
          <div className="flex items-center space-x-2 relative z-10">
            <TrendingUp className="w-4 h-4" />
            <span className="font-medium text-sm">TRENDING SOLANA TOKENS</span>
            {pinnedCount > 0 && (
              <Badge variant="secondary" className="bg-yellow-500 text-white text-[10px] px-1.5 py-0">
                {pinnedCount} PINNED
              </Badge>
            )}
          </div>
          <div className="flex items-center space-x-2 relative z-10">
            <p className="text-xs text-muted-foreground">
              SELECT TRENDING CASHTAGS TO SEARCH
            </p>
            <ChevronDown 
              className={cn(
                "w-4 h-4 transition-transform",
                isOpen ? "rotate-180" : ""
              )} 
            />
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="px-4 pb-4">
          <Tabs defaultValue="24h" className="w-full">
            <TabsList className="grid w-48 grid-cols-2 h-8 mb-3">
              <TabsTrigger value="1h" className="text-xs" data-testid="tab-1h">
                1H
              </TabsTrigger>
              <TabsTrigger value="24h" className="text-xs" data-testid="tab-24h">
                24H
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="1h" className="mt-0">
              <TokenList timeframe="1h" pinnedSymbols={pinnedSymbols} onTogglePin={handleTogglePin} />
            </TabsContent>
            
            <TabsContent value="24h" className="mt-0">
              <TokenList timeframe="24h" pinnedSymbols={pinnedSymbols} onTogglePin={handleTogglePin} />
            </TabsContent>
          </Tabs>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}