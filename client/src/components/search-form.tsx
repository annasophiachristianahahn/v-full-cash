import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { searchParamsSchema, type SearchParams } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, Search, Info, X } from "lucide-react";
import { useState, forwardRef, useImperativeHandle, useEffect } from "react";

interface SearchFormProps {
  onSubmit: (params: SearchParams) => void;
  isLoading: boolean;
  onCashtagsChange?: (cashtags: string[]) => void;
}

export const SearchForm = forwardRef<
  { populateNextCashtag: (symbol: string) => void; getCashtags: () => string[] },
  SearchFormProps
>(function SearchForm({ onSubmit, isLoading, onCashtagsChange }, ref) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  
  const form = useForm<SearchParams>({
    resolver: zodResolver(searchParamsSchema),
    defaultValues: {
      cashtag1: "",
      cashtag2: "",
      cashtag3: "",
      cashtag4: "",
      cashtag5: "",
      cashtag6: "",
      cashtag7: "",
      cashtag8: "",
      minFollowers: 500,
      maxFollowers: 10000,
      timeRange: "1h",
      maxResults: "100",
      excludeRetweets: true,
      verifiedOnly: false,
    },
  });

  const watchedCashtags = form.watch(['cashtag1', 'cashtag2', 'cashtag3', 'cashtag4', 'cashtag5', 'cashtag6', 'cashtag7', 'cashtag8']);

  useEffect(() => {
    if (onCashtagsChange) {
      const cashtags = watchedCashtags
        .filter((val): val is string => typeof val === 'string' && val.trim() !== '')
        .map(val => val.startsWith('$') ? val : `$${val}`);
      onCashtagsChange(cashtags);
    }
  }, [watchedCashtags, onCashtagsChange]);

  const handleSubmit = (data: SearchParams) => {
    onSubmit(data);
  };

  const populateNextCashtag = (symbol: string) => {
    const cashtagFields = ['cashtag1', 'cashtag2', 'cashtag3', 'cashtag4', 'cashtag5', 'cashtag6', 'cashtag7', 'cashtag8'] as const;
    
    // Find the first empty cashtag field
    for (const field of cashtagFields) {
      const currentValue = form.getValues(field);
      if (!currentValue || currentValue.trim() === '') {
        form.setValue(field, symbol);
        break;
      }
    }
  };

  const getCashtags = () => {
    const cashtagFields = ['cashtag1', 'cashtag2', 'cashtag3', 'cashtag4', 'cashtag5', 'cashtag6', 'cashtag7', 'cashtag8'] as const;
    return cashtagFields
      .map(field => form.getValues(field))
      .filter((val): val is string => typeof val === 'string' && val.trim() !== '')
      .map(val => val.startsWith('$') ? val : `$${val}`);
  };

  useImperativeHandle(ref, () => ({
    populateNextCashtag,
    getCashtags
  }));

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Search Configuration</CardTitle>
        <p className="text-sm text-muted-foreground">
          Set up your cashtag search parameters and filtering criteria
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <div className="space-y-6">
            {/* Multiple Cashtag Inputs */}
            <div>
              <Label className="text-sm font-medium mb-3 block">
                Cashtags <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => {
                  const fieldName = `cashtag${num}` as keyof SearchParams;
                  const fieldValue = form.watch(fieldName);
                  
                  return (
                    <div key={num} className="relative">
                      <span className="absolute left-3 top-3 text-muted-foreground text-sm">$</span>
                      <Input
                        {...form.register(fieldName)}
                        id={`cashtag${num}`}
                        placeholder={num === 1 ? "TSLA (required)" : `Cashtag ${num}`}
                        className="pl-8 pr-8"
                        data-testid={`input-cashtag${num}`}
                      />
                      {fieldValue && String(fieldValue).trim() !== '' && (
                        <button
                          type="button"
                          onClick={() => form.setValue(fieldName, '')}
                          className="absolute right-2 top-2 p-1 text-muted-foreground hover:text-foreground transition-colors rounded-sm hover:bg-secondary"
                          data-testid={`button-clear-cashtag${num}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {num === 1 && form.formState.errors.cashtag1 && (
                        <p className="text-xs text-destructive mt-1">
                          {form.formState.errors.cashtag1.message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Enter cashtags with or without the $ symbol (e.g., "TSLA" or "$TSLA"). At least one cashtag is required.
              </p>
            </div>

            {/* Follower Range */}
            <div>
              <Label className="text-sm font-medium">Follower Count Range</Label>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <Label htmlFor="minFollowers" className="text-xs text-muted-foreground">
                    Minimum
                  </Label>
                  <Input
                    {...form.register("minFollowers", { valueAsNumber: true })}
                    id="minFollowers"
                    type="number"
                    min="0"
                    data-testid="input-min-followers"
                  />
                </div>
                <div>
                  <Label htmlFor="maxFollowers" className="text-xs text-muted-foreground">
                    Maximum
                  </Label>
                  <Input
                    {...form.register("maxFollowers", { valueAsNumber: true })}
                    id="maxFollowers"
                    type="number"
                    min="0"
                    data-testid="input-max-followers"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Options */}
          <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center text-sm font-medium hover:text-primary transition-colors">
              <ChevronRight 
                className={`w-4 h-4 mr-2 transition-transform ${isAdvancedOpen ? 'rotate-90' : ''}`} 
              />
              Advanced Options
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 pl-6 border-l-2 border-border space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="timeRange" className="text-sm font-medium">Time Range</Label>
                  <Select 
                    value={form.watch("timeRange")} 
                    onValueChange={(value) => form.setValue("timeRange", value as any)}
                  >
                    <SelectTrigger data-testid="select-time-range">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">Last 1 hour</SelectItem>
                      <SelectItem value="3h">Last 3 hours</SelectItem>
                      <SelectItem value="6h">Last 6 hours</SelectItem>
                      <SelectItem value="12h">Last 12 hours</SelectItem>
                      <SelectItem value="24h">Last 24 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="maxResults" className="text-sm font-medium">Max Results</Label>
                  <Select 
                    value={form.watch("maxResults")} 
                    onValueChange={(value) => form.setValue("maxResults", value as any)}
                  >
                    <SelectTrigger data-testid="select-max-results">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50 tweets</SelectItem>
                      <SelectItem value="100">100 tweets</SelectItem>
                      <SelectItem value="200">200 tweets</SelectItem>
                      <SelectItem value="500">500 tweets</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="excludeRetweets"
                    checked={form.watch("excludeRetweets")}
                    onCheckedChange={(checked) => form.setValue("excludeRetweets", !!checked)}
                    data-testid="checkbox-exclude-retweets"
                  />
                  <Label htmlFor="excludeRetweets" className="text-sm">Exclude retweets</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="verifiedOnly"
                    checked={form.watch("verifiedOnly")}
                    onCheckedChange={(checked) => form.setValue("verifiedOnly", !!checked)}
                    data-testid="checkbox-verified-only"
                  />
                  <Label htmlFor="verifiedOnly" className="text-sm">Verified accounts only</Label>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Submit Button */}
          <div className="flex justify-between items-center pt-4 border-t border-border">
            <div className="text-sm text-muted-foreground flex items-center">
              <Info className="w-4 h-4 mr-1" />
              Results will be processed through AI bot detection
            </div>
            <Button 
              type="submit" 
              disabled={isLoading}
              className="flex items-center space-x-2"
              data-testid="button-submit"
            >
              <Search className="w-4 h-4" />
              <span>{isLoading ? "Processing..." : "Start Analysis"}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
});
