import { useState, useEffect, type KeyboardEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Star, ChevronDown, Plus, X, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface RecommendedCashtag {
  id: string;
  symbol: string;
  name: string;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  icon?: string | null;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RecommendedCashtagsProps {
  onTokenClick?: (symbol: string) => void;
}

function formatNumber(num: number): string {
  if (num >= 1e9) {
    return `$${(num / 1e9).toFixed(2)}B`;
  } else if (num >= 1e6) {
    return `$${(num / 1e6).toFixed(2)}M`;
  } else if (num >= 1e3) {
    return `$${(num / 1e3).toFixed(2)}K`;
  } else {
    return `$${num.toFixed(2)}`;
  }
}

function RecommendedCashtagItem({ 
  cashtag, 
  onRemove,
  onTogglePinned 
}: { 
  cashtag: RecommendedCashtag; 
  onRemove: (symbol: string) => void;
  onTogglePinned: (symbol: string, isPinned: boolean) => void;
}) {
  const isPositive = cashtag.priceChange24h > 0;
  
  return (
    <div 
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-3 md:p-2 rounded border bg-card hover:bg-accent transition-colors cursor-pointer group space-y-2 sm:space-y-0 relative",
        cashtag.isPinned && "ring-2 ring-yellow-500 dark:ring-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10"
      )}
      onClick={() => onTogglePinned(cashtag.symbol, !cashtag.isPinned)}
      data-testid={`recommended-item-${cashtag.symbol}`}
    >
      {cashtag.isPinned && (
        <div className="absolute -top-2 -right-2 bg-yellow-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
          PINNED
        </div>
      )}
      <div className="flex items-center space-x-3 sm:space-x-2 flex-1 min-w-0">
        {cashtag.icon && (
          <img 
            src={cashtag.icon} 
            alt={cashtag.symbol}
            className="w-8 h-8 sm:w-6 sm:h-6 md:w-4 md:h-4 rounded-full flex-shrink-0"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-base sm:text-sm md:text-xs block" data-testid={`text-symbol-${cashtag.symbol}`}>
            ${cashtag.symbol}
          </span>
          <div className="space-y-1 sm:space-y-0.5">
            <span className="text-sm sm:text-xs text-muted-foreground block" data-testid={`text-marketcap-${cashtag.symbol}`}>
              MC: {formatNumber(cashtag.marketCap)}
            </span>
            <span className="text-sm sm:text-xs text-muted-foreground block" data-testid={`text-volume-${cashtag.symbol}`}>
              Vol: {formatNumber(cashtag.volume24h)}
            </span>
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-between sm:justify-end space-x-2">
        {cashtag.isPinned && (
          <Pin className="w-4 h-4 text-yellow-500 fill-current flex-shrink-0" />
        )}
        <span 
          className={cn(
            "text-sm sm:text-xs font-medium px-3 py-1.5 sm:px-2 sm:py-1 md:px-1 md:py-0.5 rounded flex-shrink-0",
            isPositive 
              ? "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/20" 
              : "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/20"
          )}
          data-testid={`text-change-${cashtag.symbol}`}
        >
          {isPositive ? '+' : ''}{(cashtag.priceChange24h / 100).toFixed(1)}%
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 sm:h-6 sm:w-6 p-0 opacity-70 sm:opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(cashtag.symbol);
          }}
          data-testid={`button-remove-${cashtag.symbol}`}
        >
          <X className="w-4 h-4 sm:w-3 sm:h-3" />
        </Button>
      </div>
    </div>
  );
}

export function RecommendedCashtags() {
  const [isOpen, setIsOpen] = useState(true); // Open by default
  const [newCashtag, setNewCashtag] = useState("");

  // Fetch recommended cashtags from API
  const { data: recommendedCashtags = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/recommended-cashtags'],
    queryFn: async () => {
      const response = await fetch('/api/recommended-cashtags');
      if (!response.ok) throw new Error('Failed to fetch recommended cashtags');
      return response.json() as Promise<RecommendedCashtag[]>;
    }
  });

  // Create new cashtag mutation
  const createCashtagMutation = useMutation({
    mutationFn: async (cashtagData: { symbol: string }) => {
      const response = await fetch('/api/recommended-cashtags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cashtagData),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create cashtag');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/recommended-cashtags'] });
      setNewCashtag("");
    },
    onError: (error) => {
      console.error('Error adding cashtag:', error);
      // You could add a toast notification here
    }
  });

  // Delete cashtag mutation
  const deleteCashtagMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const response = await fetch(`/api/recommended-cashtags/${symbol}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete cashtag');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/recommended-cashtags'] });
    }
  });

  // Toggle pinned status mutation with optimistic update
  const togglePinnedMutation = useMutation({
    mutationFn: async ({ symbol, isPinned }: { symbol: string; isPinned: boolean }) => {
      const response = await fetch(`/api/recommended-cashtags/${encodeURIComponent(symbol)}/toggle-pinned`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned }),
      });
      if (!response.ok) throw new Error('Failed to toggle pinned status');
      return response.json();
    },
    onMutate: async ({ symbol, isPinned }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/recommended-cashtags'] });
      const previous = queryClient.getQueryData<RecommendedCashtag[]>(['/api/recommended-cashtags']);
      queryClient.setQueryData<RecommendedCashtag[]>(['/api/recommended-cashtags'], (old = []) =>
        old.map(c => c.symbol === symbol ? { ...c, isPinned } : c)
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['/api/recommended-cashtags'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/recommended-cashtags'] });
    }
  });

  const handleAddCashtag = () => {
    if (!newCashtag.trim()) return;
    
    const symbol = newCashtag.replace('$', '').toUpperCase().trim();
    
    // Check if already exists
    if (recommendedCashtags.some(c => c.symbol === symbol)) {
      setNewCashtag("");
      return;
    }

    // Add new cashtag - API will fetch real market data
    createCashtagMutation.mutate({ symbol });
  };

  const handleRemoveCashtag = (symbol: string) => {
    deleteCashtagMutation.mutate(symbol);
  };

  const handleTogglePinned = (symbol: string, isPinned: boolean) => {
    togglePinnedMutation.mutate({ symbol, isPinned });
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddCashtag();
    }
  };

  // Sort cashtags: pinned first, then by volume
  const sortedCashtags = [...recommendedCashtags].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.volume24h - a.volume24h;
  });

  const pinnedCount = recommendedCashtags.filter(c => c.isPinned).length;


  return (
    <div className="mb-4 rounded-lg border bg-card">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-accent transition-colors">
          <div className="flex items-center space-x-2">
            <Star className="w-4 h-4" />
            <span className="font-medium text-sm">SUGGESTED CASHTAGS</span>
            {pinnedCount > 0 && (
              <Badge variant="secondary" className="bg-yellow-500 text-white text-[10px] px-1.5 py-0">
                {pinnedCount} PINNED
              </Badge>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <p className="text-xs text-muted-foreground">
              SELECT SUGGESTED CASHTAGS TO SEARCH
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
          {/* Add new cashtag input */}
          <div className="flex space-x-2 mb-4">
            <Input
              placeholder="Enter cashtag (e.g., DOGE, BTC)"
              value={newCashtag}
              onChange={(e) => setNewCashtag(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1"
              data-testid="input-new-cashtag"
            />
            <Button 
              onClick={handleAddCashtag}
              size="sm"
              disabled={createCashtagMutation.isPending}
              data-testid="button-add-cashtag"
            >
              <Plus className="w-4 h-4 mr-1" />
              {createCashtagMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </div>

          {/* Recommended cashtags grid - pinned first, then sorted by 24hr volume */}
          {isLoading ? (
            <div className="text-center text-muted-foreground py-8">
              <p className="text-sm">Loading recommended cashtags...</p>
            </div>
          ) : sortedCashtags.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-3 md:gap-2">
              {sortedCashtags.map((cashtag) => (
                <RecommendedCashtagItem 
                  key={cashtag.symbol} 
                  cashtag={cashtag} 
                  onRemove={handleRemoveCashtag}
                  onTogglePinned={handleTogglePinned}
                />
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              <p className="text-sm">No recommended cashtags yet</p>
              <p className="text-xs mt-1">Add some cashtags above to get started</p>
            </div>
          )}
          
          {/* Disclaimer about market data accuracy */}
          {recommendedCashtags.length > 0 && (
            <div className="mt-4 text-xs text-muted-foreground border-t pt-2">
              <p>
                **mcap and volume data for suggested cashtags may not be accurate but this can be ignored, it is possible they are reading data from an identical ticker
              </p>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}