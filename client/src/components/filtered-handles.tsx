import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronUp, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function FilteredHandlesManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [handles, setHandles] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadHandles();
  }, []);

  const loadHandles = async () => {
    try {
      const response = await fetch('/api/filtered-handles');
      if (response.ok) {
        const data = await response.json();
        setHandles(data.handles || "");
      }
    } catch (error) {
      console.error('Failed to load filtered handles:', error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest('PUT', '/api/filtered-handles', { handles });
      
      toast({
        title: "Saved",
        description: "Filtered handles updated successfully",
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: "Failed to update filtered handles",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const parseHandles = (text: string): string[] => {
    // Parse handles from various formats: @handle, handle, comma/space/newline separated
    return text
      .split(/[\s,\n]+/)
      .map(h => h.trim().replace(/^@/, ''))
      .filter(h => h.length > 0);
  };

  const handleCount = parseHandles(handles).length;

  return (
    <Card className="mb-8">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-0 hover:bg-transparent"
              data-testid="button-toggle-filtered-handles"
            >
              <CardTitle className="text-lg font-semibold">FILTERED HANDLES</CardTitle>
              {isOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <p className="text-sm text-muted-foreground mt-2">
            Exclude specific Twitter handles from search results ({handleCount} filtered)
          </p>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Twitter Handles to Filter
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  Enter handles separated by commas, spaces, or new lines. The @ symbol is optional.
                </p>
                <Textarea
                  value={handles}
                  onChange={(e) => setHandles(e.target.value)}
                  placeholder="@yishanyugong, username2, @username3"
                  className="min-h-[120px] font-mono text-sm"
                  data-testid="input-filtered-handles"
                />
              </div>
              
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full"
                data-testid="button-save-filtered-handles"
              >
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? "Saving..." : "Save Filtered Handles"}
              </Button>

              {handleCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  <strong>Preview ({handleCount} handles):</strong>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {parseHandles(handles).map((handle, idx) => (
                      <span
                        key={idx}
                        className="inline-block bg-muted px-2 py-1 rounded"
                        data-testid={`text-filtered-handle-${idx}`}
                      >
                        @{handle}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
