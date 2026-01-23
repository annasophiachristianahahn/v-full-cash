import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingTokens } from "@/components/trending-tokens";
import { RecommendedCashtags } from "@/components/recommended-cashtags";
import { ProcessingStatus } from "@/components/processing-status";
import { Results } from "@/components/results";
import { RaidReply } from "@/components/raid-reply";
import { TwitterSettingsDialog } from "@/components/twitter-settings-dialog";
import { TweetReplyTest } from "@/components/tweet-reply-test";
import { SystemPromptEditor } from "@/components/system-prompt-editor";
import { ReplyImagesManager } from "@/components/reply-images";
import { FilteredHandlesManager } from "@/components/filtered-handles";
import { AccountDropdown } from "@/components/account-dropdown";
import { AutoRunPanel } from "@/components/auto-run-panel";
import { JobQueuePanel } from "@/components/job-queue-panel";
import { SchedulerPanel } from "@/components/scheduler-panel";
import { ServerLogs } from "@/components/server-logs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ProcessingStep, SearchResult } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Twitter, Sun, Moon, Settings, ChevronRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/theme-provider";
import vajFaceGif from "/vaj-face.gif";

export default function Home() {
  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isTestPanelOpen, setIsTestPanelOpen] = useState(false);
  const [collectedReplyUrls, setCollectedReplyUrls] = useState<string[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<string>("");
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  interface UsernameInfo {
    username: string;
    isActive: boolean;
    hasCookie: boolean;
  }

  const { data: usernames = [] } = useQuery<UsernameInfo[]>({
    queryKey: ["/api/twitter-usernames"],
    retry: false,
  });

  // DM enabled toggle
  const { data: dmsEnabledData } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/settings/dms-enabled"],
  });
  const dmsEnabled = dmsEnabledData?.enabled ?? true;

  const toggleDmsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/settings/dms-enabled", { enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/dms-enabled"] });
    },
  });

  useEffect(() => {
    const activeUser = usernames.find(u => u.isActive);
    if (activeUser && !selectedUsername) {
      setSelectedUsername(activeUser.username);
    }
  }, [usernames, selectedUsername]);

  // Poll for search results when we have an active search
  const { data: searchResult, isLoading: isLoadingResults } = useQuery<SearchResult>({
    queryKey: ["/api/search", currentSearchId],
    enabled: !!currentSearchId,
    refetchInterval: isSearching ? 2000 : false, // Poll every 2 seconds while searching
    refetchIntervalInBackground: true,
  });

  // Handle search completion with useEffect to avoid setState during render
  useEffect(() => {
    if (searchResult?.search?.status === "completed" || searchResult?.search?.status === "failed") {
      if (isSearching) {
        setIsSearching(false);
        if (searchResult.search.status === "completed") {
          toast({
            title: "Analysis complete",
            description: `Found ${searchResult.tweets?.length || 0} qualifying tweets.`,
          });
        } else {
          toast({
            title: "Analysis failed",
            description: "There was an error processing your search.",
            variant: "destructive",
          });
        }
      }
    }
  }, [searchResult?.search?.status, isSearching, searchResult?.tweets?.length, toast]);

  const handleExportResults = () => {
    if (!searchResult?.tweets) return;
    
    const data = searchResult.tweets.map(tweet => ({
      url: tweet.url,
      author: `@${tweet.authorHandle}`,
      content: tweet.content,
      followers: tweet.authorFollowers,
      likes: tweet.likes,
      retweets: tweet.retweets,
      timestamp: tweet.publishedAt
    }));
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `twitter-cashtag-results-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRefresh = () => {
    if (currentSearchId) {
      queryClient.invalidateQueries({ queryKey: ["/api/search", currentSearchId] });
    }
  };

  // Generate processing steps based on search status
  const getProcessingSteps = (): ProcessingStep[] => {
    if (!searchResult) return [];

    const steps: ProcessingStep[] = [
      {
        id: "fetch",
        title: "Fetching tweets from Twitter API",
        description: `Searching for tweets mentioning the specified cashtag`,
        status: "completed",
        timestamp: new Date().toLocaleTimeString(),
      },
      {
        id: "filter",
        title: "Filtering by follower count",
        description: `Applying follower count criteria`,
        status: searchResult.search.status === "processing" ? "processing" : "completed",
      },
      {
        id: "analyze",
        title: "AI bot detection analysis",
        description: `Analyzing tweets for bot-like patterns`,
        status: searchResult.search.status === "completed" ? "completed" : "pending",
      },
      {
        id: "results",
        title: "Generating results",
        description: `Compiling filtered tweet list`,
        status: searchResult.search.status === "completed" ? "completed" : "pending",
      },
    ];

    return steps;
  };

  const getProgress = (): number => {
    if (!searchResult) return 0;
    
    switch (searchResult.search.status) {
      case "pending":
        return 0;
      case "processing":
        return 50;
      case "completed":
        return 100;
      case "failed":
        return 0;
      default:
        return 0;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="rounded-full overflow-hidden w-12 h-12 flex-shrink-0">
                <img 
                  src={vajFaceGif} 
                  alt="Vaj" 
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h1 className="text-2xl font-bold" data-testid="app-title">
                  vaj auto cash
                </h1>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <AccountDropdown onUsernameChange={setSelectedUsername} />
              <Badge variant="secondary" data-testid="api-status">
                API Connected
              </Badge>
              <TwitterSettingsDialog>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-twitter-settings"
                >
                  <Settings className="w-4 h-4 mr-1" />
                  Twitter Settings
                </Button>
              </TwitterSettingsDialog>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleTheme}
                data-testid="button-theme-toggle"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Global DM Toggle */}
        <div className="mb-4 flex items-center gap-3 px-1">
          <Switch
            checked={dmsEnabled}
            onCheckedChange={(checked) => toggleDmsMutation.mutate(checked)}
          />
          <div className="flex items-center gap-2">
            <MessageSquare className={`w-4 h-4 ${dmsEnabled ? 'text-blue-400' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${dmsEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
              Enable DMs
            </span>
            {!dmsEnabled && (
              <Badge variant="secondary" className="text-xs">OFF</Badge>
            )}
          </div>
        </div>

        {/* Scheduler Panel - Schedule daily Auto Runs */}
        <SchedulerPanel />

        {/* Auto Run Panel - Single button workflow */}
        <AutoRunPanel 
          selectedUsername={selectedUsername} 
        />

        {/* Job Queue Panel - Shows scheduled and active jobs */}
        <JobQueuePanel />

        {/* TEST SECTION - Easy to remove later */}
        <div className="mb-8">
          <Collapsible open={isTestPanelOpen} onOpenChange={setIsTestPanelOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between mb-3"
                data-testid="button-toggle-test-panel"
              >
                <span className="flex items-center gap-2">
                  <span className="text-yellow-600 dark:text-yellow-400">SINGLE TWEET AUTO RESPOND</span>
                </span>
                <ChevronRight className={`w-4 h-4 transition-transform ${isTestPanelOpen ? 'rotate-90' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <TweetReplyTest />
            </CollapsibleContent>
          </Collapsible>
        </div>

        <TrendingTokens />
        <RecommendedCashtags />
        
        <SystemPromptEditor />
        <ReplyImagesManager />
        <FilteredHandlesManager />

        {isSearching && searchResult && (
          <ProcessingStatus
            steps={getProcessingSteps()}
            progress={getProgress()}
          />
        )}

        {searchResult?.search?.status === "completed" && searchResult.tweets && (
          <Results
            tweets={searchResult.tweets}
            stats={searchResult.stats}
            searchQuery={searchResult.search?.cashtag || ""}
            onExport={handleExportResults}
            onRefresh={handleRefresh}
            collectedReplyUrls={collectedReplyUrls}
            setCollectedReplyUrls={setCollectedReplyUrls}
          />
        )}

        {searchResult?.search?.status === "failed" && (
          <Card data-testid="error-message">
            <CardContent className="text-center py-8">
              <div className="text-destructive">
                <h3 className="text-lg font-medium mb-2">Analysis Failed</h3>
                <p className="text-sm text-muted-foreground">
                  There was an error processing your search. Please try again.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* RAID REPLY - Always visible */}
        <RaidReply collectedReplyUrls={collectedReplyUrls} />

        {/* SERVER LOGS - For debugging */}
        <ServerLogs />
      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <p>
                Powered by Twitter API v2 and OpenRouter AI • Rate limits:{" "}
                <span className="font-medium">Available</span>
              </p>
            </div>
            <div className="flex items-center space-x-4 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">
                Documentation
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                API Status
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                Support
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
