import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Download, RefreshCw, Heart, Repeat2, Users, ExternalLink, ArrowRight, Bot, MessageCircle, ArrowUp, Sparkles, Copy, CheckCheck, RotateCcw, Send, Zap } from "lucide-react";
import { SearchStats } from "@/lib/types";
import { Tweet } from "@shared/schema";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ResultsProps {
  tweets: Tweet[];
  stats: SearchStats;
  searchQuery: string;
  onExport?: () => void;
  onRefresh?: () => void;
  collectedReplyUrls: string[];
  setCollectedReplyUrls: (urls: string[] | ((prev: string[]) => string[])) => void;
}

export function Results({ tweets, stats, searchQuery, onExport, onRefresh, collectedReplyUrls, setCollectedReplyUrls }: ResultsProps) {
  const [tweetResponses, setTweetResponses] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingTweets, setRegeneratingTweets] = useState<Record<string, boolean>>({});
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [sendingTweets, setSendingTweets] = useState<Record<string, boolean>>({});
  const [sentTweets, setSentTweets] = useState<Record<string, boolean>>({});
  const [replyUrls, setReplyUrls] = useState<Record<string, string>>({});
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  const [isSendingDm, setIsSendingDm] = useState(false);
  const { toast } = useToast();
  const timerRefs = useRef<Record<string, NodeJS.Timeout>>({});
  const dmSentRef = useRef(false);
  const bulkSendTracking = useRef<{ expected: number; completed: number; urls: string[] }>({ expected: 0, completed: 0, urls: [] });
  
  // Deduplicate tweets by author - only show one tweet per author
  const deduplicatedTweets = tweets.reduce<Tweet[]>((acc, tweet) => {
    const authorExists = acc.some(t => t.authorHandle === tweet.authorHandle);
    if (!authorExists) {
      acc.push(tweet);
    }
    return acc;
  }, []);

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const generateTweetResponses = async () => {
    setIsGenerating(true);
    const newResponses: Record<string, string> = {};
    
    try {
      // Fetch the current system prompt from API
      let systemPrompt = '';
      try {
        const promptResponse = await fetch('/api/ai-config');
        if (promptResponse.ok) {
          const promptData = await promptResponse.json();
          systemPrompt = promptData.systemPrompt || '';
        }
      } catch (error) {
        console.error('Failed to load system prompt:', error);
      }
      
      for (let i = 0; i < deduplicatedTweets.length; i++) {
        const tweet = deduplicatedTweets[i];
        try {
          // Add delay between requests to avoid rate limiting (200ms)
          if (i > 0) {
            await delay(200);
          }
          
          const response = await fetch('/api/generate-tweet-response', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tweetText: tweet.content,
              customSystemPrompt: systemPrompt
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            newResponses[tweet.id] = data.response;
          } else {
            const errorData = await response.json().catch(() => ({}));
            if (response.status === 429) {
              newResponses[tweet.id] = "Rate limit exceeded - try again in a moment";
            } else if (response.status === 400) {
              newResponses[tweet.id] = "Invalid request - please check content";
            } else {
              newResponses[tweet.id] = `Failed to generate response (${response.status})`;
            }
          }
        } catch (error) {
          newResponses[tweet.id] = "Network error - please try again";
        }
      }
      
      setTweetResponses(newResponses);
      toast({
        title: "Responses Generated",
        description: `Generated ${Object.keys(newResponses).length} tweet responses`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate tweet responses",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateSingleTweet = async (tweet: Tweet) => {
    // Prevent multiple simultaneous regenerations of the same tweet
    if (regeneratingTweets[tweet.id]) {
      return;
    }
    
    setRegeneratingTweets(prev => ({ ...prev, [tweet.id]: true }));
    
    try {
      // Fetch the current system prompt from API
      let systemPrompt = '';
      try {
        const promptResponse = await fetch('/api/ai-config');
        if (promptResponse.ok) {
          const promptData = await promptResponse.json();
          systemPrompt = promptData.systemPrompt || '';
        }
      } catch (error) {
        console.error('Failed to load system prompt:', error);
      }
      
      const response = await fetch('/api/generate-tweet-response', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tweetText: tweet.content,
          customSystemPrompt: systemPrompt
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setTweetResponses(prev => ({ ...prev, [tweet.id]: data.response }));
        toast({
          title: "Response Regenerated",
          description: "Tweet response has been updated",
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        let errorMessage = "Failed to regenerate response";
        
        if (response.status === 429) {
          errorMessage = "Rate limit exceeded. Please wait a moment before trying again.";
        } else if (response.status === 400) {
          errorMessage = "Invalid request. Please check the tweet content.";
        } else if (response.status === 500) {
          errorMessage = "Server error. Please try again in a moment.";
        }
        
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Network error. Please check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setRegeneratingTweets(prev => ({ ...prev, [tweet.id]: false }));
    }
  };

  const copyToClipboard = async (text: string, tweetId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [tweetId]: true }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [tweetId]: false }));
      }, 2000);
      toast({
        title: "Copied!",
        description: "Response copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const sendTweetReply = async (tweet: Tweet, responseText: string) => {
    if (sendingTweets[tweet.id] || sentTweets[tweet.id]) {
      return;
    }

    setSendingTweets(prev => ({ ...prev, [tweet.id]: true }));

    try {
      const response = await apiRequest("POST", "/api/send-tweet-reply", {
        tweetId: tweet.tweetId,
        replyText: responseText,
        tweetUrl: tweet.url,
        authorHandle: tweet.authorHandle
      });

      const data = await response.json();

      console.log('✅ Received response from backend:', data);
      
      setSentTweets(prev => ({ ...prev, [tweet.id]: true }));
      
      // Store the reply URL if provided  
      if (data && typeof data === 'object' && 'replyUrl' in data && data.replyUrl) {
        console.log('📎 Setting reply URL for tweet', tweet.id, ':', data.replyUrl);
        setReplyUrls(prev => ({ ...prev, [tweet.id]: data.replyUrl as string }));
      } else {
        console.warn('⚠️ No replyUrl in response:', data);
      }
      
      toast({
        title: "Reply Sent!",
        description: "Your reply has been posted to Twitter successfully.",
      });
    } catch (error: any) {
      console.error("Error sending tweet reply:", error);
      toast({
        title: "Failed to Send Reply",
        description: error.message || "Could not send the reply. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSendingTweets(prev => ({ ...prev, [tweet.id]: false }));
    }
  };

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timerRefs.current).forEach(timer => clearInterval(timer));
    };
  }, []);

  // Send DMs with collected reply URLs
  const sendDmsWithUrls = async (urls: string[]) => {
    if (urls.length === 0) {
      return;
    }

    setIsSendingDm(true);
    
    try {
      // Prepare message with all URLs
      const message = urls.join(' ');
      
      toast({
        title: "Sending DMs...",
        description: `Sending ${urls.length} reply URLs via DM`,
      });

      // Send DM request via backend proxy
      const dmResponse = await fetch('/api/send-dm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message
        })
      });

      const dmResult = await dmResponse.json();

      if (!dmResponse.ok || !dmResult.success) {
        throw new Error(dmResult.error || `DM API error: ${dmResponse.status}`);
      }
      
      toast({
        title: "DMs Sent Successfully!",
        description: `Successfully sent ${urls.length} reply URLs via DM`,
      });

      console.log('✅ DM sent successfully:', dmResult);
      
    } catch (error: any) {
      console.error("Error sending DMs:", error);
      toast({
        title: "Failed to Send DMs",
        description: error.message || "Could not send DMs. Please check the console.",
        variant: "destructive",
      });
    } finally {
      setIsSendingDm(false);
    }
  };

  const bulkGenerateAndSend = async () => {
    // First, generate all responses
    setIsGenerating(true);
    setIsBulkSending(true);
    setCollectedReplyUrls([]);
    dmSentRef.current = false; // Reset DM sent flag for new bulk send
    bulkSendTracking.current = { expected: 0, completed: 0, urls: [] }; // Reset tracking
    const newResponses: Record<string, string> = {};
    const validResponseIds = new Set<string>(); // Track which responses are actually valid
    
    try {
      // Fetch the current system prompt from API
      let systemPrompt = '';
      try {
        const promptResponse = await fetch('/api/ai-config');
        if (promptResponse.ok) {
          const promptData = await promptResponse.json();
          systemPrompt = promptData.systemPrompt || '';
        }
      } catch (error) {
        console.error('Failed to load system prompt:', error);
      }
      
      // Generate all responses first
      for (let i = 0; i < deduplicatedTweets.length; i++) {
        const tweet = deduplicatedTweets[i];
        try {
          if (i > 0) {
            await delay(200);
          }
          
          const response = await fetch('/api/generate-tweet-response', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tweetText: tweet.content,
              customSystemPrompt: systemPrompt
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            newResponses[tweet.id] = data.response;
            validResponseIds.add(tweet.id); // Mark as valid only if response.ok
          } else {
            if (response.status === 429) {
              newResponses[tweet.id] = "Rate limit exceeded - try again in a moment";
            } else if (response.status === 400) {
              newResponses[tweet.id] = "Invalid request - please check content";
            } else {
              newResponses[tweet.id] = `Failed to generate response (${response.status})`;
            }
          }
        } catch (error) {
          newResponses[tweet.id] = "Network error - please try again";
        }
      }
      
      setTweetResponses(newResponses);
      setIsGenerating(false);
      
      toast({
        title: "Responses Generated",
        description: `Generated ${Object.keys(newResponses).length} responses. Starting bulk send...`,
      });
      
      // Now schedule sends with random delays
      const newCountdowns: Record<string, number> = {};
      const scheduledTimes: Record<string, number> = {};
      const startTime = Date.now();
      let cumulativeDelay = 0;
      let expectedSends = 0;
      
      // Count expected sends - only count tweets with valid responses
      expectedSends = validResponseIds.size;
      bulkSendTracking.current.expected = expectedSends;
      
      // If no valid responses, reset state and exit early
      if (expectedSends === 0) {
        setIsBulkSending(false);
        toast({
          title: "No Valid Responses",
          description: "All response generations failed. Cannot proceed with bulk send.",
          variant: "destructive",
        });
        return;
      }
      
      console.log(`📊 Bulk send tracking: expecting ${expectedSends} sends`);
      
      for (const tweet of deduplicatedTweets) {
        const responseText = newResponses[tweet.id];
        
        // Skip if response generation failed (check validResponseIds Set)
        if (!validResponseIds.has(tweet.id)) {
          continue;
        }
        
        // Store the scheduled send time for this tweet
        scheduledTimes[tweet.id] = cumulativeDelay;
        
        // Schedule the send at the cumulative delay time
        setTimeout(async () => {
          setSendingTweets(prev => ({ ...prev, [tweet.id]: true }));
          
          try {
            const response = await apiRequest("POST", "/api/send-tweet-reply", {
              tweetId: tweet.tweetId,
              replyText: responseText,
              tweetUrl: tweet.url,
              authorHandle: tweet.authorHandle
            });

            const data = await response.json();
            
            setSentTweets(prev => ({ ...prev, [tweet.id]: true }));
            
            let replyUrl = '';
            if (data && typeof data === 'object' && 'replyUrl' in data && data.replyUrl) {
              replyUrl = data.replyUrl as string;
              setReplyUrls(prev => ({ ...prev, [tweet.id]: replyUrl }));
              setCollectedReplyUrls(prev => [...prev, replyUrl]);
              
              // Send this individual URL via DM with 30-60 second delay
              const dmDelay = Math.floor(Math.random() * (60 - 30 + 1)) + 30;
              console.log(`📬 Scheduling DM for URL in ${dmDelay} seconds:`, replyUrl);
              
              setTimeout(async () => {
                try {
                  const dmResponse = await fetch('/api/send-dm', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      message: replyUrl
                    })
                  });

                  const dmResult = await dmResponse.json();

                  if (dmResponse.ok && dmResult.success) {
                    console.log('✅ DM sent successfully for URL:', replyUrl);
                  } else {
                    console.error('❌ DM send failed:', dmResult.error || 'Unknown error');
                  }
                } catch (error) {
                  console.error('❌ Error sending DM:', error);
                }
              }, dmDelay * 1000);
            }
            
            // Clear countdown for this tweet
            setCountdowns(prev => {
              const updated = { ...prev };
              delete updated[tweet.id];
              return updated;
            });
            
            // Track completion
            bulkSendTracking.current.completed++;
            console.log(`✅ Send completed (${bulkSendTracking.current.completed}/${bulkSendTracking.current.expected})`);
            
            // Check if all sends are complete
            if (bulkSendTracking.current.completed === bulkSendTracking.current.expected) {
              console.log('🎉 All bulk sends complete');
              setIsBulkSending(false);
            }
          } catch (error: any) {
            console.error("Error sending tweet reply:", error);
            
            // Track completion even on error
            bulkSendTracking.current.completed++;
            console.log(`❌ Send failed (${bulkSendTracking.current.completed}/${bulkSendTracking.current.expected})`);
            
            // Check if all sends are complete (including failures)
            if (bulkSendTracking.current.completed === bulkSendTracking.current.expected) {
              console.log('🎉 All bulk sends complete (with some failures)');
              setIsBulkSending(false);
            }
          } finally {
            setSendingTweets(prev => ({ ...prev, [tweet.id]: false }));
          }
        }, cumulativeDelay * 1000);
        
        // Add random delay for the NEXT tweet (47-88 seconds between each send)
        // First tweet sends immediately (cumulativeDelay starts at 0)
        const delayToNext = Math.floor(Math.random() * (88 - 47 + 1)) + 47;
        cumulativeDelay += delayToNext;
      }
      
      // Calculate initial countdowns based on time remaining
      const initialCountdowns: Record<string, number> = {};
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      for (const [tweetId, scheduledTime] of Object.entries(scheduledTimes)) {
        const remaining = Math.max(0, scheduledTime - elapsed);
        initialCountdowns[tweetId] = remaining;
      }
      
      setCountdowns(initialCountdowns);
      
      // Update countdown timer based on elapsed time (more accurate than simple decrement)
      const countdownInterval = setInterval(() => {
        const currentElapsed = Math.floor((Date.now() - startTime) / 1000);
        
        setCountdowns(prev => {
          const updated: Record<string, number> = {};
          let hasCountdowns = false;
          
          for (const [tweetId, scheduledTime] of Object.entries(scheduledTimes)) {
            const remaining = scheduledTime - currentElapsed;
            if (remaining > 0 && prev[tweetId] !== undefined) {
              updated[tweetId] = remaining;
              hasCountdowns = true;
            }
          }
          
          // Stop interval when all countdowns are done (DM sending is now handled by completion tracking)
          if (!hasCountdowns) {
            clearInterval(countdownInterval);
          }
          
          return updated;
        });
      }, 1000);
      
      timerRefs.current['bulk'] = countdownInterval;
      
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to bulk generate and send",
        variant: "destructive",
      });
      setIsGenerating(false);
      setIsBulkSending(false);
    }
  };

  if (deduplicatedTweets.length === 0) {
    return (
      <Card data-testid="results-empty">
        <CardContent className="text-center py-12">
          <div className="text-muted-foreground">
            <Bot className="w-12 h-12 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No qualifying tweets found</h3>
            <p className="text-sm">
              Try adjusting your search parameters or follower count range to find more results.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="results-container">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold">Filtered Results</CardTitle>
            <p className="text-sm text-muted-foreground">
              <span data-testid="results-count">{deduplicatedTweets.length}</span> results found for{" "}
              <span className="font-medium text-foreground" data-testid="search-query">
                ${searchQuery}
              </span>
              {deduplicatedTweets.some(t => t.isParentTweet) && (
                <span className="block mt-1 text-xs">
                  Includes qualifying parent tweets via replies
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="default"
              size="sm"
              onClick={generateTweetResponses}
              disabled={isGenerating || isBulkSending}
              data-testid="button-generate-responses"
            >
              {isGenerating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span className="ml-1">
                {isGenerating ? "Generating..." : "GENERATE TWEET RESPONSES"}
              </span>
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={bulkGenerateAndSend}
              disabled={isGenerating || isBulkSending}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              data-testid="button-bulk-generate-send"
            >
              {isGenerating || isBulkSending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              <span className="ml-1">
                {isBulkSending ? "Processing..." : "BULK GENERATE AND SEND"}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              data-testid="button-export"
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Collected Reply URLs */}
        {collectedReplyUrls.length > 0 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-green-700 dark:text-green-300">
                COLLECTED REPLY TWEET URLS ({collectedReplyUrls.length})
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const urlsText = collectedReplyUrls.join('\n');
                  navigator.clipboard.writeText(urlsText);
                  toast({
                    title: "URLs Copied!",
                    description: `Copied ${collectedReplyUrls.length} reply URLs to clipboard`,
                  });
                }}
                className="h-7 text-xs"
                data-testid="button-copy-all-urls"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy All
              </Button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {collectedReplyUrls.map((url, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-2 bg-white/50 dark:bg-black/20 rounded border border-green-200 dark:border-green-700"
                  data-testid={`collected-url-${index}`}
                >
                  <span className="text-xs font-mono text-muted-foreground">{index + 1}.</span>
                  <code className="flex-1 text-xs break-all">{url}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(url, "_blank")}
                    className="h-6 px-2 shrink-0"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
            
            {/* DM Sending Status */}
            {isSendingDm && (
              <div className="mt-3 flex items-center justify-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-700">
                <div className="flex items-center space-x-2">
                  <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Sending DMs with {collectedReplyUrls.length} URLs...
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Filter Summary */}
        <div className="mb-6 p-4 bg-secondary/50 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-4">
              <span className="text-muted-foreground">Original:</span>
              <span className="font-medium" data-testid="stats-total">
                {stats.total} tweets
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center space-x-4">
              <span className="text-muted-foreground">After follower filter:</span>
              <span className="font-medium" data-testid="stats-after-filter">
                {stats.total} tweets
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center space-x-4">
              <span className="text-muted-foreground">After bot detection:</span>
              <span className="font-medium text-primary" data-testid="stats-final">
                {stats.filtered} tweets
              </span>
            </div>
          </div>
        </div>

        {/* Results List */}
        <div className="space-y-4">
          {deduplicatedTweets.map((tweet) => (
            <div
              key={tweet.id}
              className={`border rounded-lg p-4 hover:bg-secondary/30 transition-colors ${
                tweet.isParentTweet 
                  ? "border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-900/10" 
                  : "border-border"
              }`}
              data-testid={`tweet-${tweet.tweetId}`}
            >
              <div className="flex items-start space-x-4">
                <Avatar className="flex-shrink-0">
                  <AvatarImage src={tweet.authorAvatar || undefined} alt={tweet.authorName} />
                  <AvatarFallback>
                    {tweet.authorName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-grow min-w-0">
                  {/* Parent Tweet Label */}
                  {tweet.isParentTweet && (
                    <div className="mb-2 flex items-center space-x-2 text-blue-600 dark:text-blue-400">
                      <ArrowUp className="w-4 h-4" />
                      <span className="text-sm font-medium">Parent Tweet</span>
                      <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 dark:border-blue-600 dark:text-blue-400">
                        Included via qualifying reply
                      </Badge>
                    </div>
                  )}
                  
                  {/* User Info */}
                  <div className="flex items-center space-x-2 mb-2">
                    <span 
                      className="font-medium truncate" 
                      data-testid={`tweet-author-name-${tweet.tweetId}`}
                    >
                      {tweet.authorName}
                    </span>
                    <span 
                      className="text-muted-foreground text-sm"
                      data-testid={`tweet-author-handle-${tweet.tweetId}`}
                    >
                      @{tweet.authorHandle}
                    </span>
                    <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                      <Users className="w-3 h-3" />
                      <span data-testid={`tweet-followers-${tweet.tweetId}`}>
                        {formatNumber(tweet.authorFollowers)}
                      </span>
                    </div>
                    {tweet.sourceHashtag && (
                      <div className="flex items-center space-x-1 text-xs">
                        <span className="bg-primary/10 text-primary px-2 py-1 rounded-full font-medium" data-testid={`tweet-source-${tweet.tweetId}`}>
                          ${tweet.sourceHashtag}
                        </span>
                      </div>
                    )}
                    <span 
                      className="text-xs text-muted-foreground"
                      data-testid={`tweet-timestamp-${tweet.tweetId}`}
                    >
                      {formatTimeAgo(new Date(tweet.publishedAt))}
                    </span>
                  </div>

                  {/* Tweet Content */}
                  <div className="mb-3">
                    <p 
                      className="text-sm leading-relaxed"
                      data-testid={`tweet-content-${tweet.tweetId}`}
                    >
                      {tweet.content}
                    </p>
                  </div>

                  {/* Parent Tweet Link - Show when reply meets criteria */}
                  {tweet.meetsReplyCriteria && tweet.parentTweetUrl && (
                    <div className="mb-3 p-3 bg-secondary/30 rounded-lg border border-secondary">
                      <div className="flex items-start space-x-2">
                        <ArrowRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                        <div className="flex-grow min-w-0">
                          <p className="text-xs text-muted-foreground mb-1">
                            Replying to a qualifying tweet:
                          </p>
                          <p className="text-sm text-foreground mb-2 line-clamp-2">
                            {tweet.parentTweetContent || "View original tweet"}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                              <span>by {tweet.parentTweetAuthor}</span>
                              {tweet.parentTweetFollowers && (
                                <div className="flex items-center space-x-1">
                                  <Users className="w-3 h-3" />
                                  <span>{formatNumber(tweet.parentTweetFollowers)}</span>
                                </div>
                              )}
                              {tweet.parentTweetAge !== null && (
                                <span>{tweet.parentTweetAge}m ago</span>
                              )}
                            </div>
                            <a
                              href={tweet.parentTweetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 text-primary hover:text-primary/80 transition-colors text-xs font-medium"
                              data-testid={`parent-tweet-link-${tweet.tweetId}`}
                            >
                              <span>View Original</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tweet Metadata */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="flex items-center space-x-1">
                        <Bot className="w-3 h-3" />
                        <span>Human verified</span>
                      </Badge>
                      <div className="flex items-center space-x-1">
                        <Heart className="w-3 h-3" />
                        <span data-testid={`tweet-likes-${tweet.tweetId}`}>
                          {tweet.likes}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Repeat2 className="w-3 h-3" />
                        <span data-testid={`tweet-retweets-${tweet.tweetId}`}>
                          {tweet.retweets}
                        </span>
                      </div>
                    </div>
                    <a
                      href={tweet.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1 text-primary hover:text-primary/80 transition-colors text-sm font-medium"
                      data-testid={`tweet-link-${tweet.tweetId}`}
                    >
                      <span>View Tweet</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  {/* AI Response Box */}
                  {tweetResponses[tweet.id] && (
                    <div className="mt-4 p-3 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg border border-purple-200 dark:border-purple-700">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                          <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                            AI Generated Response
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => regenerateSingleTweet(tweet)}
                            disabled={regeneratingTweets[tweet.id]}
                            className="h-6 px-2"
                            data-testid={`button-redo-${tweet.tweetId}`}
                          >
                            {regeneratingTweets[tweet.id] ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(tweetResponses[tweet.id], tweet.id)}
                            className="h-6 px-2"
                            data-testid={`button-copy-${tweet.tweetId}`}
                          >
                            {copiedStates[tweet.id] ? (
                              <CheckCheck className="w-3 h-3 text-green-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </Button>
                          <Button
                            variant={sentTweets[tweet.id] ? "outline" : "default"}
                            size="sm"
                            onClick={() => sendTweetReply(tweet, tweetResponses[tweet.id])}
                            disabled={sendingTweets[tweet.id] || sentTweets[tweet.id] || !tweetResponses[tweet.id]}
                            className="h-6 px-2"
                            data-testid={`button-send-${tweet.tweetId}`}
                          >
                            {sendingTweets[tweet.id] ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : sentTweets[tweet.id] ? (
                              <CheckCheck className="w-3 h-3 text-green-600" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                            <span className="ml-1">
                              {sendingTweets[tweet.id] ? "Sending..." : sentTweets[tweet.id] ? "Sent" : "SEND"}
                            </span>
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        value={tweetResponses[tweet.id]}
                        readOnly
                        className="min-h-[60px] text-sm bg-white/50 dark:bg-black/20 border-purple-200 dark:border-purple-700 resize-none"
                        data-testid={`response-text-${tweet.tweetId}`}
                      />
                      
                      {/* Countdown Timer */}
                      {countdowns[tweet.id] !== undefined && countdowns[tweet.id] > 0 && (
                        <div className="mt-3 flex items-center justify-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-700">
                          <div className="flex items-center space-x-2">
                            <RefreshCw className="w-4 h-4 text-yellow-600 dark:text-yellow-400 animate-spin" />
                            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                              Sending in {countdowns[tweet.id]} seconds
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* Reply Link */}
                      {sentTweets[tweet.id] && replyUrls[tweet.id] && (
                        <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-700 space-y-2">
                          <div className="text-xs text-purple-700 dark:text-purple-300 font-medium">
                            Reply URL:
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 px-2 py-1.5 bg-white/50 dark:bg-black/30 rounded border border-purple-200 dark:border-purple-700 text-xs break-all" data-testid={`reply-url-text-${tweet.tweetId}`}>
                              {replyUrls[tweet.id]}
                            </code>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(replyUrls[tweet.id], `url-${tweet.id}`)}
                              className="h-7 px-2 shrink-0"
                              data-testid={`button-copy-url-${tweet.tweetId}`}
                            >
                              {copiedStates[`url-${tweet.id}`] ? (
                                <CheckCheck className="w-3 h-3 text-green-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span className="ml-1 text-xs">Copy</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(replyUrls[tweet.id], "_blank")}
                              className="h-7 px-2 shrink-0"
                              data-testid={`button-view-reply-${tweet.tweetId}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span className="ml-1 text-xs">View</span>
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
