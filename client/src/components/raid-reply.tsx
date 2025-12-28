import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Send, Loader2, Copy, Check, Timer, ExternalLink, Clipboard } from "lucide-react";

interface RaidReplyProps {
  collectedReplyUrls: string[];
}

interface TweetData {
  tweetId: string;
  url: string;
  authorHandle: string;
}

interface BatchJob {
  tweets: TweetData[];
  username: string;
}

export function RaidReply({ collectedReplyUrls }: RaidReplyProps) {
  const [manualUrls, setManualUrls] = useState("");
  const [selectedUsername, setSelectedUsername] = useState("");
  const [availableUsernames, setAvailableUsernames] = useState<string[]>([]);
  const [processingCount, setProcessingCount] = useState(0);
  const [tweetResponses, setTweetResponses] = useState<Record<string, string>>({});
  const [sendingTweets, setSendingTweets] = useState<Record<string, boolean>>({});
  const [sentTweets, setSentTweets] = useState<Record<string, boolean>>({});
  const [sentReplyUrls, setSentReplyUrls] = useState<Record<string, string>>({});
  const [tweetUsernames, setTweetUsernames] = useState<Record<string, string>>({});
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  const [autoLikeEnabled, setAutoLikeEnabled] = useState(() => {
    const stored = localStorage.getItem('raidReplyAutoLike');
    return stored ? stored === 'true' : false; // Default: false (disabled)
  });
  const timerRefs = useRef<Record<string, NodeJS.Timeout>>({});
  const batchQueue = useRef<BatchJob[]>([]);
  const isProcessingBatch = useRef(false);
  const { toast } = useToast();

  // Fetch available usernames
  useEffect(() => {
    const fetchUsernames = async () => {
      try {
        const response = await fetch('/api/twitter-usernames');
        if (response.ok) {
          const data = await response.json();
          // API returns array of {username, isActive, hasCookie} objects
          const usernames = data.map((u: any) => u.username);
          setAvailableUsernames(usernames);
          
          // Get currently selected username from localStorage
          const storedUsername = localStorage.getItem('selectedTwitterUsername');
          if (storedUsername && usernames.includes(storedUsername)) {
            setSelectedUsername(storedUsername);
          } else if (usernames.length > 0) {
            // Default to first non-active username if available
            const activeUsername = localStorage.getItem('selectedTwitterUsername');
            const otherUsername = usernames.find((u: string) => u !== activeUsername);
            setSelectedUsername(otherUsername || usernames[0]);
          }
        }
      } catch (error) {
        console.error('Failed to fetch usernames:', error);
      }
    };

    fetchUsernames();
  }, []);

  // Persist auto-like preference to localStorage
  useEffect(() => {
    localStorage.setItem('raidReplyAutoLike', autoLikeEnabled.toString());
  }, [autoLikeEnabled]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timerRefs.current).forEach(timer => clearInterval(timer));
    };
  }, []);

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const extractTweetIdFromUrl = (url: string): string | null => {
    const match = url.match(/status\/(\d+)/);
    return match ? match[1] : null;
  };

  const extractHandleFromUrl = (url: string): string | null => {
    // Support both twitter.com and x.com URLs
    const match = url.match(/(?:twitter\.com|x\.com)\/([^\/]+)\//);
    return match ? match[1] : null;
  };

  const parseUrls = (urlText: string): TweetData[] => {
    // Extract all Twitter/X URLs intelligently regardless of separators (newlines, spaces, commas, etc.)
    const urlPattern = /https?:\/\/(?:twitter\.com|x\.com)\/[^\s,]+\/status\/\d+(?:\?[^\s,]*)?/gi;
    const matches = urlText.match(urlPattern) || [];
    
    const tweetData: TweetData[] = [];
    const seenIds = new Set<string>();

    for (const url of matches) {
      const tweetId = extractTweetIdFromUrl(url);
      const handle = extractHandleFromUrl(url);
      
      // Deduplicate by tweet ID
      if (tweetId && handle && !seenIds.has(tweetId)) {
        seenIds.add(tweetId);
        tweetData.push({
          tweetId,
          url,
          authorHandle: handle
        });
      }
    }

    return tweetData;
  };

  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [id]: false }));
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

  const processQueue = async () => {
    if (isProcessingBatch.current || batchQueue.current.length === 0) {
      return;
    }

    isProcessingBatch.current = true;
    const batch = batchQueue.current.shift()!;
    
    // Update count after removing from queue
    setProcessingCount(batchQueue.current.length + 1);

    await processAndSendReplies(batch.tweets, batch.username);

    isProcessingBatch.current = false;
    
    // Process next batch if any
    if (batchQueue.current.length > 0) {
      processQueue();
    } else {
      setProcessingCount(0);
    }
  };

  const processAndSendReplies = async (tweets: TweetData[], username: string) => {
    if (!username) {
      toast({
        title: "Error",
        description: "Please select a username to reply from",
        variant: "destructive",
      });
      return;
    }

    const newResponses: Record<string, string> = {};
    const validTweetIds = new Set<string>();

    // Step 1: Generate all responses (FRESH responses for each batch)
    toast({
      title: "Processing Batch",
      description: `Generating fresh AI responses for ${tweets.length} tweets from @${username}...`,
    });

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

      for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i];
        const compositeKey = `${tweet.tweetId}-${username}`;
        
        try {
          if (i > 0) {
            await delay(200);
          }

          // Fetch the actual tweet content from backend
          let tweetContent = `Reply to tweet from @${tweet.authorHandle}`;
          try {
            const contentResponse = await fetch(`/api/tweet-content/${tweet.tweetId}`);
            if (contentResponse.ok) {
              const contentData = await contentResponse.json();
              tweetContent = contentData.text;
            }
          } catch (fetchError) {
            console.warn('Failed to fetch tweet content, using generic prompt:', fetchError);
          }

          const response = await fetch('/api/generate-tweet-response', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tweetText: tweetContent,
              customSystemPrompt: systemPrompt
            })
          });

          if (response.ok) {
            const data = await response.json();
            newResponses[compositeKey] = data.response;
            validTweetIds.add(compositeKey);
          } else {
            if (response.status === 429) {
              newResponses[compositeKey] = "Rate limit exceeded - try again in a moment";
            } else {
              newResponses[compositeKey] = `Failed to generate response (${response.status})`;
            }
          }
        } catch (error) {
          newResponses[compositeKey] = "Network error - please try again";
        }
      }

      setTweetResponses(prev => ({ ...prev, ...newResponses }));

      if (validTweetIds.size === 0) {
        toast({
          title: "No Valid Responses",
          description: "All response generations failed. Cannot proceed.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Responses Generated",
        description: `Generated ${validTweetIds.size} responses. Starting timed sends...`,
      });

      // Step 2: Schedule sends with random delays (47-88 seconds)
      let cumulativeDelay = 0;
      const sendPromises: Promise<void>[] = [];

      for (const tweet of tweets) {
        const compositeKey = `${tweet.tweetId}-${username}`;
        const responseText = newResponses[compositeKey];

        // Skip if response generation failed
        if (!validTweetIds.has(compositeKey)) {
          continue;
        }

        // Initialize countdown for this tweet+username combination
        setCountdowns(prev => ({ ...prev, [compositeKey]: cumulativeDelay }));

        // Start countdown timer
        const startTime = Date.now();
        const scheduledTime = cumulativeDelay * 1000;

        timerRefs.current[compositeKey] = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const remaining = Math.max(0, Math.ceil((scheduledTime - elapsed) / 1000));
          
          setCountdowns(prev => ({ ...prev, [compositeKey]: remaining }));
          
          if (remaining === 0) {
            clearInterval(timerRefs.current[compositeKey]);
          }
        }, 1000);

        // Wrap the send in a Promise and collect it
        const sendPromise = new Promise<void>((resolve) => {
          setTimeout(async () => {
            setSendingTweets(prev => ({ ...prev, [compositeKey]: true }));
            setTweetUsernames(prev => ({ ...prev, [compositeKey]: username }));

            try {
              const response = await apiRequest("POST", "/api/send-raid-reply", {
                tweetId: tweet.tweetId,
                replyText: responseText,
                tweetUrl: tweet.url,
                authorHandle: tweet.authorHandle,
                username: username
              });

              const data = await response.json();

              setSentTweets(prev => ({ ...prev, [compositeKey]: true }));
              
              // Store the reply URL if provided
              if (data && typeof data === 'object' && 'replyUrl' in data && data.replyUrl) {
                setSentReplyUrls(prev => ({ ...prev, [compositeKey]: data.replyUrl as string }));
              }

              // Clear countdown
              setCountdowns(prev => {
                const updated = { ...prev };
                delete updated[compositeKey];
                return updated;
              });

              // Schedule auto-like of the original tweet 5-10 seconds later (if enabled)
              if (autoLikeEnabled) {
                const likeDelay = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
                console.log(`⏱️ Auto-like scheduled for ${tweet.url} in ${likeDelay} seconds...`);
                setTimeout(async () => {
                  try {
                    console.log(`💗 Starting auto-like for ${tweet.url} using username: ${username}`);
                    const likeResponse = await fetch('/api/like-tweet', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        tweetUrl: tweet.url,
                        username: username
                      })
                    });

                    if (!likeResponse.ok) {
                      const errorData = await likeResponse.json();
                      throw new Error(errorData.error || `HTTP ${likeResponse.status}`);
                    }

                    const likeData = await likeResponse.json();
                    console.log(`✅ Auto-liked tweet successfully after ${likeDelay}s: ${tweet.url}`, likeData);
                  } catch (error: any) {
                    console.error(`❌ Failed to auto-like tweet ${tweet.url}:`, error.message || error);
                  }
                }, likeDelay * 1000);
              }

              toast({
                title: "Reply Sent!",
                description: `Reply posted from @${username}`,
              });
            } catch (error: any) {
              console.error("Error sending raid reply:", error);
              toast({
                title: "Failed to Send Reply",
                description: error.message || "Could not send the reply. Please try again.",
                variant: "destructive",
              });
            } finally {
              setSendingTweets(prev => ({ ...prev, [compositeKey]: false }));
              resolve(); // Resolve after everything is done
            }
          }, cumulativeDelay * 1000);
        });

        sendPromises.push(sendPromise);

        // Add random delay for the NEXT tweet (47-88 seconds between each send)
        const delayToNext = Math.floor(Math.random() * (88 - 47 + 1)) + 47;
        cumulativeDelay += delayToNext;
      }

      // Wait for ALL sends to complete before returning
      await Promise.all(sendPromises);

    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to process raid replies",
        variant: "destructive",
      });
    } finally {
      // Update processing count to reflect remaining queue + currently processing
      setProcessingCount(batchQueue.current.length + (isProcessingBatch.current ? 1 : 0));
    }
  };

  const handleReplyToRaids = () => {
    if (!selectedUsername) {
      toast({
        title: "Error",
        description: "Please select a username to reply from",
        variant: "destructive",
      });
      return;
    }

    if (collectedReplyUrls.length === 0) {
      toast({
        title: "No URLs",
        description: "No collected reply URLs to process",
        variant: "destructive",
      });
      return;
    }

    // Parse and shuffle URLs (random order for each batch)
    const tweets = parseUrls(collectedReplyUrls.join('\n'));
    const shuffledTweets = shuffleArray(tweets);

    // Add to queue
    batchQueue.current.push({ tweets: shuffledTweets, username: selectedUsername });
    setProcessingCount(batchQueue.current.length);

    toast({
      title: "Batch Queued",
      description: `Added ${shuffledTweets.length} tweets from @${selectedUsername} to queue. Position: ${batchQueue.current.length}`,
    });

    // Start processing if not already running
    processQueue();
  };

  const handleReplyToListed = () => {
    if (!selectedUsername) {
      toast({
        title: "Error",
        description: "Please select a username to reply from",
        variant: "destructive",
      });
      return;
    }

    if (!manualUrls.trim()) {
      toast({
        title: "No URLs",
        description: "Please enter tweet URLs to reply to",
        variant: "destructive",
      });
      return;
    }

    // Parse URLs (shuffle for random order each batch)
    const tweets = parseUrls(manualUrls);

    if (tweets.length === 0) {
      toast({
        title: "Invalid URLs",
        description: "Could not parse any valid tweet URLs from the list",
        variant: "destructive",
      });
      return;
    }

    const shuffledTweets = shuffleArray(tweets);

    // Add to queue
    batchQueue.current.push({ tweets: shuffledTweets, username: selectedUsername });
    setProcessingCount(batchQueue.current.length);

    toast({
      title: "Batch Queued",
      description: `Added ${shuffledTweets.length} tweets from @${selectedUsername} to queue. Position: ${batchQueue.current.length}`,
    });

    // Start processing if not already running
    processQueue();
  };

  const handlePasteFromClipboard = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) {
        // Append with spaces before and after
        setManualUrls(prev => {
          if (prev.trim()) {
            return prev + ' ' + clipboardText + ' ';
          } else {
            return clipboardText + ' ';
          }
        });
        toast({
          title: "Pasted!",
          description: "Clipboard content added to manual URLs",
        });
      } else {
        toast({
          title: "Empty Clipboard",
          description: "No content found in clipboard",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to read from clipboard. Please paste manually.",
        variant: "destructive",
      });
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const allTweets = [
    ...parseUrls(collectedReplyUrls.join('\n')),
    ...parseUrls(manualUrls)
  ];

  return (
    <div className="space-y-6 mt-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>RAID REPLY</span>
            <Badge variant="outline">{availableUsernames.length} Accounts</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Username Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Reply From Account</label>
            <Select value={selectedUsername} onValueChange={setSelectedUsername}>
              <SelectTrigger data-testid="select-raid-username">
                <SelectValue placeholder="Select username to reply from" />
              </SelectTrigger>
              <SelectContent>
                {availableUsernames.map(username => (
                  <SelectItem key={username} value={username} data-testid={`option-username-${username}`}>
                    @{username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Auto-Like Toggle */}
          <div className="flex items-center space-x-2 p-3 rounded-lg bg-muted/30">
            <Switch
              id="auto-like-toggle"
              checked={autoLikeEnabled}
              onCheckedChange={setAutoLikeEnabled}
              data-testid="switch-auto-like"
            />
            <Label htmlFor="auto-like-toggle" className="cursor-pointer">
              Auto-like tweets after replying <span className="font-bold">(currently broken - do not switch on)</span>
            </Label>
            <Badge variant={autoLikeEnabled ? "default" : "secondary"} className="ml-auto">
              {autoLikeEnabled ? "ON" : "OFF"}
            </Badge>
          </div>

          {/* Collected Reply URLs Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium">
                  COLLECTED REPLY TWEET URLS ({collectedReplyUrls.length})
                </label>
                {processingCount > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {processingCount} Batches Processing
                  </Badge>
                )}
              </div>
              <Button
                onClick={handleReplyToRaids}
                disabled={collectedReplyUrls.length === 0 || !selectedUsername}
                size="sm"
                data-testid="button-reply-to-raids"
              >
                <Send className="w-4 h-4 mr-2" />
                REPLY TO MY OWN RAIDS
              </Button>
            </div>
            {collectedReplyUrls.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 max-h-48 overflow-y-auto">
                {collectedReplyUrls.map((url, index) => (
                  <div key={index} className="text-xs font-mono py-1 break-all">
                    {url}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual Tweet URL List Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">
                  MANUAL TWEET URL LIST
                </label>
                <Button
                  onClick={handlePasteFromClipboard}
                  size="sm"
                  variant="outline"
                  data-testid="button-paste-clipboard"
                >
                  <Clipboard className="w-4 h-4 mr-2" />
                  PASTE
                </Button>
              </div>
              <Button
                onClick={handleReplyToListed}
                disabled={!manualUrls.trim() || !selectedUsername}
                size="sm"
                data-testid="button-reply-to-listed"
              >
                <Send className="w-4 h-4 mr-2" />
                REPLY TO LISTED TWEETS
              </Button>
            </div>
            <Textarea
              placeholder="Paste tweet URLs here"
              value={manualUrls}
              onChange={(e) => setManualUrls(e.target.value)}
              className="min-h-32 font-mono text-xs"
              data-testid="textarea-manual-urls"
            />
          </div>

          {/* Response Preview Section */}
          {Object.keys(tweetResponses).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Generated Responses ({Object.keys(tweetResponses).length} total)</h3>
              <div className="space-y-3">
                {Object.entries(tweetResponses).map(([compositeKey, response]) => {
                  const isSending = sendingTweets[compositeKey];
                  const isSent = sentTweets[compositeKey];
                  const sentReplyUrl = sentReplyUrls[compositeKey];
                  const countdown = countdowns[compositeKey];
                  const isCopied = copiedStates[compositeKey];
                  const username = tweetUsernames[compositeKey];
                  
                  // Extract tweetId from compositeKey (format: tweetId-username)
                  const [tweetId] = compositeKey.split('-');
                  const tweet = allTweets.find(t => t.tweetId === tweetId);
                  if (!tweet) return null;

                  return (
                    <Card key={compositeKey} className="bg-muted/30">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-muted-foreground font-mono break-all flex-1">
                                {tweet.url}
                              </p>
                              {username && (
                                <Badge variant="outline" className="text-xs" data-testid={`badge-username-${compositeKey}`}>
                                  @{username}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm">{response}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {countdown !== undefined && countdown > 0 && (
                              <Badge variant="secondary" className="gap-1">
                                <Timer className="w-3 h-3" />
                                {formatTime(countdown)}
                              </Badge>
                            )}
                            {isSending && (
                              <Badge variant="secondary">
                                <Loader2 className="w-3 h-3 animate-spin" />
                              </Badge>
                            )}
                            {isSent && (
                              <Badge variant="default">
                                <Check className="w-3 h-3" />
                              </Badge>
                            )}
                            {sentReplyUrl && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => window.open(sentReplyUrl, '_blank')}
                                data-testid={`button-view-${compositeKey}`}
                                title="View sent tweet"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(response, compositeKey)}
                              data-testid={`button-copy-${compositeKey}`}
                            >
                              {isCopied ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
