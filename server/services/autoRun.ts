import { jobManager, Job } from './jobManager';
import { searchQueue } from './searchQueue';
import { replyQueue } from './replyQueue';
import { getStorage } from '../storage';
import { OpenRouterService } from './openrouter';
import { EventEmitter } from 'events';

export type AutoRunStatus = 'idle' | 'searching' | 'generating_replies' | 'sending_replies' | 'sending_raid_replies' | 'completed' | 'paused' | 'cancelled' | 'failed';

interface AutoRunState {
  status: AutoRunStatus;
  searchJobId?: string;
  currentStep: string;
  progress: {
    tweetsFound: number;
    repliesGenerated: number;
    repliesSent: number;
    repliesFailed: number;
    raidRepliesSent: number;
    raidRepliesFailed: number;
    totalToProcess: number;
  };
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  replyJobIds: string[];
  raidReplyJobIds: string[];
  sentReplyUrls: string[];
  completedRaidReplyUrls: string[]; // Track completed raid URLs for cross-liking
  recentErrors: string[]; // Track last few error messages for UI display
}

interface AutoRunConfig {
  searchParams: any;
  cashtags: string[];
  username: string;
  maxTweets: number;
  replyDelayRange: { min: number; max: number };
  raidReplyDelayRange?: { min: number; max: number }; // Optional: separate delay for raid replies (defaults to replyDelayRange)
  dmDelayRange: { min: number; max: number };
  sendDm: boolean;
  raidRounds?: number; // Number of raid reply rounds (2-4), defaults to 2
}

class AutoRunService extends EventEmitter {
  private state: AutoRunState = {
    status: 'idle',
    currentStep: 'Ready',
    progress: {
      tweetsFound: 0,
      repliesGenerated: 0,
      repliesSent: 0,
      repliesFailed: 0,
      raidRepliesSent: 0,
      raidRepliesFailed: 0,
      totalToProcess: 0
    },
    replyJobIds: [],
    raidReplyJobIds: [],
    sentReplyUrls: [],
    completedRaidReplyUrls: [],
    recentErrors: []
  };

  private openRouterService: OpenRouterService;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;

  constructor() {
    super();
    this.openRouterService = new OpenRouterService();
    this.setupJobListeners();
  }

  private setupJobListeners() {
    jobManager.on('job:completed', (job: Job) => {
      if (job.type === 'reply') {
        if (this.state.replyJobIds.includes(job.id)) {
          this.state.progress.repliesSent++;
          // Collect the reply URL for raid replies
          if (job.result?.replyUrl) {
            this.state.sentReplyUrls.push(job.result.replyUrl);
          }
          this.emitStateChange();
        } else if (this.state.raidReplyJobIds.includes(job.id)) {
          this.state.progress.raidRepliesSent++;
          this.emitStateChange();
        }
      }
    });

    jobManager.on('job:failed', (job: Job) => {
      if (job.type === 'reply') {
        // Capture the error message for UI display (keep last 5 errors)
        const errorMsg = job.error || 'Unknown error';
        if (this.state.recentErrors.length >= 5) {
          this.state.recentErrors.shift(); // Remove oldest
        }
        this.state.recentErrors.push(errorMsg);
        
        if (this.state.replyJobIds.includes(job.id)) {
          this.state.progress.repliesFailed++;
          this.emitStateChange();
        } else if (this.state.raidReplyJobIds.includes(job.id)) {
          this.state.progress.raidRepliesFailed++;
          this.emitStateChange();
        }
      }
    });
  }

  getState(): AutoRunState {
    return { ...this.state };
  }

  private emitStateChange() {
    this.emit('state:change', this.getState());
  }

  private updateState(updates: Partial<AutoRunState>) {
    Object.assign(this.state, updates);
    this.emitStateChange();
  }

  async start(config: AutoRunConfig): Promise<void> {
    if (this.state.status !== 'idle' && this.state.status !== 'completed' && 
        this.state.status !== 'cancelled' && this.state.status !== 'failed') {
      throw new Error('Auto-run already in progress');
    }

    this.isPaused = false;
    this.isCancelled = false;

    // Normalize cashtags exactly like the manual /api/search route does
    // Remove $ prefix, trim whitespace, filter empty strings
    const normalizedCashtags = config.cashtags
      .filter((tag): tag is string => tag !== undefined && tag.trim().length > 0)
      .map(tag => tag.trim().startsWith('$') ? tag.trim().substring(1) : tag.trim())
      .filter(tag => tag.length > 0);

    if (normalizedCashtags.length === 0) {
      throw new Error('At least one valid cashtag is required');
    }

    console.log(`[AutoRun] Starting with normalized cashtags: ${normalizedCashtags.join(', ')}`);

    this.state = {
      status: 'searching',
      currentStep: 'Searching for tweets...',
      progress: {
        tweetsFound: 0,
        repliesGenerated: 0,
        repliesSent: 0,
        repliesFailed: 0,
        raidRepliesSent: 0,
        raidRepliesFailed: 0,
        totalToProcess: 0
      },
      startedAt: new Date(),
      replyJobIds: [],
      raidReplyJobIds: [],
      sentReplyUrls: [],
      recentErrors: []
    };
    this.emitStateChange();

    try {
      const storage = await getStorage();
      const search = await storage.createTweetSearch({
        cashtag: normalizedCashtags.join(", "),
        minFollowers: config.searchParams.minFollowers,
        maxFollowers: config.searchParams.maxFollowers,
        timeRange: config.searchParams.timeRange || '1h',
        maxResults: parseInt(config.searchParams.maxResults || '100'),
        excludeRetweets: config.searchParams.excludeRetweets ?? true,
        verifiedOnly: config.searchParams.verifiedOnly ?? false
      });

      const searchJob = await searchQueue.queueSearch({
        searchId: search.id,
        cashtags: normalizedCashtags,
        params: config.searchParams
      });

      this.state.searchJobId = searchJob.id;
      this.emitStateChange();

      await this.waitForSearchCompletion(searchJob.id, search.id);

      if (this.isCancelled) {
        this.updateState({ status: 'cancelled', currentStep: 'Cancelled by user' });
        return;
      }

      const filteredHandlesData = await storage.getFilteredHandles();
      const filteredHandles = new Set<string>();
      if (filteredHandlesData?.handles) {
        filteredHandlesData.handles
          .split(/[\s,\n]+/)
          .map(h => h.trim().replace(/^@/, '').toLowerCase())
          .filter(h => h.length > 0)
          .forEach(h => filteredHandles.add(h));
      }

      let allTweets = await storage.getTweetsBySearchId(search.id);

      // NEW: Wait for classification to complete before proceeding
      let unclassifiedCount = allTweets.filter(t => t.isBot === null).length;
      if (unclassifiedCount > 0) {
        console.log(`[AutoRun] Waiting for ${unclassifiedCount} tweets to be classified...`);

        // Poll faster (500ms) for up to 30 seconds total
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          allTweets = await storage.getTweetsBySearchId(search.id);
          const stillUnclassified = allTweets.filter(t => t.isBot === null).length;

          if (stillUnclassified === 0) {
            console.log(`[AutoRun] All tweets classified!`);
            break;
          } else if (i === 59) {
            console.log(`[AutoRun] Timeout waiting for classification, proceeding with ${stillUnclassified} unclassified`);
          }
        }
      }

      // Filter tweets that are explicitly marked as NON-bots (isBot === false)
      const nonBotTweets = allTweets
        .filter(tweet => tweet.isBot === false) // NEW: Only include verified non-bots
        .filter(tweet => !filteredHandles.has(tweet.authorHandle.toLowerCase()))
        .sort((a, b) => b.authorFollowers - a.authorFollowers)
        .slice(0, config.maxTweets);

      this.updateState({
        currentStep: `Found ${nonBotTweets.length} tweets to reply to`,
        progress: { ...this.state.progress, tweetsFound: nonBotTweets.length, totalToProcess: nonBotTweets.length }
      });

      if (nonBotTweets.length === 0) {
        this.updateState({
          status: 'completed',
          currentStep: 'No qualifying tweets found',
          completedAt: new Date()
        });
        return;
      }

      if (this.isPaused) {
        this.updateState({ status: 'paused', currentStep: 'Paused before generating replies' });
        return;
      }

      this.updateState({ status: 'generating_replies', currentStep: 'Generating AI replies...' });

      const aiConfig = await storage.getAiConfig();
      const systemPrompt = aiConfig?.systemPrompt || '';

      const repliesData: Array<{
        tweetId: string;
        replyText: string;
        username: string;
        tweetUrl: string;
        authorHandle: string;
      }> = [];

      // Generate replies in parallel batches for speed while respecting rate limits
      const BATCH_SIZE = 5;
      for (let batchStart = 0; batchStart < nonBotTweets.length; batchStart += BATCH_SIZE) {
        if (this.isCancelled) {
          this.updateState({ status: 'cancelled', currentStep: 'Cancelled by user' });
          return;
        }

        if (this.isPaused) {
          this.updateState({ status: 'paused', currentStep: `Paused after generating ${repliesData.length} replies` });
          return;
        }

        const batch = nonBotTweets.slice(batchStart, batchStart + BATCH_SIZE);

        // Process batch in parallel
        const batchPromises = batch.map(async (tweet) => {
          try {
            const generatedReply = await this.openRouterService.generateReply(tweet.content, systemPrompt);
            return {
              tweetId: tweet.tweetId,
              replyText: generatedReply,
              username: config.username,
              tweetUrl: tweet.url,
              authorHandle: tweet.authorHandle
            };
          } catch (error) {
            console.error(`Failed to generate reply for tweet ${tweet.tweetId}:`, error);
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);

        // Add successful results
        for (const result of batchResults) {
          if (result) {
            repliesData.push(result);
            this.state.progress.repliesGenerated++;
          }
        }

        this.updateState({
          currentStep: `Generated ${repliesData.length}/${nonBotTweets.length} replies`
        });
      }

      if (repliesData.length === 0) {
        this.updateState({
          status: 'completed',
          currentStep: 'Failed to generate any replies',
          completedAt: new Date()
        });
        return;
      }

      this.updateState({
        status: 'sending_replies',
        currentStep: `Queuing ${repliesData.length} replies...`
      });

      // PHASE 1: Queue primary replies with proper spacing to prevent concurrent execution
      // TwexAPI replies are fast (~5-15s) since they're API-based, not browser-based
      // We add execution time estimate + random delay to ensure no overlap
      const ESTIMATED_REPLY_TIME = 20; // seconds - TwexAPI is much faster than browser automation
      let cumulativeDelay = 0;

      const jobs = [];
      for (let i = 0; i < repliesData.length; i++) {
        const reply = repliesData[i];

        // First reply executes immediately, subsequent ones wait for:
        // - Previous reply to complete (ESTIMATED_REPLY_TIME)
        // - Random human-like delay (replyDelayRange)
        if (i > 0) {
          const randomDelay = this.getRandomDelay(config.replyDelayRange.min, config.replyDelayRange.max);
          cumulativeDelay += ESTIMATED_REPLY_TIME + randomDelay;
          console.log(`[AutoRun] Reply ${i + 1} scheduled for +${cumulativeDelay}s (${ESTIMATED_REPLY_TIME}s exec + ${randomDelay}s delay)`);
        }

        const job = await replyQueue.queueReply({
          tweetId: reply.tweetId,
          replyText: reply.replyText,
          username: reply.username,
          tweetUrl: reply.tweetUrl,
          authorHandle: reply.authorHandle,
          delaySeconds: cumulativeDelay,
          sendDm: config.sendDm,
          dmDelaySeconds: config.sendDm ? this.getRandomDelay(config.dmDelayRange.min, config.dmDelayRange.max) : 0,
          alsoLikeTweet: true
        });

        jobs.push(job);
      }

      this.state.replyJobIds = jobs.map(j => j.id);
      this.updateState({
        currentStep: `${repliesData.length} replies queued - executing with delays`,
        progress: { ...this.state.progress, totalToProcess: repliesData.length }
      });

      await this.waitForAllReplies();

      if (this.isCancelled) {
        this.updateState({ status: 'cancelled', currentStep: 'Cancelled by user' });
        return;
      }

      // ========== RAID REPLIES PHASE ==========
      // After primary replies, send raid replies from other accounts
      const sentReplyUrls = this.state.sentReplyUrls;
      const raidRounds = config.raidRounds ?? 2; // Default to 2 rounds
      
      if (sentReplyUrls.length > 0) {
        // Get all available accounts that can be randomly selected for raid replies
        const allAccounts = await storage.getAllTwitterSettings();
        const otherAccounts = allAccounts.filter(acc => 
          acc.username.toLowerCase() !== config.username.toLowerCase() && 
          acc.twitterCookie && // Must have a cookie configured
          acc.isAvailableForRandom !== false // Must be available for random selection (default true if null)
        );

        if (otherAccounts.length >= 1) {
          // IMPORTANT: Cap raid rounds to the number of available accounts
          // This ensures each account only replies once per primary tweet (no duplicates)
          const actualRaidRounds = Math.min(raidRounds, otherAccounts.length);
          
          if (actualRaidRounds < raidRounds) {
            console.log(`[AutoRun] Capping raid rounds from ${raidRounds} to ${actualRaidRounds} (only ${otherAccounts.length} accounts available)`);
          }
          
          console.log(`[AutoRun] Starting ${actualRaidRounds} raid reply rounds with ${otherAccounts.length} available accounts`);
          
          // Track used accounts - NEVER allow same account to reply twice
          const usedAccounts: string[] = [];
          
          for (let round = 1; round <= actualRaidRounds; round++) {
            if (this.isCancelled) {
              this.updateState({ status: 'cancelled', currentStep: 'Cancelled by user' });
              return;
            }
            
            // Get accounts not yet used in this run
            const availableForRound = otherAccounts.filter(acc => 
              !usedAccounts.includes(acc.username.toLowerCase())
            );
            
            // Safety check - should never happen since we capped rounds
            if (availableForRound.length === 0) {
              console.log(`[AutoRun] No more unused accounts available, stopping raid replies`);
              break;
            }
            
            const raidAccount = availableForRound[Math.floor(Math.random() * availableForRound.length)];
            usedAccounts.push(raidAccount.username.toLowerCase());
            
            console.log(`[AutoRun] Starting raid replies round ${round}/${actualRaidRounds} from @${raidAccount.username}`);
            
            this.updateState({
              status: 'sending_raid_replies',
              currentStep: `Raid round ${round}/${actualRaidRounds}: Generating replies from @${raidAccount.username}...`
            });

            await this.sendRaidReplies(sentReplyUrls, raidAccount.username, systemPrompt, config.raidReplyDelayRange || config.replyDelayRange, round);
          }
        } else {
          console.log(`[AutoRun] No other accounts available for raid replies`);
        }
      }

      this.updateState({
        status: 'completed',
        currentStep: `Completed: ${this.state.progress.repliesSent} primary, ${this.state.progress.raidRepliesSent} raid sent`,
        completedAt: new Date()
      });

    } catch (error: any) {
      console.error('Auto-run failed:', error);
      this.updateState({
        status: 'failed',
        currentStep: 'Auto-run failed',
        error: error.message || 'Unknown error',
        completedAt: new Date()
      });
    }
  }

  private async sendRaidReplies(
    replyUrls: string[],
    username: string,
    systemPrompt: string,
    replyDelayRange: { min: number; max: number },
    round: number
  ): Promise<void> {
    const raidRepliesData: Array<{
      tweetId: string;
      replyText: string;
      username: string;
      tweetUrl: string;
      authorHandle: string;
    }> = [];

    // Generate replies for each URL
    for (let i = 0; i < replyUrls.length; i++) {
      if (this.isCancelled) return;

      const url = replyUrls[i];
      // Extract tweet ID from URL (e.g., https://x.com/user/status/123456)
      const tweetIdMatch = url.match(/status\/(\d+)/);
      if (!tweetIdMatch) continue;

      const tweetId = tweetIdMatch[1];

      try {
        // Fetch tweet content
        const tweetContent = await this.fetchTweetContent(tweetId);
        if (!tweetContent) continue;

        // Generate reply
        const generatedReply = await this.openRouterService.generateReply(tweetContent, systemPrompt);

        raidRepliesData.push({
          tweetId,
          replyText: generatedReply,
          username,
          tweetUrl: url,
          authorHandle: '' // We're replying to our own tweets
        });

        this.updateState({
          currentStep: `Raid ${round}: Generated ${i + 1}/${replyUrls.length} replies for @${username}`
        });
      } catch (error) {
        console.error(`[AutoRun] Failed to generate raid reply for ${url}:`, error);
      }
    }

    if (raidRepliesData.length === 0) {
      console.log(`[AutoRun] No raid replies generated for round ${round}`);
      return;
    }

    // Queue raid replies with proper spacing to prevent concurrent execution
    const ESTIMATED_REPLY_TIME = 20; // seconds - TwexAPI is fast
    let cumulativeDelay = 0;

    const jobs = [];
    for (let i = 0; i < raidRepliesData.length; i++) {
      if (i > 0) {
        const randomDelay = this.getRandomDelay(replyDelayRange.min, replyDelayRange.max);
        cumulativeDelay += ESTIMATED_REPLY_TIME + randomDelay;
        console.log(`[AutoRun] Raid reply ${i + 1} scheduled for +${cumulativeDelay}s`);
      }

      const job = await replyQueue.queueReply({
        ...raidRepliesData[i],
        delaySeconds: cumulativeDelay,
        sendDm: false,
        dmDelaySeconds: 0,
        alsoLikeTweet: true
      });

      jobs.push(job);
    }

    // Add to raid job tracking
    this.state.raidReplyJobIds.push(...jobs.map(j => j.id));
    this.updateState({
      currentStep: `Raid ${round}: ${raidRepliesData.length} replies queued from @${username}`
    });

    // Wait for raid replies to complete
    await this.waitForRaidReplies(jobs.map(j => j.id));
  }

  private async fetchTweetContent(tweetId: string): Promise<string | null> {
    try {
      const apiKey = process.env.TWITTERAPI_IO_KEY;
      if (!apiKey) {
        console.error('[AutoRun] TWITTERAPI_IO_KEY not configured');
        return null;
      }

      const response = await fetch(
        `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
        {
          headers: {
            'X-API-Key': apiKey
          }
        }
      );

      if (!response.ok) {
        console.error(`[AutoRun] Failed to fetch tweet ${tweetId}: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return data?.tweets?.[0]?.text || null;
    } catch (error) {
      console.error(`[AutoRun] Error fetching tweet ${tweetId}:`, error);
      return null;
    }
  }

  private async waitForSearchCompletion(jobId: string, searchId: string): Promise<void> {
    const storage = await getStorage();
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        if (this.isCancelled) {
          clearInterval(checkInterval);
          resolve();
          return;
        }

        const search = await storage.getTweetSearch(searchId);
        if (search?.status === 'completed' || search?.status === 'failed') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 2000);
    });
  }

  private async waitForAllReplies(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const completedOrFailed = this.state.progress.repliesSent + this.state.progress.repliesFailed;
        const total = this.state.replyJobIds.length;

        if (completedOrFailed >= total || this.isCancelled) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  private async waitForRaidReplies(jobIds: string[]): Promise<void> {
    return new Promise((resolve) => {
      let completed = 0;
      const total = jobIds.length;
      const processedJobIds = new Set<string>(); // Track which jobs we've already processed for cross-liking

      const checkInterval = setInterval(async () => {
        // Count completed/failed jobs from this batch
        completed = 0;
        for (const jobId of jobIds) {
          const job = jobManager.getJob(jobId);
          if (job && (job.status === 'completed' || job.status === 'failed')) {
            completed++;

            // CROSS-LIKING: Process newly completed raid jobs
            if (job.status === 'completed' && !processedJobIds.has(jobId) && job.result?.replyUrl) {
              processedJobIds.add(jobId);

              const replyUrl = job.result.replyUrl;
              const username = job.data.username;

              console.log(`[AutoRun] Raid completed by @${username}: ${replyUrl}`);

              // 72% chance to like each previous raid reply
              if (this.state.completedRaidReplyUrls.length > 0) {
                console.log(`[AutoRun] @${username} checking ${this.state.completedRaidReplyUrls.length} previous raids for cross-likes (72% chance each)`);

                for (const previousRaidUrl of this.state.completedRaidReplyUrls) {
                  if (Math.random() < 0.72) { // 72% chance
                    const likeDelay = Math.floor(Math.random() * 10) + 5; // 5-15 seconds
                    await replyQueue.queueLike({
                      tweetUrl: previousRaidUrl,
                      username: username,
                      delaySeconds: likeDelay
                    });
                    console.log(`[AutoRun] ❤️ Queued cross-like: @${username} will like previous raid in ${likeDelay}s`);
                  }
                }
              }

              // Add this raid's URL to the list for future raids to potentially like
              this.state.completedRaidReplyUrls.push(replyUrl);
            }
          }
        }

        if (completed >= total || this.isCancelled) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Generate random delay in seconds between min and max (inclusive)
   */
  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  pause(): void {
    if (this.state.status === 'searching' || this.state.status === 'generating_replies' || 
        this.state.status === 'sending_replies' || this.state.status === 'sending_raid_replies') {
      this.isPaused = true;
      this.updateState({ status: 'paused', currentStep: 'Pausing...' });
    }
  }

  resume(): void {
    if (this.state.status === 'paused') {
      this.isPaused = false;
      this.updateState({ currentStep: 'Resuming...' });
    }
  }

  cancel(): void {
    this.isCancelled = true;
    
    // Cancel primary reply jobs
    for (const jobId of this.state.replyJobIds) {
      const job = jobManager.getJob(jobId);
      if (job && (job.status === 'pending' || job.status === 'scheduled')) {
        jobManager.cancelJob(jobId);
      }
    }

    // Cancel raid reply jobs
    for (const jobId of this.state.raidReplyJobIds) {
      const job = jobManager.getJob(jobId);
      if (job && (job.status === 'pending' || job.status === 'scheduled')) {
        jobManager.cancelJob(jobId);
      }
    }

    this.updateState({
      status: 'cancelled',
      currentStep: 'Cancelled by user',
      completedAt: new Date()
    });
  }

  reset(): void {
    this.state = {
      status: 'idle',
      currentStep: 'Ready',
      progress: {
        tweetsFound: 0,
        repliesGenerated: 0,
        repliesSent: 0,
        repliesFailed: 0,
        raidRepliesSent: 0,
        raidRepliesFailed: 0,
        totalToProcess: 0
      },
      replyJobIds: [],
      raidReplyJobIds: [],
      sentReplyUrls: [],
      recentErrors: []
    };
    this.isPaused = false;
    this.isCancelled = false;
    this.emitStateChange();
  }
}

export const autoRunService = new AutoRunService();
