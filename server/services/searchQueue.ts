import { jobManager, Job, SearchJobData } from './jobManager';
import { getStorage } from '../storage';
import { TwitterService } from './twitter';
import { OpenRouterService } from './openrouter';
import { rateLimiter } from './rateLimiter';

class SearchQueue {
  private openRouterService: OpenRouterService;

  constructor() {
    this.openRouterService = new OpenRouterService();
    this.setupListeners();
  }

  private setupListeners() {
    jobManager.on('job:started', async (job: Job) => {
      if (job.type === 'search') {
        await this.processSearch(job);
      }
    });
  }

  async queueSearch(data: SearchJobData): Promise<Job> {
    const job = jobManager.createJob('search', data, 0);
    return job;
  }

  private async processSearch(job: Job): Promise<void> {
    const data = job.data as SearchJobData;
    const { searchId, cashtags, params } = data;

    const storage = await getStorage();
    
    try {
      await storage.updateTweetSearchStatus(searchId, "processing");
      jobManager.updateJobProgress(job.id, 0, cashtags.length, 'Starting search...');

      if (!process.env.TWITTERAPI_IO_KEY) {
        throw new Error("TWITTERAPI_IO_KEY environment variable is required for searching");
      }
      const twitterService = new TwitterService();

      console.log(`[SearchQueue] Starting parallel search for ${cashtags.length} cashtags: ${cashtags.join(', ')}`);

      let completedCashtags = 0;
      const searchPromises = cashtags.map(async (cashtag) => {
        try {
          await rateLimiter.acquire('twitterapi');
          console.log(`[SearchQueue] Searching for cashtag: ${cashtag}`);
          
          const rawTweets = await twitterService.searchTweets(cashtag, {
            timeRange: params.timeRange,
            maxResults: parseInt(params.maxResults),
            excludeRetweets: params.excludeRetweets,
            verifiedOnly: params.verifiedOnly
          });

          const followerFilteredTweets = await twitterService.filterByFollowerCount(
            rawTweets.map(tweet => ({ ...tweet, sourceHashtag: cashtag })),
            params.minFollowers,
            params.maxFollowers
          );

          if (followerFilteredTweets.length === 0) {
            console.log(`[SearchQueue] No tweets found for cashtag: ${cashtag}`);
            completedCashtags++;
            jobManager.updateJobProgress(job.id, completedCashtags, cashtags.length, `Searched ${cashtag}`);
            return [];
          }

          console.log(`[SearchQueue] Analyzing ${followerFilteredTweets.length} tweets for cashtag: ${cashtag}`);
          const botAnalyses = await this.openRouterService.batchAnalyzeTweets(followerFilteredTweets);
          
          const tweetsWithAnalysis = followerFilteredTweets.map(tweet => {
            const analysis = botAnalyses.get(tweet.tweetId);
            return {
              ...tweet,
              isBot: analysis?.isBot ?? null,
              botAnalysis: analysis ?? null
            };
          });

          completedCashtags++;
          jobManager.updateJobProgress(job.id, completedCashtags, cashtags.length, `Analyzed ${cashtag}`);
          console.log(`[SearchQueue] Completed analysis for cashtag: ${cashtag}`);
          return tweetsWithAnalysis;
        } catch (error) {
          console.error(`[SearchQueue] Error processing cashtag ${cashtag}:`, error);
          completedCashtags++;
          jobManager.updateJobProgress(job.id, completedCashtags, cashtags.length, `Failed ${cashtag}`);
          return [];
        }
      });

      const results = await Promise.all(searchPromises);
      const allAnalyzedTweets = results.flat();

      if (allAnalyzedTweets.length === 0) {
        await storage.updateTweetSearchStatus(searchId, "completed");
        jobManager.completeJob(job.id, { tweetsFound: 0 });
        return;
      }

      const uniqueTweets: any[] = [];
      const seenTweetIds = new Set<string>();
      for (const tweet of allAnalyzedTweets) {
        if (!seenTweetIds.has(tweet.tweetId)) {
          seenTweetIds.add(tweet.tweetId);
          uniqueTweets.push(tweet);
        } else {
          const existingIndex = uniqueTweets.findIndex(t => t.tweetId === tweet.tweetId);
          if (existingIndex >= 0 && uniqueTweets[existingIndex].botAnalysis === null && tweet.botAnalysis !== null) {
            uniqueTweets[existingIndex] = tweet;
          }
        }
      }

      uniqueTweets.sort((a, b) => b.authorFollowers - a.authorFollowers);

      const batchSize = 10;
      for (let i = 0; i < uniqueTweets.length; i += batchSize) {
        const batch = uniqueTweets.slice(i, i + batchSize);
        await Promise.all(batch.map(tweet => 
          storage.createTweet({ searchId, ...tweet }).catch(err => {
            console.warn(`[SearchQueue] Failed to store tweet ${tweet.tweetId}:`, err.message);
          })
        ));
      }

      console.log(`[SearchQueue] Search completed: ${uniqueTweets.length} total tweets from ${cashtags.length} cashtags`);
      console.log(`[SearchQueue] Analyzed tweets: ${uniqueTweets.filter(t => t.botAnalysis !== null).length}`);
      console.log(`[SearchQueue] Non-bot tweets: ${uniqueTweets.filter(t => t.isBot === false).length}`);
      
      await storage.updateTweetSearchStatus(searchId, "completed");
      jobManager.completeJob(job.id, { 
        tweetsFound: uniqueTweets.length,
        analyzed: uniqueTweets.filter(t => t.botAnalysis !== null).length,
        nonBots: uniqueTweets.filter(t => t.isBot === false).length
      });

    } catch (error: any) {
      console.error("[SearchQueue] Processing error:", error);
      await storage.updateTweetSearchStatus(searchId, "failed");
      jobManager.failJob(job.id, error.message || 'Unknown error');
    }
  }
}

export const searchQueue = new SearchQueue();
