import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Zap, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export function TweetReplyTest() {
  const [tweetUrl, setTweetUrl] = useState("");
  const [result, setResult] = useState<{
    success: boolean;
    primaryAccount?: string;
    raidRounds?: number;
    generatedReply?: string;
    error?: string;
  } | null>(null);
  const { toast } = useToast();

  // Single Auto Run mutation
  const singleAutoRunMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest("POST", "/api/single-auto-run", {
        tweetUrl: url,
        sendDm: true
      });
      return response.json();
    },
    onSuccess: (data) => {
      setResult({
        success: true,
        primaryAccount: data.primaryAccount,
        raidRounds: data.raidRounds,
        generatedReply: data.generatedReply
      });
      toast({
        title: "Single Auto Run Started",
        description: `Primary: @${data.primaryAccount} + ${data.raidRounds} raid replies queued`,
      });
    },
    onError: (error) => {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Failed to start auto run"
      });
      toast({
        title: "Auto Run Failed",
        description: error instanceof Error ? error.message : "Failed to start auto run",
        variant: "destructive",
      });
    },
  });

  const handleSingleAutoRun = () => {
    if (!tweetUrl.trim()) {
      toast({
        title: "URL required",
        description: "Please paste a tweet URL",
        variant: "destructive",
      });
      return;
    }
    
    // Validate URL format
    const isValidUrl = /(?:twitter\.com|x\.com)\/\w+\/status\/\d+/.test(tweetUrl);
    if (!isValidUrl) {
      toast({
        title: "Invalid URL",
        description: "Please paste a valid Twitter/X tweet URL",
        variant: "destructive",
      });
      return;
    }
    
    setResult(null);
    singleAutoRunMutation.mutate(tweetUrl);
  };

  return (
    <Card className="border-2 border-purple-500/50 bg-purple-50/5 dark:bg-purple-950/5" data-testid="test-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <span>SINGLE TWEET AUTO RESPOND</span>
        </CardTitle>
        <CardDescription>
          Paste a tweet URL to trigger full auto-run chain: primary reply + raid replies with images
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="https://x.com/username/status/123456789..."
            value={tweetUrl}
            onChange={(e) => setTweetUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSingleAutoRun()}
            disabled={singleAutoRunMutation.isPending}
            data-testid="input-test-tweet-url"
          />
          <Button
            onClick={handleSingleAutoRun}
            disabled={singleAutoRunMutation.isPending}
            className="bg-purple-600 hover:bg-purple-700 text-white min-w-[140px]"
            data-testid="button-single-auto-run"
          >
            {singleAutoRunMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Single Auto Run
              </>
            )}
          </Button>
        </div>

        {/* Result display */}
        {result && (
          <div className={`p-4 rounded-lg border ${
            result.success 
              ? 'bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-800' 
              : 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
          }`}>
            <div className="flex items-start gap-3">
              {result.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 space-y-2">
                {result.success ? (
                  <>
                    <div className="font-medium text-green-800 dark:text-green-200">
                      Auto Run Queued Successfully
                    </div>
                    <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
                      <div>Primary: <span className="font-mono">@{result.primaryAccount}</span></div>
                      <div>Raid Replies: <span className="font-mono">{result.raidRounds}</span> accounts queued</div>
                    </div>
                    {result.generatedReply && (
                      <div className="mt-3 p-2 bg-white/50 dark:bg-black/20 rounded border border-green-200 dark:border-green-700">
                        <div className="text-xs text-green-600 dark:text-green-400 mb-1">Primary Reply:</div>
                        <div className="text-sm text-green-800 dark:text-green-200">{result.generatedReply}</div>
                      </div>
                    )}
                    <div className="text-xs text-green-600 dark:text-green-400 mt-2">
                      Check the Job Queue panel to monitor reply progress
                    </div>
                  </>
                ) : (
                  <div className="text-red-700 dark:text-red-300">
                    {result.error}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
