import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { getStorage } from "./storage";
import { TwitterService } from "./services/twitter";
import { OpenRouterService } from "./services/openrouter";
import { DexScreenerService } from "./services/dexscreener";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient, replitStorageClient } from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";
import { searchParamsSchema, insertRecommendedCashtagSchema } from "@shared/schema";
import { z } from "zod";
import { jobManager } from "./services/jobManager";
import { sseManager } from "./services/sseManager";
import { replyQueue } from "./services/replyQueue";
import { searchQueue } from "./services/searchQueue";
import { autoRunService } from "./services/autoRun";
import { schedulerService } from "./services/scheduler";
import { cacheService, CACHE_KEYS, CACHE_TTL } from "./services/cache";
import { rateLimiter } from "./services/rateLimiter";
// Note: @replit/object-storage Client is used via replitStorageClient imported from objectStorage.ts
import { normalizeImageUrl, buildFullPublicUrl } from "./utils/imageUrl";

export async function registerRoutes(app: Express): Promise<Server> {
  // Safely initialize OpenRouterService - may be null if API key not configured
  let openRouterService: OpenRouterService | null = null;
  try {
    if (process.env.OPENROUTER_API_KEY) {
      openRouterService = new OpenRouterService();
    }
  } catch (e) {
    console.warn('OpenRouterService initialization failed - AI features will be disabled');
  }
  const dexScreenerService = new DexScreenerService();

  // SSE endpoint for real-time updates
  app.get("/api/events", (req, res) => {
    const clientId = randomUUID();
    sseManager.addClient(clientId, res);
  });

  // Get current job manager state
  app.get("/api/jobs", (req, res) => {
    res.json(jobManager.getFullState());
  });

  // Get specific job
  app.get("/api/jobs/:id", (req, res) => {
    const job = jobManager.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json(job);
  });

  // Cancel a job
  app.delete("/api/jobs/:id", (req, res) => {
    const job = jobManager.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    jobManager.cancelJob(req.params.id);
    res.json({ success: true, message: "Job cancelled" });
  });

  // Cancel all pending/scheduled jobs
  app.delete("/api/jobs", (req, res) => {
    try {
      // Cancel all pending jobs in job manager
      const cancelled = jobManager.cancelAllPending();

      // NOTE: Active browser sessions will complete their current operation
      // The queue system will respect the cancelled status for future jobs

      res.json({ success: true, cancelled, message: `Cancelled ${cancelled} pending jobs` });
    } catch (error: any) {
      console.error('Error cancelling jobs:', error);
      res.status(500).json({ success: false, error: error.message || 'Unknown error' });
    }
  });

  // Auto-run endpoints
  app.get("/api/auto-run/state", (req, res) => {
    res.json(autoRunService.getState());
  });

  app.post("/api/auto-run/start", async (req, res) => {
    try {
      const {
        minTweetsPerRun = 22,
        maxTweetsPerRun = 44,
        sendDm = true
      } = req.body;

      // Randomize maxTweets per run between min and max
      const maxTweets = Math.floor(Math.random() * (maxTweetsPerRun - minTweetsPerRun + 1)) + minTweetsPerRun;

      const storage = await getStorage();
      
      // Auto-fetch cashtags from pinned tokens (same as scheduler)
      const [recommendedCashtags, pinnedTrendingTokens, allTwitterSettings] = await Promise.all([
        storage.getRecommendedCashtags(),
        storage.getPinnedTrendingTokens(),
        storage.getAllTwitterSettings(),
      ]);

      // Also fetch trending tokens for fallback
      let trendingTokens: { symbol: string }[] = [];
      try {
        const trendingResponse = await fetch(`http://localhost:${process.env.PORT || 5000}/api/trending?timeframe=24h`);
        if (trendingResponse.ok) {
          const trendingData = await trendingResponse.json();
          trendingTokens = trendingData.tokens || [];
        }
      } catch (e) {
        console.log("Could not fetch trending tokens for auto-run");
      }

      const MAX_CASHTAGS = 8;
      
      // Prioritize pinned cashtags (same logic as scheduler)
      const pinnedRecommended = recommendedCashtags
        .filter((c: { isPinned: boolean | null }) => c.isPinned)
        .map((c: { symbol: string }) => c.symbol);
      const unpinnedRecommended = recommendedCashtags
        .filter((c: { isPinned: boolean | null }) => !c.isPinned)
        .map((c: { symbol: string }) => c.symbol);
      
      const pinnedTrendingSymbols = new Set(
        pinnedTrendingTokens.map((t: { symbol: string }) => t.symbol.toUpperCase())
      );
      const trendingSymbols: string[] = trendingTokens
        .slice(0, 15)
        .map((t: { symbol: string }) => t.symbol);
      const pinnedTrending = trendingSymbols.filter((s: string) => pinnedTrendingSymbols.has(s.toUpperCase()));
      const unpinnedTrending = trendingSymbols.filter((s: string) => !pinnedTrendingSymbols.has(s.toUpperCase()));
      
      const uniqueCashtags: string[] = [];
      const addUnique = (tag: string) => {
        const upper = tag.toUpperCase();
        if (!uniqueCashtags.some(t => t.toUpperCase() === upper)) {
          uniqueCashtags.push(tag);
        }
      };
      
      // Add pinned first (priority)
      for (const tag of pinnedRecommended) addUnique(tag);
      for (const tag of pinnedTrending) addUnique(tag);
      
      // Fill remaining slots with random unpinned
      const remainingSlots = MAX_CASHTAGS - uniqueCashtags.length;
      if (remainingSlots > 0) {
        const selectRandom = <T>(array: T[], count: number): T[] => {
          const shuffled = [...array].sort(() => Math.random() - 0.5);
          return shuffled.slice(0, Math.min(count, array.length));
        };
        const halfRemaining = Math.ceil(remainingSlots / 2);
        const selectedUnpinnedTrending = selectRandom(unpinnedTrending, halfRemaining);
        const selectedUnpinnedRecommended = selectRandom(unpinnedRecommended, remainingSlots - selectedUnpinnedTrending.length);
        
        for (const tag of selectedUnpinnedTrending) addUnique(tag);
        for (const tag of selectedUnpinnedRecommended) addUnique(tag);
      }
      
      const cashtags = uniqueCashtags.slice(0, MAX_CASHTAGS);

      if (cashtags.length === 0) {
        return res.status(400).json({ error: "No cashtags available - please pin some cashtags first" });
      }

      // Random account selection (same as scheduler)
      const availableAccounts = allTwitterSettings.filter((s: { twitterCookie: string | null; isAvailableForRandom: boolean | null }) => 
        s.twitterCookie && (s.isAvailableForRandom !== false)
      );
      
      if (availableAccounts.length === 0) {
        return res.status(400).json({ error: "No Twitter accounts available for random selection (check availability settings)" });
      }

      const primaryAccount = availableAccounts[Math.floor(Math.random() * availableAccounts.length)];
      
      // Randomly select 2-4 raid reply rounds (same as scheduler)
      const raidRounds = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4

      console.log(`🎲 Manual Auto-Run config:
        - Cashtags (${cashtags.length}): ${cashtags.join(', ')}
        - Pinned count: ${pinnedRecommended.length + pinnedTrending.length}
        - Primary Account: @${primaryAccount.username} (randomly selected)
        - Max Tweets This Run: ${maxTweets} (random from ${minTweetsPerRun}-${maxTweetsPerRun})
        - Raid Rounds: ${raidRounds}`);

      autoRunService.start({
        searchParams: {
          minFollowers: 500,
          maxFollowers: 10000,
          timeRange: '1h',
          maxResults: '100',
          excludeRetweets: true,
          verifiedOnly: false
        },
        cashtags,
        username: primaryAccount.username,
        maxTweets,
        replyDelayRange: { min: 27, max: 47 },
        raidReplyDelayRange: { min: 44, max: 77 },
        dmDelayRange: { min: 7, max: 14 },
        sendDm,
        raidRounds
      });

      res.json({ 
        success: true, 
        message: "Auto-run started",
        selectedAccount: primaryAccount.username,
        raidRounds,
        cashtags
      });
    } catch (error: any) {
      console.error("Error starting auto-run:", error);
      res.status(500).json({ error: error.message || "Failed to start auto-run" });
    }
  });

  app.post("/api/auto-run/pause", (req, res) => {
    autoRunService.pause();
    res.json({ success: true, message: "Auto-run paused" });
  });

  app.post("/api/auto-run/resume", (req, res) => {
    autoRunService.resume();
    res.json({ success: true, message: "Auto-run resumed" });
  });

  app.post("/api/auto-run/cancel", (req, res) => {
    autoRunService.cancel();
    res.json({ success: true, message: "Auto-run cancelled" });
  });

  app.post("/api/auto-run/reset", (req, res) => {
    autoRunService.reset();
    res.json({ success: true, message: "Auto-run reset" });
  });

  // Single Tweet Auto Run - runs full auto-run chain for a single tweet
  app.post("/api/single-auto-run", async (req, res) => {
    try {
      const { tweetUrl, sendDm = false } = req.body; // DM disabled temporarily
      
      if (!tweetUrl) {
        return res.status(400).json({ error: "tweetUrl is required" });
      }
      
      // Extract tweet ID from URL
      const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
      if (!tweetIdMatch) {
        return res.status(400).json({ error: "Invalid tweet URL - could not extract tweet ID" });
      }
      const tweetId = tweetIdMatch[1];
      
      // Extract author handle from URL
      const handleMatch = tweetUrl.match(/(?:twitter\.com|x\.com)\/([^\/]+)\/status/);
      const authorHandle = handleMatch ? handleMatch[1] : '';
      
      const storage = await getStorage();
      const allTwitterSettings = await storage.getAllTwitterSettings();
      
      // Get available accounts for random selection
      const availableAccounts = allTwitterSettings.filter((s: { twitterCookie: string | null; isAvailableForRandom: boolean | null }) => 
        s.twitterCookie && (s.isAvailableForRandom !== false)
      );
      
      if (availableAccounts.length === 0) {
        return res.status(400).json({ error: "No Twitter accounts available for random selection" });
      }
      
      // Select random primary account
      const primaryAccount = availableAccounts[Math.floor(Math.random() * availableAccounts.length)];
      
      // Get AI config for system prompt
      const aiConfig = await storage.getAiConfig();
      const systemPrompt = aiConfig?.systemPrompt || "Generate a friendly, engaging reply.";
      
      // Fetch tweet content using TwitterAPI.io
      let tweetContent = '';
      try {
        const twitterApiKey = process.env.TWITTERAPI_IO_KEY;
        if (twitterApiKey) {
          const tweetResponse = await fetch(
            `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
            { headers: { 'X-API-Key': twitterApiKey } }
          );
          if (tweetResponse.ok) {
            const tweetData = await tweetResponse.json();
            tweetContent = tweetData?.tweets?.[0]?.text || '';
          }
        }
      } catch (e) {
        console.log(`[SingleAutoRun] Could not fetch tweet content, using URL as context`);
      }
      if (!tweetContent) {
        tweetContent = `Tweet from @${authorHandle}`;
      }
      
      // Generate reply using OpenRouter
      if (!openRouterService) {
        return res.status(500).json({ error: 'AI service not configured - OPENROUTER_API_KEY missing' });
      }
      const generatedReply = await openRouterService.generateReply(tweetContent || `Tweet from @${authorHandle}`, systemPrompt);
      
      // Get random image for reply
      const replyImages = await storage.getAllReplyImages();
      let mediaUrl: string | undefined;
      if (replyImages.length > 0) {
        const randomImage = replyImages[Math.floor(Math.random() * replyImages.length)];
        mediaUrl = randomImage.imageUrl;
      }
      
      // Calculate raid rounds (cap to available accounts minus primary)
      const otherAccounts = availableAccounts.filter(
        (acc: { username: string }) => acc.username.toLowerCase() !== primaryAccount.username.toLowerCase()
      );
      const raidRounds = Math.min(Math.floor(Math.random() * 3) + 2, otherAccounts.length); // 2-4 rounds, capped
      
      console.log(`[SingleAutoRun] Starting for tweet ${tweetId}:
        - Primary Account: @${primaryAccount.username}
        - Raid Accounts: ${otherAccounts.length} available, ${raidRounds} rounds
        - Send DM: ${sendDm}
        - Media: ${mediaUrl ? 'yes' : 'no'}`);
      
      // STEP 1: Prepare raid reply data BEFORE queuing primary job (to avoid race condition)
      const raidAccountsToUse: Array<{
        username: string;
        replyText: string;
        mediaUrl?: string;
        delaySeconds: number;
      }> = [];
      
      // Pre-generate raid replies and select accounts
      if (raidRounds > 0 && otherAccounts.length > 0) {
        const usedAccounts: string[] = [];
        // Start first raid reply 45-75 seconds after primary completes
        // This accounts for: primary like (6-11s) + buffer (30-60s)
        // Ensures safe gap after TwexAPI calls (DM disabled)
        let delayOffset = Math.floor(Math.random() * 30) + 45; // 45-75 seconds
        
        for (let round = 0; round < raidRounds; round++) {
          const availableForRound = otherAccounts.filter(
            (acc: { username: string }) => !usedAccounts.includes(acc.username.toLowerCase())
          );
          
          if (availableForRound.length === 0) break;
          
          const raidAccount = availableForRound[Math.floor(Math.random() * availableForRound.length)];
          usedAccounts.push(raidAccount.username.toLowerCase());
          
          // Generate unique reply for each raid account (openRouterService guaranteed non-null by guard at line 289)
          const raidReply = await openRouterService!.generateReply(
            tweetContent || `Tweet from @${authorHandle}`,
            systemPrompt
          );
          
          // Get random image for raid reply
          let raidMediaUrl: string | undefined;
          if (replyImages.length > 0) {
            const randomImage = replyImages[Math.floor(Math.random() * replyImages.length)];
            raidMediaUrl = randomImage.imageUrl;
          }
          
          raidAccountsToUse.push({
            username: raidAccount.username,
            replyText: raidReply,
            mediaUrl: raidMediaUrl,
            delaySeconds: delayOffset
          });
          
          delayOffset += Math.floor(Math.random() * 30) + 30; // 30-60 second gaps between raids
          console.log(`[SingleAutoRun] Prepared raid reply ${round + 1}/${raidRounds} from @${raidAccount.username}`);
        }
      }
      
      // STEP 2: Set up event listener BEFORE queuing primary job (fixes race condition)
      // This ensures we catch the completion event even if the job executes immediately
      // Use a unique run ID to match the job, since job ID isn't available until after await
      const runId = `single-auto-run-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const raidJobIds: string[] = [];
      const completedRaidUrls: string[] = []; // Track completed raid reply URLs for cross-liking
      let listenerHandled = false;
      
      const onJobCompleted = async (completedJob: any) => {
        // Skip if already handled or not a reply job
        if (listenerHandled || completedJob.type !== 'reply') return;
        
        // Match by job data: this is OUR primary job if it matches the tweet, username, and reply text
        const jobData = completedJob.data;
        if (!jobData || 
            jobData.tweetId !== tweetId || 
            jobData.username !== primaryAccount.username ||
            jobData.replyText !== generatedReply) {
          return;
        }
        
        listenerHandled = true; // Prevent duplicate handling
        
        console.log(`[SingleAutoRun] Job completed event received:`, {
          jobId: completedJob.id,
          runId: runId,
          hasResult: !!completedJob.result,
          replyUrl: completedJob.result?.replyUrl || 'N/A'
        });
        
        if (completedJob.result?.replyUrl) {
          // Extract the primary reply's tweet ID from its URL
          const primaryReplyUrl = completedJob.result.replyUrl;
          const primaryReplyIdMatch = primaryReplyUrl.match(/status\/(\d+)/);
          
          if (primaryReplyIdMatch) {
            const primaryReplyTweetId = primaryReplyIdMatch[1];
            console.log(`[SingleAutoRun] Primary reply completed: ${primaryReplyUrl}`);
            console.log(`[SingleAutoRun] Queueing ${raidAccountsToUse.length} raid replies TO primary reply ID: ${primaryReplyTweetId}`);
            
            // Now queue raid replies targeting the PRIMARY REPLY, not the original tweet
            // Each raid account will: Reply + Like in the SAME browser session (no tunnel reconnect)
            for (const raid of raidAccountsToUse) {
              // Queue reply + like in single session - avoids proxy tunnel issues
              const raidJob = await replyQueue.queueReply({
                tweetId: primaryReplyTweetId, // Reply TO the primary reply
                replyText: raid.replyText,
                username: raid.username,
                tweetUrl: primaryReplyUrl,
                authorHandle: primaryAccount.username, // Replying to our own primary
                mediaUrl: raid.mediaUrl,
                delaySeconds: raid.delaySeconds,
                sendDm: false,
                dmDelaySeconds: 0,
                alsoLikeTweet: true  // Like in same session after reply
              });
              raidJobIds.push(raidJob.id);
              console.log(`[SingleAutoRun] Queued raid reply+like from @${raid.username} -> ${primaryReplyTweetId} (combined session)`);
            }
          } else {
            console.error(`[SingleAutoRun] Could not extract tweet ID from primary reply URL: ${primaryReplyUrl}`);
          }
        } else {
          console.error(`[SingleAutoRun] Primary job completed but no replyUrl in result:`, completedJob.result);
        }
        
        // Remove primary listener after handling (keep raid listener active)
        jobManager.off('job:completed', onJobCompleted);
      };
      
      // RAID CROSS-LIKING: Set up listener for raid job completions
      const onRaidCompleted = async (completedJob: any) => {
        // Only handle raid reply jobs from this run
        if (!raidJobIds.includes(completedJob.id) || completedJob.type !== 'reply') return;

        const replyUrl = completedJob.result?.replyUrl;
        if (!replyUrl) return;

        console.log(`[SingleAutoRun] Raid completed by @${completedJob.data.username}: ${replyUrl}`);

        // 60% chance to like each previous raid reply
        if (completedRaidUrls.length > 0) {
          console.log(`[SingleAutoRun] @${completedJob.data.username} checking ${completedRaidUrls.length} previous raids for cross-likes (60% chance each)`);

          for (const previousRaidUrl of completedRaidUrls) {
            if (Math.random() < 0.6) { // 60% chance
              const likeDelay = Math.floor(Math.random() * 10) + 5; // 5-15 seconds
              await replyQueue.queueLike({
                tweetUrl: previousRaidUrl,
                username: completedJob.data.username,
                delaySeconds: likeDelay
              });
              console.log(`[SingleAutoRun] ❤️ Queued cross-like: @${completedJob.data.username} will like previous raid in ${likeDelay}s`);
            }
          }
        }

        // Add this raid's URL to the list for future raids to potentially like
        completedRaidUrls.push(replyUrl);
      };

      // Register listener BEFORE creating job to avoid race condition
      if (raidAccountsToUse.length > 0) {
        jobManager.on('job:completed', onJobCompleted);
        jobManager.on('job:completed', onRaidCompleted); // Add raid cross-like listener
        console.log(`[SingleAutoRun] Event listeners registered for job:completed (BEFORE job creation)`);

        // Cleanup listeners after timeout (10 minutes) to allow all raids to complete
        setTimeout(() => {
          jobManager.off('job:completed', onJobCompleted);
          jobManager.off('job:completed', onRaidCompleted);
          console.log(`[SingleAutoRun] Event listeners cleanup (10min timeout)`);
        }, 10 * 60 * 1000);
      }
      
      // STEP 3: NOW queue primary reply (after listener is registered)
      const primaryJob = await replyQueue.queueReply({
        tweetId,
        replyText: generatedReply,
        username: primaryAccount.username,
        tweetUrl,
        authorHandle,
        mediaUrl,
        delaySeconds: 0, // Send immediately
        sendDm,
        dmDelaySeconds: 45,
        alsoLikeTweet: true  // Like the target tweet in same session after reply
      });
      
      console.log(`[SingleAutoRun] Primary job queued: ${primaryJob.id} (runId: ${runId})`);
      
      res.json({
        success: true,
        message: "Single auto-run started",
        primaryJobId: primaryJob.id,
        raidJobsPending: raidAccountsToUse.length,
        primaryAccount: primaryAccount.username,
        raidRounds: raidAccountsToUse.length,
        generatedReply,
        tweetId,
        note: "Raid replies will be queued after primary reply completes"
      });
      
    } catch (error: any) {
      console.error("Error in single auto-run:", error);
      res.status(500).json({ error: error.message || "Failed to start single auto-run" });
    }
  });

  // Scheduler endpoints
  app.get("/api/schedules", async (req, res) => {
    try {
      const state = schedulerService.getState();
      res.json(state);
    } catch (error: any) {
      console.error("Error getting schedules:", error);
      res.status(500).json({ error: error.message || "Failed to get schedules" });
    }
  });

  // Test trigger for scheduler - must be before :id routes
  app.post("/api/schedules/test-trigger", async (req, res) => {
    try {
      console.log(`🧪 [API] Test trigger endpoint called`);
      const result = await schedulerService.triggerTestRun();
      
      if (result.success) {
        res.json({
          success: true,
          message: "Test scheduler run initiated",
          config: result.config
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error
        });
      }
    } catch (error: any) {
      console.error("Error in test trigger:", error);
      res.status(500).json({ error: error.message || "Failed to trigger test run" });
    }
  });

  app.post("/api/schedules", async (req, res) => {
    try {
      const { timeOfDay } = req.body;
      
      if (!timeOfDay || !/^\d{2}:\d{2}$/.test(timeOfDay)) {
        return res.status(400).json({ error: "timeOfDay is required in HH:MM format" });
      }

      const schedule = await schedulerService.addSchedule(timeOfDay);
      res.json({ success: true, schedule });
    } catch (error: any) {
      console.error("Error creating schedule:", error);
      res.status(500).json({ error: error.message || "Failed to create schedule" });
    }
  });

  app.delete("/api/schedules/:id", async (req, res) => {
    try {
      await schedulerService.removeSchedule(req.params.id);
      res.json({ success: true, message: "Schedule deleted" });
    } catch (error: any) {
      console.error("Error deleting schedule:", error);
      res.status(500).json({ error: error.message || "Failed to delete schedule" });
    }
  });

  app.patch("/api/schedules/:id", async (req, res) => {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: "enabled (boolean) is required" });
      }

      await schedulerService.toggleSchedule(req.params.id, enabled);
      res.json({ success: true, message: `Schedule ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: any) {
      console.error("Error toggling schedule:", error);
      res.status(500).json({ error: error.message || "Failed to toggle schedule" });
    }
  });

  // Queue a single reply
  app.post("/api/queue/reply", async (req, res) => {
    try {
      const { 
        tweetId, 
        replyText, 
        username, 
        tweetUrl, 
        mediaUrl, 
        authorHandle, 
        delaySeconds = 0,
        sendDm = false,
        dmDelaySeconds = 45
      } = req.body;

      if (!tweetId || !replyText || !username) {
        return res.status(400).json({ error: "tweetId, replyText, and username are required" });
      }

      const job = await replyQueue.queueReply({
        tweetId,
        replyText,
        username,
        tweetUrl,
        mediaUrl,
        authorHandle,
        delaySeconds,
        sendDm,
        dmDelaySeconds
      });

      res.json({ success: true, job });
    } catch (error: any) {
      console.error("Error queueing reply:", error);
      res.status(500).json({ error: error.message || "Failed to queue reply" });
    }
  });

  // Queue bulk replies
  app.post("/api/queue/bulk-replies", async (req, res) => {
    try {
      const {
        replies,
        sendDm = false,
        dmDelayRange = { min: 7, max: 14 },
        replyDelayRange = { min: 27, max: 47 }
      } = req.body;

      if (!replies || !Array.isArray(replies) || replies.length === 0) {
        return res.status(400).json({ error: "replies array is required" });
      }

      const jobs = await replyQueue.queueBulkReplies(replies, {
        sendDm,
        dmDelayRange,
        replyDelayRange
      });

      res.json({ 
        success: true, 
        queued: jobs.length,
        jobs: jobs.map(j => ({ id: j.id, status: j.status, scheduledAt: j.scheduledAt }))
      });
    } catch (error: any) {
      console.error("Error queueing bulk replies:", error);
      res.status(500).json({ error: error.message || "Failed to queue bulk replies" });
    }
  });

  // Get queue status
  app.get("/api/queue/status", (req, res) => {
    res.json(replyQueue.getQueueStatus());
  });

  // Start tweet search and analysis
  app.post("/api/search", async (req, res) => {
    try {
      const searchParams = searchParamsSchema.parse(req.body);
      
      // Extract all non-empty cashtags and normalize by removing $ symbol if present
      const cashtags = [
        searchParams.cashtag1,
        searchParams.cashtag2,
        searchParams.cashtag3,
        searchParams.cashtag4,
        searchParams.cashtag5,
        searchParams.cashtag6,
        searchParams.cashtag7,
        searchParams.cashtag8
      ]
        .filter((tag): tag is string => tag !== undefined && tag.trim().length > 0)
        .map(tag => tag.trim().startsWith('$') ? tag.trim().substring(1) : tag.trim());

      if (cashtags.length === 0) {
        return res.status(400).json({ error: "At least one cashtag is required" });
      }

      // Create search record (using first cashtag for backward compatibility)
      const storage = await getStorage();
      const search = await storage.createTweetSearch({
        cashtag: cashtags.join(", "), // Store all cashtags for reference
        minFollowers: searchParams.minFollowers,
        maxFollowers: searchParams.maxFollowers,
        timeRange: searchParams.timeRange,
        maxResults: parseInt(searchParams.maxResults),
        excludeRetweets: searchParams.excludeRetweets,
        verifiedOnly: searchParams.verifiedOnly
      });

      // Queue search job via job manager
      const job = await searchQueue.queueSearch({
        searchId: search.id,
        cashtags,
        params: searchParams
      });

      res.json({ searchId: search.id, jobId: job.id, status: "processing" });
    } catch (error) {
      console.error("Search error:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid search parameters" });
    }
  });

  // Get search status and results
  app.get("/api/search/:id", async (req, res) => {
    try {
      const storage = await getStorage();
      const search = await storage.getTweetSearch(req.params.id);
      if (!search) {
        return res.status(404).json({ error: "Search not found" });
      }

      // Get filtered handles
      const filteredHandlesData = await storage.getFilteredHandles();
      const filteredHandles = new Set<string>();
      if (filteredHandlesData?.handles) {
        // Parse handles from various formats: @handle, handle, comma/space/newline separated
        filteredHandlesData.handles
          .split(/[\s,\n]+/)
          .map(h => h.trim().replace(/^@/, '').toLowerCase())
          .filter(h => h.length > 0)
          .forEach(h => filteredHandles.add(h));
      }

      const tweets = await storage.getTweetsBySearchId(search.id);
      // Only include tweets that were explicitly analyzed as NON-BOTS (isBot === false)
      // This excludes: bots (isBot === true), unanalyzed tweets (isBot === null), and failed analyses
      // Also exclude tweets from filtered handles
      const filteredTweets = tweets
        .filter(tweet => tweet.isBot === false)
        .filter(tweet => !filteredHandles.has(tweet.authorHandle.toLowerCase()))
        .sort((a, b) => b.authorFollowers - a.authorFollowers); // Ensure consistent ordering

      res.json({
        search,
        tweets: filteredTweets,
        stats: {
          total: tweets.length,
          filtered: filteredTweets.length,
          bots: tweets.filter(t => t.isBot).length
        }
      });
    } catch (error) {
      console.error("Get search error:", error);
      res.status(500).json({ error: "Failed to get search results" });
    }
  });

  // Get processing status for real-time updates
  app.get("/api/search/:id/status", async (req, res) => {
    try {
      const storage = await getStorage();
      const search = await storage.getTweetSearch(req.params.id);
      if (!search) {
        return res.status(404).json({ error: "Search not found" });
      }

      const tweets = await storage.getTweetsBySearchId(search.id);
      
      res.json({
        status: search.status,
        progress: {
          total: tweets.length,
          analyzed: tweets.filter(t => t.botAnalysis !== null).length
        }
      });
    } catch (error) {
      console.error("Get status error:", error);
      res.status(500).json({ error: "Failed to get search status" });
    }
  });

  // Get trending Solana tokens from DexScreener
  app.get("/api/trending/:timeframe", async (req, res) => {
    try {
      const timeframe = req.params.timeframe as '1h' | '24h';
      
      if (timeframe !== '1h' && timeframe !== '24h') {
        return res.status(400).json({ error: "Invalid timeframe. Use '1h' or '24h'" });
      }

      const cacheKey = timeframe === '1h' ? CACHE_KEYS.TRENDING_1H : CACHE_KEYS.TRENDING_24H;
      
      let trendingTokens = cacheService.get<any[]>(cacheKey);
      
      if (!trendingTokens) {
        await rateLimiter.acquire('dexscreener');
        trendingTokens = await dexScreenerService.getTrendingTokens(timeframe);
        cacheService.set(cacheKey, trendingTokens, CACHE_TTL.TRENDING);
      }
      
      res.json({
        timeframe,
        tokens: trendingTokens,
        count: trendingTokens.length,
        cached: cacheService.has(cacheKey),
        cacheAge: cacheService.getAge(cacheKey)
      });
    } catch (error) {
      console.error("Trending tokens error:", error);
      res.status(500).json({ error: "Failed to fetch trending tokens" });
    }
  });

  // Recommended cashtags routes
  app.get("/api/recommended-cashtags", async (req, res) => {
    try {
      const storage = await getStorage();
      const cashtags = await storage.getRecommendedCashtags();
      res.json(cashtags);
    } catch (error) {
      console.error("Error fetching recommended cashtags:", error);
      res.status(500).json({ error: "Failed to fetch recommended cashtags" });
    }
  });

  app.post("/api/recommended-cashtags", async (req, res) => {
    try {
      const storage = await getStorage();
      const symbol = req.body.symbol?.toUpperCase();
      
      if (!symbol) {
        return res.status(400).json({ error: "Symbol is required" });
      }

      // Fetch real market data for the symbol using the improved method with manual fallbacks
      try {
        const tokensData = await dexScreenerService.getTokensDataBySymbols([symbol]);
        const tokenData = tokensData.get(symbol);
        
        if (tokenData) {
          // Use real market data or manual fallback data
          const cashtagData = {
            symbol: tokenData.symbol,
            name: tokenData.name,
            marketCap: Math.floor(tokenData.marketCap || 0), // Convert to integer
            volume24h: Math.floor(tokenData.volume24h || 0), // Convert to integer
            priceChange24h: Math.round((tokenData.priceChange24h || 0) * 100), // Convert to basis points
            icon: tokenData.icon || null
          };
          
          const cashtag = await storage.createRecommendedCashtag(cashtagData);
          res.json(cashtag);
        } else {
          // Token not found on any service
          res.status(404).json({ error: `Token '${symbol}' not found on Solana. Please check the symbol.` });
        }
      } catch (apiError) {
        console.error("Error fetching token data:", apiError);
        // Fallback to basic data if API fails
        const fallbackData = {
          symbol: symbol,
          name: `${symbol} Token`,
          marketCap: 0,
          volume24h: 0,
          priceChange24h: 0,
          icon: null
        };
        
        const cashtag = await storage.createRecommendedCashtag(fallbackData);
        res.json(cashtag);
      }
    } catch (error) {
      console.error("Error creating recommended cashtag:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid cashtag data" });
    }
  });

  app.put("/api/recommended-cashtags/:symbol", async (req, res) => {
    try {
      const storage = await getStorage();
      // Use symbol as-is to preserve case (storage handles case-insensitive matching)
      const symbol = decodeURIComponent(req.params.symbol);
      const cashtagData = insertRecommendedCashtagSchema.parse(req.body);
      await storage.updateRecommendedCashtag(symbol, cashtagData);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating recommended cashtag:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid cashtag data" });
    }
  });

  app.delete("/api/recommended-cashtags/:symbol", async (req, res) => {
    try {
      const storage = await getStorage();
      // Use symbol as-is to preserve case (e.g., "Frieren" not "FRIEREN")
      const symbol = decodeURIComponent(req.params.symbol);
      await storage.deleteRecommendedCashtag(symbol);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting recommended cashtag:", error);
      res.status(500).json({ error: "Failed to delete recommended cashtag" });
    }
  });

  // Refresh market data for all recommended cashtags
  app.post("/api/recommended-cashtags/refresh", async (req, res) => {
    try {
      const storage = await getStorage();
      const cashtags = await storage.getRecommendedCashtags();
      
      if (cashtags.length === 0) {
        return res.json({ message: "No cashtags to refresh", updated: 0 });
      }

      // Fetch real market data for all symbols
      const symbols = cashtags.map(c => c.symbol);
      const tokensData = await dexScreenerService.getTokensDataBySymbols(symbols);
      
      let updatedCount = 0;
      for (const cashtag of cashtags) {
        const tokenData = tokensData.get(cashtag.symbol);
        if (tokenData) {
          await storage.updateRecommendedCashtag(cashtag.symbol, {
            symbol: tokenData.symbol,
            name: tokenData.name,
            marketCap: Math.floor(tokenData.marketCap || 0), // Convert to integer
            volume24h: Math.floor(tokenData.volume24h || 0), // Convert to integer
            priceChange24h: Math.round((tokenData.priceChange24h || 0) * 100),
            icon: tokenData.icon || null
          });
          updatedCount++;
        }
      }
      
      res.json({ 
        message: `Successfully refreshed market data for ${updatedCount} out of ${cashtags.length} cashtags`,
        updated: updatedCount,
        total: cashtags.length
      });
    } catch (error) {
      console.error("Error refreshing recommended cashtags:", error);
      res.status(500).json({ error: "Failed to refresh market data" });
    }
  });

  // Toggle pinned status for recommended cashtag
  app.post("/api/recommended-cashtags/:symbol/toggle-pinned", async (req, res) => {
    try {
      const storage = await getStorage();
      const symbol = decodeURIComponent(req.params.symbol);
      const { isPinned } = req.body;
      
      if (typeof isPinned !== 'boolean') {
        return res.status(400).json({ error: "isPinned must be a boolean" });
      }
      
      await storage.toggleRecommendedCashtagPinned(symbol, isPinned);
      res.json({ success: true, symbol, isPinned });
    } catch (error) {
      console.error("Error toggling cashtag pinned status:", error);
      res.status(500).json({ error: "Failed to toggle pinned status" });
    }
  });

  // Get pinned recommended cashtags only
  app.get("/api/recommended-cashtags/pinned", async (req, res) => {
    try {
      const storage = await getStorage();
      const pinnedCashtags = await storage.getPinnedRecommendedCashtags();
      res.json(pinnedCashtags);
    } catch (error) {
      console.error("Error fetching pinned cashtags:", error);
      res.status(500).json({ error: "Failed to fetch pinned cashtags" });
    }
  });

  // Pinned trending tokens routes
  app.get("/api/pinned-trending-tokens", async (req, res) => {
    try {
      const storage = await getStorage();
      const pinnedTokens = await storage.getPinnedTrendingTokens();
      res.json(pinnedTokens);
    } catch (error) {
      console.error("Error fetching pinned trending tokens:", error);
      res.status(500).json({ error: "Failed to fetch pinned trending tokens" });
    }
  });

  app.post("/api/pinned-trending-tokens", async (req, res) => {
    try {
      const storage = await getStorage();
      const { symbol } = req.body;
      
      if (!symbol || typeof symbol !== 'string') {
        return res.status(400).json({ error: "symbol is required" });
      }
      
      const token = await storage.addPinnedTrendingToken(symbol);
      res.json(token);
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: "Token already pinned" });
      }
      console.error("Error adding pinned trending token:", error);
      res.status(500).json({ error: "Failed to add pinned trending token" });
    }
  });

  app.delete("/api/pinned-trending-tokens/:symbol", async (req, res) => {
    try {
      const storage = await getStorage();
      const symbol = decodeURIComponent(req.params.symbol);
      await storage.removePinnedTrendingToken(symbol);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing pinned trending token:", error);
      res.status(500).json({ error: "Failed to remove pinned trending token" });
    }
  });

  // Twitter settings routes
  app.get("/api/twitter-settings/defaults", async (req, res) => {
    try {
      const defaults = {
        apiKey: process.env.TWITTERAPI_IO_KEY || "",
        twitterCookie: process.env.TWITTER_COOKIE || "",
        groupChatForwardingEnabled: true,
        groupChatConversationId: "1969047827406831927",
        twitterOAuthApiKey: process.env.TWITTER_OAUTH_API_KEY || "",
        twitterOAuthApiSecret: process.env.TWITTER_OAUTH_API_SECRET || "",
        twitterOAuthAccessToken: process.env.TWITTER_OAUTH_ACCESS_TOKEN || "",
        twitterOAuthAccessTokenSecret: process.env.TWITTER_OAUTH_ACCESS_TOKEN_SECRET || "",
      };
      
      res.json(defaults);
    } catch (error) {
      console.error("Error fetching default settings:", error);
      res.status(500).json({ error: "Failed to fetch default settings" });
    }
  });

  // Get all Twitter usernames
  app.get("/api/twitter-usernames", async (req, res) => {
    try {
      const storage = await getStorage();
      const allSettings = await storage.getAllTwitterSettings();
      
      const usernames = allSettings.map(s => ({
        username: s.username,
        isActive: s.isActive,
        hasCookie: !!s.twitterCookie,
        isAvailableForRandom: s.isAvailableForRandom ?? true
      }));
      
      res.json(usernames);
    } catch (error) {
      console.error("Error fetching Twitter usernames:", error);
      res.status(500).json({ error: "Failed to fetch Twitter usernames" });
    }
  });

  // Toggle availability for random selection (primary/raid replies)
  app.patch("/api/twitter-usernames/:username/availability", async (req, res) => {
    try {
      const { username } = req.params;
      const { isAvailableForRandom } = req.body;
      
      if (typeof isAvailableForRandom !== 'boolean') {
        return res.status(400).json({ error: "isAvailableForRandom must be a boolean" });
      }

      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(username);
      
      if (!settings) {
        return res.status(404).json({ error: `Username "${username}" not found` });
      }

      await storage.updateTwitterSettings(settings.id, {
        isAvailableForRandom
      });

      console.log(`✅ Updated availability for ${username}: ${isAvailableForRandom ? 'available' : 'unavailable'} for random selection`);
      res.json({ success: true, isAvailableForRandom });
    } catch (error) {
      console.error("Error updating availability:", error);
      res.status(500).json({ error: "Failed to update availability" });
    }
  });

  // Set active username
  app.post("/api/twitter-usernames/set-active", async (req, res) => {
    try {
      const { username } = req.body;
      
      if (!username) {
        return res.status(400).json({ error: "Username is required" });
      }

      const storage = await getStorage();
      await storage.setActiveUsername(username);
      
      // Verify the active user was set correctly
      const activeSettings = await storage.getTwitterSettings();
      console.log(`✅ Active username set to: ${username}`);
      console.log(`🔍 Verified active user is: ${activeSettings?.username}`);
      console.log(`🔑 Active user has cookie: ${!!activeSettings?.twitterCookie}`);

      res.json({ success: true, message: `Switched to user: ${username}` });
    } catch (error) {
      console.error("Error setting active username:", error);
      res.status(500).json({ error: "Failed to set active username" });
    }
  });

  // Create new username
  app.post("/api/twitter-usernames/create", async (req, res) => {
    try {
      const { username, twitterCookie } = req.body;
      
      if (!username) {
        return res.status(400).json({ error: "Username is required" });
      }

      const storage = await getStorage();
      
      // Check if username already exists
      const existing = await storage.getTwitterSettingsByUsername(username);
      if (existing) {
        return res.status(400).json({ error: `Username "${username}" already exists` });
      }

      await storage.createTwitterSettings({
        username,
        twitterCookie: twitterCookie || null,
        isActive: false,
        lastUsed: null,
      });

      console.log(`✅ Created new username: ${username}`);
      res.json({ success: true, message: `Created username: ${username}` });
    } catch (error) {
      console.error("Error creating username:", error);
      res.status(500).json({ error: "Failed to create username" });
    }
  });

  // Delete username
  app.delete("/api/twitter-usernames/:username", async (req, res) => {
    try {
      const { username } = req.params;
      
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(username);
      
      if (!settings) {
        return res.status(404).json({ error: `Username "${username}" not found` });
      }

      // Prevent deleting the active username
      if (settings.isActive) {
        return res.status(400).json({ error: "Cannot delete the active username. Please switch to another username first." });
      }

      await storage.deleteTwitterSettings(settings.id);
      console.log(`✅ Deleted username: ${username}`);
      res.json({ success: true, message: `Deleted username: ${username}` });
    } catch (error) {
      console.error("Error deleting username:", error);
      res.status(500).json({ error: "Failed to delete username" });
    }
  });

  // Update username cookie
  app.patch("/api/twitter-usernames/:username", async (req, res) => {
    try {
      const { username } = req.params;
      const { twitterCookie } = req.body;
      
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(username);
      
      if (!settings) {
        return res.status(404).json({ error: `Username "${username}" not found` });
      }

      await storage.updateTwitterSettings(settings.id, {
        twitterCookie: twitterCookie || null,
      });

      console.log(`✅ Updated cookie for username: ${username}`);
      res.json({ success: true, message: `Updated cookie for: ${username}` });
    } catch (error) {
      console.error("Error updating username cookie:", error);
      res.status(500).json({ error: "Failed to update username cookie" });
    }
  });

  app.get("/api/twitter-settings", async (req, res) => {
    try {
      const storage = await getStorage();
      const settings = await storage.getTwitterSettings();
      
      if (settings) {
        res.json({
          id: settings.id,
          username: settings.username,
          twitterCookie: settings.twitterCookie || "",
          hasCookie: !!settings.twitterCookie,
          isActive: settings.isActive,
          lastUsed: settings.lastUsed
        });
      } else {
        res.json(null);
      }
    } catch (error) {
      console.error("Error fetching Twitter settings:", error);
      res.status(500).json({ error: "Failed to fetch Twitter settings" });
    }
  });

  app.post("/api/twitter-settings", async (req, res) => {
    try {
      const { twitterCookie } = req.body;
      
      if (!twitterCookie) {
        return res.status(400).json({ error: "Twitter cookie is required" });
      }

      const storage = await getStorage();
      
      // Get the active user settings
      const activeSettings = await storage.getTwitterSettings();
      
      if (activeSettings) {
        // Update the existing active user's cookie
        await storage.updateTwitterSettings(activeSettings.id, { twitterCookie });
        
        res.json({
          id: activeSettings.id,
          username: activeSettings.username,
          hasCookie: true,
          isActive: true
        });
      } else {
        return res.status(400).json({ error: "No active user found. Please select a username first." });
      }
    } catch (error) {
      console.error("Error saving Twitter settings:", error);
      res.status(500).json({ error: "Failed to save Twitter settings" });
    }
  });

  app.post("/api/twitter-settings/test", async (req, res) => {
    try {
      // For now, just return success if we have the required environment variables
      const hasRequiredSecrets = !!(
        process.env.TWITTERAPI_IO_KEY && 
        process.env.TWITTER_USERNAME && 
        process.env.TWITTER_PASSWORD
      );

      if (!hasRequiredSecrets) {
        return res.status(400).json({ 
          error: "Missing required Twitter credentials. Please configure them in Replit Secrets." 
        });
      }

      // TODO: Implement actual connection test with TwitterAPI.io
      res.json({ success: true, message: "Connection test passed" });
    } catch (error) {
      console.error("Error testing Twitter connection:", error);
      res.status(500).json({ error: "Connection test failed" });
    }
  });

  // Send DM endpoint - uses local Puppeteer automation
  app.post("/api/send-dm", async (req, res) => {
    try {
      const { message, groupChatId } = req.body;
      
      if (!message) {
        return res.status(400).json({ success: false, error: "Message is required" });
      }

      const storage = await getStorage();
      const settings = await storage.getTwitterSettings();
      
      console.log(`🔍 [SEND DM] Using cookie from user: ${settings?.username}`);
      console.log(`🔍 [SEND DM] User is active: ${settings?.isActive}`);
      
      if (!settings || !settings.twitterCookie) {
        return res.status(400).json({ success: false, error: "Twitter cookie not configured" });
      }

      // Use local Puppeteer automation (fire-and-forget for quick response)
      console.log('📤 Sending DM via local Puppeteer automation (fire-and-forget):', message);
      
      const { twitterAutomation } = await import('./services/twitterAutomation');
      
      // Fire-and-forget: start the DM but don't wait for it
      twitterAutomation.sendDm({
        message,
        twitterCookie: settings.twitterCookie,
        groupChatId: groupChatId || '1969047827406831927',
        username: settings.username
      })
        .then((result) => {
          if (result.success) {
            console.log(`✅ DM sent successfully: ${result.totalSent} messages`);
          } else {
            console.error('❌ DM failed:', result.error);
          }
        })
        .catch((error) => {
          console.error('❌ DM error:', error.message);
        });

      // Respond immediately to client
      res.json({ 
        success: true, 
        message: "DM request sent successfully",
        status: "processing"
      });
    } catch (error) {
      console.error("❌ Error sending DM:", error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Failed to send DM"
      });
    }
  });

  // Test local browser automation connection
  app.get("/api/test-browser-connection", async (req, res) => {
    try {
      const { twitterAutomation } = await import('./services/twitterAutomation');
      const result = await twitterAutomation.testConnection();
      res.json(result);
    } catch (error) {
      console.error("Error testing browser connection:", error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Connection test failed"
      });
    }
  });

  // Test organic activity for a specific account
  app.post("/api/test-organic-like", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ success: false, error: "Username is required" });
      }
      
      const { organicActivityService } = await import('./services/organicActivityService');
      const result = await organicActivityService.testLikeForAccount(username);
      res.json(result);
    } catch (error) {
      console.error("Error testing organic like:", error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Organic like test failed"
      });
    }
  });

  // Direct like test - bypasses timeline fetching, uses specific tweet URL
  app.post("/api/test-direct-like", async (req, res) => {
    try {
      const { username, tweetUrl } = req.body;
      if (!username || !tweetUrl) {
        return res.status(400).json({ success: false, error: "Username and tweetUrl are required" });
      }
      
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(username);
      
      if (!settings?.twitterCookie) {
        return res.status(400).json({ success: false, error: `No cookie for @${username}` });
      }
      
      console.log(`🧪 Direct like test: @${username} -> ${tweetUrl}`);
      
      const { twitterAutomation } = await import('./services/twitterAutomation');
      const result = await twitterAutomation.likeTweet({
        tweetUrl,
        twitterCookie: settings.twitterCookie,
        username
      });
      
      console.log(`🧪 Direct like result:`, result);
      res.json(result);
    } catch (error) {
      console.error("Error in direct like test:", error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Direct like test failed"
      });
    }
  });

  // Direct reply test - bypasses timeline fetching, uses specific tweet URL
  // If reply is not provided, auto-generates unique text via AI to avoid duplicates
  app.post("/api/test-direct-reply", async (req, res) => {
    try {
      const { username, tweetUrl, reply, mediaUrl } = req.body;
      if (!username || !tweetUrl) {
        return res.status(400).json({ success: false, error: "Username and tweetUrl are required" });
      }
      
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(username);
      
      if (!settings?.twitterCookie) {
        return res.status(400).json({ success: false, error: `No cookie for @${username}` });
      }
      
      // Extract tweet ID from URL
      const tweetIdMatch = tweetUrl.match(/status\/(\d+)/);
      if (!tweetIdMatch) {
        return res.status(400).json({ success: false, error: "Could not extract tweet ID from URL" });
      }
      const tweetId = tweetIdMatch[1];
      
      // If no reply provided, generate unique text via AI
      let replyText = reply;
      if (!replyText) {
        try {
          // Check if openRouterService is available
          if (!openRouterService) {
            throw new Error('OpenRouterService not configured');
          }
          const aiConfig = await storage.getAiConfig();
          const systemPrompt = aiConfig?.systemPrompt || "You are a witty, casual crypto enthusiast. Write a short, engaging reply.";
          replyText = await openRouterService.generateReply(
            `Generate a unique, casual test reply for tweet ${tweetId}. Keep it under 100 chars, be playful.`,
            systemPrompt
          );
          console.log(`🤖 Auto-generated reply: "${replyText}"`);
        } catch (aiError) {
          console.error("AI generation failed, using fallback:", aiError);
          // Fallback: fully unique random text (no repeated phrases)
          const words = ['vibes', 'energy', 'mood', 'feels', 'thoughts', 'perspective', 'take', 'angle'];
          const adjectives = ['interesting', 'wild', 'solid', 'fire', 'based', 'valid', 'real', 'genuine'];
          const randomWord = words[Math.floor(Math.random() * words.length)];
          const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
          const uniqueId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          replyText = `${randomAdj} ${randomWord} on this ${uniqueId}`;
        }
      }
      
      console.log(`🧪 Direct reply test: @${username} -> ${tweetUrl} (ID: ${tweetId})${mediaUrl ? ' [WITH IMAGE]' : ''}`);
      
      const { twitterAutomation } = await import('./services/twitterAutomation');
      const result = await twitterAutomation.postReply({
        tweetId,
        replyText,
        twitterCookie: settings.twitterCookie,
        username,
        mediaUrl
      });
      
      console.log(`🧪 Direct reply result:`, result);
      res.json({ ...result, generatedReply: !reply ? replyText : undefined });
    } catch (error) {
      console.error("Error in direct reply test:", error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Direct reply test failed"
      });
    }
  });

  // Direct DM test - test sending a DM without going through the main flow
  app.post("/api/test-direct-dm", async (req, res) => {
    try {
      const { username, message, groupChatId } = req.body;
      if (!username || !message) {
        return res.status(400).json({ success: false, error: "Username and message are required" });
      }

      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(username);

      if (!settings?.twitterCookie) {
        return res.status(400).json({ success: false, error: `No cookie for @${username}` });
      }

      console.log(`🧪 Direct DM test: @${username} -> "${message.substring(0, 50)}..."`);

      const { twitterAutomation } = await import('./services/twitterAutomation');
      const result = await twitterAutomation.sendDm({
        message,
        twitterCookie: settings.twitterCookie,
        groupChatId: groupChatId || '1969047827406831927',
        username
      });

      console.log(`🧪 Direct DM result:`, result);
      res.json(result);
    } catch (error) {
      console.error("Error in direct DM test:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Direct DM test failed"
      });
    }
  });

  // NEW: Comprehensive automation test - tests all core functionality
  app.post("/api/test/automation-suite", async (req, res) => {
    try {
      const { tweetUrl, username } = req.body;
      if (!tweetUrl || !username) {
        return res.status(400).json({ error: "tweetUrl and username required" });
      }

      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(username);
      if (!settings?.twitterCookie) {
        return res.status(400).json({ error: `No cookie for @${username}` });
      }

      console.log(`🧪 Running automation test suite for @${username}`);

      const results = {
        sendButtonWait: { passed: false, duration: 0, error: null as string | null },
        urlCapture: { passed: false, duration: 0, error: null as string | null },
        imageUpload: { passed: false, duration: 0, error: null as string | null },
        browserAge: { passed: false, duration: 0, error: null as string | null }
      };

      // Test send button wait functionality
      const startSendButton = Date.now();
      try {
        const { twitterAutomation } = await import('./services/twitterAutomation');
        const testReply = await twitterAutomation.postReply({
          tweetId: tweetUrl.match(/status\/(\d+)/)?.[1] || '',
          replyText: `Test reply ${Date.now()}`,
          twitterCookie: settings.twitterCookie,
          username
        });
        results.sendButtonWait.passed = testReply.success;
        results.sendButtonWait.duration = Date.now() - startSendButton;
        results.urlCapture.passed = !!testReply.replyUrl;
      } catch (e: any) {
        results.sendButtonWait.error = e.message;
        results.sendButtonWait.duration = Date.now() - startSendButton;
      }

      // Check browser age tracking
      const { browserManager } = await import('./services/browserManager');
      const stats = browserManager.getStats();
      results.browserAge.passed = stats.isConnected;

      res.json({
        success: results.sendButtonWait.passed,
        results,
        summary: {
          passed: Object.values(results).filter(r => r.passed).length,
          failed: Object.values(results).filter(r => !r.passed).length,
          total: Object.keys(results).length
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get server logs for debugging
  app.get("/api/logs", async (req, res) => {
    try {
      const { logBuffer } = await import('./index');
      const limit = parseInt(req.query.limit as string) || 500;
      const level = req.query.level as string; // filter by level: info, warn, error

      let logs = logBuffer.slice(-limit); // Get last N entries

      if (level) {
        logs = logs.filter(log => log.level === level);
      }

      res.json({
        logs,
        total: logBuffer.length,
        returned: logs.length
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // Clear server logs
  app.delete("/api/logs", async (req, res) => {
    try {
      const { logBuffer } = await import('./index');
      const previousCount = logBuffer.length;
      logBuffer.length = 0; // Clear the array
      res.json({
        success: true,
        message: `Cleared ${previousCount} log entries`,
        cleared: previousCount
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear logs" });
    }
  });

  // Get browser automation stats
  app.get("/api/browser-stats", async (req, res) => {
    try {
      const { twitterAutomation } = await import('./services/twitterAutomation');
      res.json({
        useLocalAutomation: process.env.USE_LOCAL_AUTOMATION === 'true',
        hasDecodoCredentials: !!(process.env.DECODO_USERNAME && process.env.DECODO_PASSWORD),
        stats: twitterAutomation.getStats()
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get browser stats" });
    }
  });

  // Get AI config (system prompt)
  app.get("/api/ai-config", async (req, res) => {
    try {
      const storage = await getStorage();
      const config = await storage.getAiConfig();
      
      if (!config) {
        return res.json({ systemPrompt: null });
      }
      
      res.json({ systemPrompt: config.systemPrompt });
    } catch (error) {
      console.error("Error fetching AI config:", error);
      res.status(500).json({ error: "Failed to fetch AI config" });
    }
  });

  // Save AI config (system prompt)
  app.put("/api/ai-config", async (req, res) => {
    try {
      const { systemPrompt } = req.body;
      
      if (!systemPrompt) {
        return res.status(400).json({ error: "System prompt is required" });
      }

      const storage = await getStorage();
      await storage.updateAiConfig(systemPrompt);
      
      res.json({ success: true, message: "AI config saved successfully" });
    } catch (error) {
      console.error("Error saving AI config:", error);
      res.status(500).json({ error: "Failed to save AI config" });
    }
  });

  // Get all reply images (returns metadata only, no base64 data, with normalized URLs)
  app.get("/api/reply-images", async (req, res) => {
    try {
      const storage = await getStorage();
      const images = await storage.getAllReplyImages();
      // Exclude imageData from response and normalize URLs
      const safeImages = images.map(img => {
        let normalizedUrl: string | null = img.imageUrl;
        try {
          normalizedUrl = normalizeImageUrl(img.imageUrl);
        } catch (e) {
          // If normalization fails (config issue), return original URL
          console.warn(`[ReplyImages] Failed to normalize URL for ${img.id}: ${e}`);
        }
        return {
          id: img.id,
          imageUrl: normalizedUrl,
          objectKey: img.objectKey,
          fileName: img.fileName,
          mimeType: img.mimeType,
          createdAt: img.createdAt
        };
      });
      res.json(safeImages);
    } catch (error) {
      console.error("Error fetching reply images:", error);
      res.status(500).json({ error: "Failed to fetch reply images" });
    }
  });


  // Delete reply image (from Object Storage and database)
  app.delete("/api/reply-images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const storage = await getStorage();
      
      // Get image to find objectKey for Object Storage deletion
      const image = await storage.getReplyImageById(id);
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      // Attempt to delete from Object Storage (if has objectKey)
      // This is best-effort - we proceed with DB deletion even if Object Storage fails
      if (image.objectKey) {
        const objectStorageService = new ObjectStorageService();
        const deleted = await objectStorageService.deleteFromPublicDirectory(image.objectKey);
        if (deleted) {
          console.log(`[ReplyImages] Deleted from Object Storage: ${image.objectKey}`);
        } else {
          console.log(`[ReplyImages] Object Storage unavailable, proceeding with DB cleanup for: ${image.objectKey}`);
        }
      }
      
      // Always delete from DB
      await storage.deleteReplyImage(id);
      res.json({ success: true, message: "Image deleted successfully" });
    } catch (error) {
      console.error("Error deleting reply image:", error);
      res.status(500).json({ error: "Failed to delete reply image" });
    }
  });

  // Delete ALL reply images (from Object Storage and database)
  app.delete("/api/reply-images", async (req, res) => {
    try {
      const storage = await getStorage();
      const images = await storage.getAllReplyImages();
      
      // Attempt to delete from Object Storage (best-effort)
      // We always proceed with DB deletion even if Object Storage fails
      const objectStorageService = new ObjectStorageService();
      let osDeletedCount = 0;
      let osSkippedCount = 0;
      
      for (const image of images) {
        if (image.objectKey) {
          const deleted = await objectStorageService.deleteFromPublicDirectory(image.objectKey);
          if (deleted) {
            osDeletedCount++;
          } else {
            osSkippedCount++;
          }
        }
      }
      
      if (osDeletedCount > 0) {
        console.log(`[ReplyImages] Deleted ${osDeletedCount} files from Object Storage`);
      }
      if (osSkippedCount > 0) {
        console.log(`[ReplyImages] Object Storage unavailable for ${osSkippedCount} files, proceeding with DB cleanup`);
      }
      
      // Delete ALL images from DB (Object Storage status doesn't block DB cleanup)
      const dbDeletedCount = await storage.deleteAllReplyImages();
      console.log(`[ReplyImages] Deleted ${dbDeletedCount} images from database`);
      
      res.json({ success: true, deletedCount: dbDeletedCount, message: `Deleted ${dbDeletedCount} images` });
    } catch (error) {
      console.error("Error deleting all reply images:", error);
      res.status(500).json({ error: "Failed to delete all reply images" });
    }
  });

  // Migrate/normalize existing image URLs in database
  app.post("/api/reply-images/migrate-urls", async (req, res) => {
    try {
      const storage = await getStorage();
      const images = await storage.getAllReplyImages();
      
      let normalizedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];
      
      for (const image of images) {
        if (!image.imageUrl) {
          skippedCount++;
          continue;
        }
        
        try {
          const normalized = normalizeImageUrl(image.imageUrl);
          if (normalized && normalized !== image.imageUrl) {
            await storage.updateReplyImageUrl(image.id, normalized);
            normalizedCount++;
            console.log(`[Migration] Normalized URL for ${image.id}: ${image.imageUrl} -> ${normalized}`);
          } else {
            skippedCount++;
          }
        } catch (err: any) {
          errors.push(`${image.id}: ${err.message}`);
          console.error(`[Migration] Failed to normalize ${image.id}:`, err.message);
        }
      }
      
      if (errors.length > 0 && normalizedCount === 0) {
        // All failed - likely a configuration issue
        return res.status(500).json({
          success: false,
          message: `URL migration failed - check APP_URL configuration`,
          totalImages: images.length,
          normalizedCount,
          skippedCount,
          errorCount: errors.length,
          errors: errors.slice(0, 10)
        });
      }
      
      res.json({
        success: true,
        message: `URL migration complete`,
        totalImages: images.length,
        normalizedCount,
        skippedCount,
        errorCount: errors.length,
        errors: errors.slice(0, 10)  // Only return first 10 errors
      });
    } catch (error: any) {
      console.error("Error migrating image URLs:", error);
      res.status(500).json({ error: error.message || "Failed to migrate image URLs" });
    }
  });

  // Get filtered handles
  app.get("/api/filtered-handles", async (req, res) => {
    try {
      const storage = await getStorage();
      const handles = await storage.getFilteredHandles();
      res.json(handles || { handles: "" });
    } catch (error) {
      console.error("Error fetching filtered handles:", error);
      res.status(500).json({ error: "Failed to fetch filtered handles" });
    }
  });

  // Update filtered handles
  app.put("/api/filtered-handles", async (req, res) => {
    try {
      const { handles } = req.body;
      if (typeof handles !== "string") {
        return res.status(400).json({ error: "Handles must be a string" });
      }
      const storage = await getStorage();
      await storage.updateFilteredHandles(handles);
      res.json({ success: true, message: "Filtered handles updated successfully" });
    } catch (error) {
      console.error("Error updating filtered handles:", error);
      res.status(500).json({ error: "Failed to update filtered handles" });
    }
  });

  // Fetch tweet content by ID for raid replies
  app.get("/api/tweet-content/:tweetId", async (req, res) => {
    try {
      const { tweetId } = req.params;

      if (!tweetId) {
        return res.status(400).json({ error: "Tweet ID is required" });
      }

      if (!process.env.TWITTERAPI_IO_KEY) {
        return res.status(400).json({ error: "Twitter API key not configured" });
      }

      const tweetResponse = await fetch(
        `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
        {
          headers: {
            'X-API-Key': process.env.TWITTERAPI_IO_KEY
          }
        }
      );

      if (!tweetResponse.ok) {
        return res.status(404).json({ error: "Could not fetch tweet content" });
      }

      const tweetApiResponse = await tweetResponse.json();
      
      if (!tweetApiResponse?.tweets?.[0]?.text) {
        return res.status(404).json({ error: "Tweet has no text content" });
      }

      const tweetData = tweetApiResponse.tweets[0];
      
      res.json({
        tweetId: tweetData.id,
        text: tweetData.text,
        authorHandle: tweetData.author?.username || ''
      });
    } catch (error) {
      console.error("Error fetching tweet content:", error);
      res.status(500).json({ error: "Failed to fetch tweet content" });
    }
  });

  // Manual Tweet Response: Fetch actual tweet content and generate contextual response
  app.post("/api/test-generate-response", async (req, res) => {
    try {
      const { tweetUrl, tweetId } = req.body;

      if (!tweetUrl || !tweetId) {
        return res.status(400).json({ error: "Tweet URL and ID are required" });
      }

      if (!process.env.TWITTERAPI_IO_KEY) {
        return res.status(400).json({ error: "Twitter API key not configured" });
      }

      // Fetch the actual tweet content using TwitterAPI.io
      const tweetResponse = await fetch(
        `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
        {
          headers: {
            'X-API-Key': process.env.TWITTERAPI_IO_KEY
          }
        }
      );

      if (!tweetResponse.ok) {
        return res.status(404).json({ error: "Could not fetch tweet content" });
      }

      const tweetApiResponse = await tweetResponse.json();
      
      if (!tweetApiResponse?.tweets?.[0]?.text) {
        return res.status(404).json({ error: "Tweet has no text content" });
      }

      const tweetData = tweetApiResponse.tweets[0];

      // Get the system prompt from storage
      const storage = await getStorage();
      const aiConfig = await storage.getAiConfig();
      const systemPrompt = aiConfig?.systemPrompt || '';

      // Generate contextual response using the actual tweet text
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://twitter-cashtag-analyzer.replit.app",
          "X-Title": "Twitter Cashtag Analyzer"
        },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2-0905",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user", 
              content: tweetData.text
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }

      const data = await response.json();
      const generatedResponse = data.choices[0].message.content;

      res.json({ 
        response: generatedResponse,
        authorHandle: tweetData.user?.username || tweetData.author_handle || ''
      });
    } catch (error) {
      console.error("Error generating test response:", error);
      res.status(500).json({ error: "Failed to generate response" });
    }
  });

  // Generate tweet responses using OpenRouter
  app.post("/api/generate-tweet-response", async (req, res) => {
    try {
      // Use token bucket rate limiter
      try {
        await rateLimiter.acquire('openrouter');
      } catch (rateLimitError) {
        return res.status(429).json({ 
          error: "Rate limit exceeded. Please wait a moment before trying again.",
          retryAfter: 5
        });
      }

      const { tweetText, customSystemPrompt } = req.body;
      
      if (!tweetText) {
        return res.status(400).json({ error: "Tweet text is required" });
      }

      const defaultSystemPrompt = `You are a hilarious charismatic personality that responds to tweets to promote $vaj coin - you often use innuendo of vaj or $vaj implying vagina ie 'pump vaj' or 'bust $vaj open' etc (those are just examples of the type of sexual innuendo)

**IMPORTANT- never use the word 'buy' instead use 'ape' or 'grab'
never use a '$' unless it is for '$vaj' ---- never say '$nephew' - if you see a $ used elsewhere in your response besides $vaj, then REDO your response-

do not say 'dick' 'penis' or 'balls' or 'cock' or any euphamism for male genitals

------------

When you receive the text of an input tweet, respond with a funny tweet based on the A B call and response examples below - usually include $vaj or vaj in your response, but not always

Other themes to sometimes incorporate = that vaj is a timeless subject that has captivated humanity for centuries (ie humanity has been fixated on vagina for centuries)

Vagina related language like 'grip' 'grab' 'squirt' 'bounce' 'spin'

only say 'nephew' very rarely even though it appears in many of the examples below

Sometimes (but rarely) discuss the long term vision of the coin being tied to the world's first AI tv show and link to this twitter post referring to it as the 'vaj thesis' - make sure any time the thesis is mentioned ALWAYS include the link below
https://x.com/vaj_mindpalace/status/1950292679155188089

Your responses should all be very short and punchy 1-3 sentences MAXIMUM but usually under 1 sentence 

Only include the response in the output, do not include the a. b. format- that is only to show you example call and response pairs

Do not be corny- always be unhinged, ** do not use any punctuation**, do not make corny jokes about 'exes' or 'rebounds' you should occasionally be lewd but not always

other language to occasionally include:
splish splash
splashy
gushie
ushie gushie
gushy
splat

*never use punctuation 
* never say 'meme coins' or 'memecoins'
never say the following words:
flops
flop
style`;

      // Use custom prompt from request, or load saved prompt from DB, or fall back to default
      let systemPrompt = customSystemPrompt;
      if (!systemPrompt) {
        const storage = await getStorage();
        const aiConfig = await storage.getAiConfig();
        systemPrompt = aiConfig?.systemPrompt || defaultSystemPrompt;
      }

      // Call OpenRouter API
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://twitter-cashtag-analyzer.replit.app",
          "X-Title": "Twitter Cashtag Analyzer"
        },
        body: JSON.stringify({
          model: "moonshotai/kimi-k2-0905",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user", 
              content: tweetText
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
      }

      const data = await response.json();
      const generatedResponse = data.choices[0]?.message?.content || "Failed to generate response";

      res.json({ response: generatedResponse });
    } catch (error) {
      console.error("Error generating tweet response:", error);
      res.status(500).json({ error: "Failed to generate tweet response" });
    }
  });

  // Object storage routes using official @replit/object-storage client
  // replitStorageClient is imported from objectStorage.ts (initialized with DEFAULT_OBJECT_STORAGE_BUCKET_ID)
  
  // Direct upload endpoint - stores images in database for reliable serving
  // Note: Object Storage is currently broken (auth issues on download), so we use database storage
  app.post("/api/objects/upload-direct", async (req, res) => {
    try {
      const { fileData, fileName, mimeType } = req.body;
      
      if (!fileData || !fileName || !mimeType) {
        return res.status(400).json({ error: "fileData (base64), fileName, and mimeType are required" });
      }
      
      const storage = await getStorage();
      
      // Generate unique ID and build URL
      const tempId = randomUUID();
      const imageUrl = buildFullPublicUrl(`/api/images/${tempId}`);
      
      // Store in database with base64 data
      const replyImage = await storage.createReplyImageWithId(tempId, {
        imageData: fileData,
        imageUrl: imageUrl,
        fileName: fileName,
        mimeType: mimeType
      });
      
      console.log(`[ImageUpload] Stored in database: ${replyImage.id}, URL: ${imageUrl}`);
      
      res.json({
        id: replyImage.id,
        imageUrl: imageUrl,
        fileName: replyImage.fileName,
        mimeType: replyImage.mimeType
      });
    } catch (error: any) {
      console.error("Error storing image:", error);
      console.error("Error details:", error?.message, error?.stack);
      res.status(500).json({ error: "Failed to store image", details: error?.message });
    }
  });
  
  // Serve images from database
  app.get("/api/images/:id", async (req, res) => {
    try {
      const storage = await getStorage();
      const requestedId = req.params.id;
      
      // Fetch single image by ID (avoids loading all images into memory)
      const image = await storage.getReplyImageById(requestedId);
      
      if (!image || !image.imageData) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      const buffer = Buffer.from(image.imageData, 'base64');
      res.set('Content-Type', image.mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch (error) {
      console.error("Error serving image:", error);
      res.status(500).json({ error: "Failed to serve image" });
    }
  });
  
  // Legacy presigned URL endpoint (kept for compatibility, but might fail)
  app.post("/api/objects/upload", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Serve public objects from Object Storage (reply images use this)
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    console.log(`[ObjectStorage] Serving file: ${filePath}, replitStorageClient: ${replitStorageClient ? 'available' : 'null'}`);
    
    try {
      // Use Replit Object Storage client (preferred)
      if (replitStorageClient) {
        try {
          console.log(`[ObjectStorage] Downloading via Replit client: ${filePath}`);
          const result = await replitStorageClient.downloadAsBytes(filePath);
          console.log(`[ObjectStorage] Download result ok: ${result.ok}`);
          
          if (result.ok) {
            const data = result.value[0];
            console.log(`[ObjectStorage] Got ${data.length} bytes`);
            
            // Determine content type from extension
            const ext = filePath.split('.').pop()?.toLowerCase() || '';
            const contentTypes: Record<string, string> = {
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'svg': 'image/svg+xml',
            };
            const contentType = contentTypes[ext] || 'application/octet-stream';
            
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.send(data);
          } else {
            // Result is not ok - log the error
            console.log(`[ObjectStorage] Replit download failed:`, (result as any).error || 'Unknown error');
          }
        } catch (replitError: any) {
          console.log(`[ObjectStorage] Replit client exception for ${filePath}:`, replitError?.message);
        }
        // If we got here, Replit client failed - return 404 instead of falling back to legacy
        return res.status(404).json({ error: "File not found in Object Storage" });
      }
      
      // Fallback to legacy ObjectStorageService
      const objectStorageService = new ObjectStorageService();
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error serving public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Serve uploaded images publicly using @replit/object-storage
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectPath = req.params.objectPath;
      
      // Try using the official Replit client first
      if (replitStorageClient) {
        try {
          const result = await replitStorageClient.downloadAsBytes(objectPath);
          
          // Check if result is successful (Result type from @replit/object-storage)
          if (result.ok) {
            // result.value is a tuple [Buffer], get the first element
            const data = result.value[0];
            
            // Determine content type from extension
            const ext = objectPath.split('.').pop()?.toLowerCase();
            const contentTypes: Record<string, string> = {
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'gif': 'image/gif',
              'webp': 'image/webp',
              'svg': 'image/svg+xml'
            };
            
            res.set('Content-Type', contentTypes[ext || ''] || 'application/octet-stream');
            res.set('Cache-Control', 'public, max-age=3600');
            res.send(data);
            return;
          }
          throw result.error;
        } catch (replitErr) {
          console.log("Replit client failed, trying GCS client:", replitErr);
        }
      }
      
      // Fallback to old GCS-based approach
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      return res.sendStatus(500);
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
