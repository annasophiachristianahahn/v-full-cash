import { type TweetSearch, type InsertTweetSearch, type Tweet, type InsertTweet, type RecommendedCashtag, type InsertRecommendedCashtag, type PinnedTrendingToken, type InsertPinnedTrendingToken, type TwitterSettings, type InsertTwitterSettings, type AiConfig, type InsertAiConfig, type ReplyImage, type InsertReplyImage, type FilteredHandles, type InsertFilteredHandles, type ScheduledRun, type InsertScheduledRun, type OrganicActivity, type InsertOrganicActivity, type OrganicActivitySchedule, type InsertOrganicActivitySchedule, type FollowingCache, type InsertFollowingCache, tweetSearches, tweets, recommendedCashtags, pinnedTrendingTokens, twitterSettings, aiConfig, replyImages, filteredHandles, scheduledRuns, organicActivity, organicActivitySchedule, followingCache, appSettings } from "@shared/schema";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";

export interface IStorage {
  // Tweet searches
  createTweetSearch(search: InsertTweetSearch): Promise<TweetSearch>;
  getTweetSearch(id: string): Promise<TweetSearch | undefined>;
  updateTweetSearchStatus(id: string, status: string): Promise<void>;
  
  // Tweets
  createTweet(tweet: InsertTweet): Promise<Tweet>;
  getTweetsBySearchId(searchId: string): Promise<Tweet[]>;
  updateTweetBotStatus(tweetId: string, isBot: boolean, analysis?: any): Promise<void>;

  // Recommended cashtags
  getRecommendedCashtags(): Promise<RecommendedCashtag[]>;
  createRecommendedCashtag(cashtag: InsertRecommendedCashtag): Promise<RecommendedCashtag>;
  updateRecommendedCashtag(symbol: string, cashtag: InsertRecommendedCashtag): Promise<void>;
  deleteRecommendedCashtag(symbol: string): Promise<void>;
  toggleRecommendedCashtagPinned(symbol: string, isPinned: boolean): Promise<void>;
  getPinnedRecommendedCashtags(): Promise<RecommendedCashtag[]>;

  // Pinned trending tokens
  getPinnedTrendingTokens(): Promise<PinnedTrendingToken[]>;
  addPinnedTrendingToken(symbol: string): Promise<PinnedTrendingToken>;
  removePinnedTrendingToken(symbol: string): Promise<void>;
  isPinnedTrendingToken(symbol: string): Promise<boolean>;

  // Twitter settings
  getTwitterSettings(): Promise<TwitterSettings | undefined>; // Get active settings
  getTwitterSettingsByUsername(username: string): Promise<TwitterSettings | undefined>; // Get settings by username
  getAllTwitterSettings(): Promise<TwitterSettings[]>; // Get all settings (for username list)
  createTwitterSettings(settings: InsertTwitterSettings): Promise<TwitterSettings>;
  updateTwitterSettings(id: string, settings: Partial<InsertTwitterSettings>): Promise<void>;
  updateTwitterSettingsLastUsed(id: string): Promise<void>;
  deleteTwitterSettings(id: string): Promise<void>;
  setActiveUsername(username: string): Promise<void>; // Switch active username

  // AI config
  getAiConfig(): Promise<AiConfig | undefined>;
  saveAiConfig(config: InsertAiConfig): Promise<AiConfig>;
  updateAiConfig(systemPrompt: string): Promise<void>;

  // Reply images
  createReplyImage(image: InsertReplyImage): Promise<ReplyImage>;
  createReplyImageWithId(id: string, image: InsertReplyImage): Promise<ReplyImage>;
  getAllReplyImages(): Promise<ReplyImage[]>;
  getReplyImageById(id: string): Promise<ReplyImage | undefined>;
  updateReplyImageUrl(id: string, imageUrl: string): Promise<void>;
  deleteReplyImage(id: string): Promise<void>;
  deleteAllReplyImages(): Promise<number>;
  getRandomReplyImage(): Promise<ReplyImage | undefined>;

  // Filtered handles
  getFilteredHandles(): Promise<FilteredHandles | undefined>;
  updateFilteredHandles(handles: string): Promise<void>;

  // Scheduled runs
  getAllScheduledRuns(): Promise<ScheduledRun[]>;
  getScheduledRun(id: string): Promise<ScheduledRun | undefined>;
  createScheduledRun(run: InsertScheduledRun): Promise<ScheduledRun>;
  updateScheduledRun(id: string, run: Partial<InsertScheduledRun>): Promise<void>;
  updateScheduledRunLastRun(id: string): Promise<void>;
  deleteScheduledRun(id: string): Promise<void>;

  // Organic activity
  createOrganicActivity(activity: InsertOrganicActivity): Promise<OrganicActivity>;
  getOrganicActivityByUsername(username: string, date: string): Promise<OrganicActivity[]>;
  
  // Organic activity schedule
  getOrganicActivitySchedule(username: string): Promise<OrganicActivitySchedule | undefined>;
  getAllOrganicActivitySchedules(): Promise<OrganicActivitySchedule[]>;
  createOrganicActivitySchedule(schedule: InsertOrganicActivitySchedule): Promise<OrganicActivitySchedule>;
  updateOrganicActivitySchedule(username: string, updates: Partial<InsertOrganicActivitySchedule>): Promise<void>;
  deleteOrganicActivitySchedule(username: string): Promise<void>;
  resetDailyLikesForAllAccounts(): Promise<void>;

  // Following cache
  getFollowingCache(username: string): Promise<FollowingCache[]>;
  shouldRefreshFollowingCache(username: string): Promise<boolean>;
  refreshFollowingCache(username: string, following: Array<{ userId: string; username: string; name: string }>): Promise<void>;
  getRandomFollowingUser(username: string): Promise<FollowingCache | undefined>;

  // App settings
  getAppSetting(key: string): Promise<string | null>;
  setAppSetting(key: string, value: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private db: any = null;

  private async getDb() {
    if (!this.db) {
      const { db } = await import("./db");
      this.db = db;
    }
    return this.db;
  }

  async initializeDefaultCashtags() {
    const db = await this.getDb();
    
    // Check if we already have recommended cashtags
    const existingCashtags = await db.select().from(recommendedCashtags).limit(1);
    if (existingCashtags.length > 0) {
      console.log("Recommended cashtags already exist, skipping initialization");
      return; // Already initialized
    }

    console.log("🚀 Starting initialization of recommended cashtags...");

    // Import DexScreener service to get real market data
    const { DexScreenerService } = await import("./services/dexscreener");
    const dexScreenerService = new DexScreenerService();

    // Use the user's originally specified cashtags
    const defaultSymbols = ["XAVIER", "TOKABU", "MD", "CRYPTO", "FINANCE", "KORI", "UFD", "MINI", "USDUC", "DCA", "SIGMA"];
    
    try {
      console.log(`📊 Fetching market data for ${defaultSymbols.length} symbols: ${defaultSymbols.join(', ')}`);
      // Fetch real market data for the specified symbols
      const tokensData = await dexScreenerService.getTokensDataBySymbols(defaultSymbols);
      console.log(`✅ Received data for ${tokensData.size} tokens from API`);
      
      const defaultCashtags = [];
      for (const symbol of defaultSymbols) {
        const tokenData = tokensData.get(symbol);
        if (tokenData) {
          // Use real data from API
          defaultCashtags.push({
            symbol: tokenData.symbol,
            name: tokenData.name,
            marketCap: Math.floor(Math.min(tokenData.marketCap || 0, Number.MAX_SAFE_INTEGER)),
            volume24h: Math.floor(Math.min(tokenData.volume24h || 0, Number.MAX_SAFE_INTEGER)),
            priceChange24h: Math.round((tokenData.priceChange24h || 0) * 100),
            icon: tokenData.icon
          });
        } else {
          // Fallback to basic data if token not found on DexScreener
          console.warn(`Could not fetch real data for ${symbol}, using fallback`);
          defaultCashtags.push({
            symbol: symbol,
            name: `${symbol} Token`,
            marketCap: 0,
            volume24h: 0,
            priceChange24h: 0,
            icon: null
          });
        }
      }

      if (defaultCashtags.length > 0) {
        await db.insert(recommendedCashtags).values(defaultCashtags);
        console.log(`Initialized ${defaultCashtags.length} recommended cashtags with real market data`);
      } else {
        console.warn("No real market data could be fetched, initializing empty");
      }
    } catch (error) {
      console.error("Error fetching real market data for default cashtags:", error);
      // Fallback to empty list if API completely fails
    }
  }

  async initializeTwitterSettings() {
    const db = await this.getDb();
    
    // Check if we already have Twitter settings
    const existingSettings = await db.select().from(twitterSettings).limit(1);
    if (existingSettings.length > 0) {
      console.log("Twitter settings already exist, skipping initialization");
      return;
    }

    console.log("🚀 Initializing Twitter settings with default users...");
    
    // Get the current Twitter cookie from environment (if exists)
    const currentCookie = process.env.TWITTER_COOKIE || null;
    
    // Create two users: vajme (with current cookie) and dozer (empty)
    await db.insert(twitterSettings).values([
      {
        username: 'vajme',
        twitterCookie: currentCookie,
        isActive: true, // vajme is active by default
        lastUsed: null,
      },
      {
        username: 'dozer',
        twitterCookie: null,
        isActive: false,
        lastUsed: null,
      }
    ]);
    
    console.log("✅ Initialized Twitter settings with users: vajme (active), dozer (inactive)");
  }

  async createTweetSearch(insertSearch: InsertTweetSearch): Promise<TweetSearch> {
    const db = await this.getDb();
    const [search] = await db.insert(tweetSearches).values(insertSearch).returning();
    return search;
  }

  async getTweetSearch(id: string): Promise<TweetSearch | undefined> {
    const db = await this.getDb();
    const [search] = await db.select().from(tweetSearches).where(eq(tweetSearches.id, id));
    return search;
  }

  async updateTweetSearchStatus(id: string, status: string): Promise<void> {
    const db = await this.getDb();
    await db.update(tweetSearches).set({ status }).where(eq(tweetSearches.id, id));
  }

  async createTweet(insertTweet: InsertTweet): Promise<Tweet> {
    const db = await this.getDb();
    try {
      // Try to insert the new tweet
      const [tweet] = await db.insert(tweets).values([insertTweet]).returning();
      return tweet;
    } catch (error: any) {
      // If it's a duplicate key error, check if the existing tweet is from the same search
      if (error.code === '23505' && error.constraint === 'tweets_tweet_id_unique') {
        console.log(`Tweet ${insertTweet.tweetId} already exists, checking if it's from the same search...`);
        
        // Get the existing tweet
        const [existingTweet] = await db.select().from(tweets).where(eq(tweets.tweetId, insertTweet.tweetId));
        
        if (existingTweet && existingTweet.searchId === insertTweet.searchId) {
          // Same search, return the existing tweet
          console.log(`Tweet ${insertTweet.tweetId} already exists for this search, returning existing tweet`);
          return existingTweet;
        } else if (existingTweet) {
          // Different search, update the tweet with new search info if needed
          console.log(`Tweet ${insertTweet.tweetId} exists for different search, updating with new search data`);
          const [updatedTweet] = await db.update(tweets)
            .set({ 
              searchId: insertTweet.searchId,
              sourceHashtag: insertTweet.sourceHashtag 
            })
            .where(eq(tweets.tweetId, insertTweet.tweetId))
            .returning();
          return updatedTweet;
        }
      }
      // If it's not a duplicate key error or something else went wrong, re-throw
      throw error;
    }
  }

  async getTweetsBySearchId(searchId: string): Promise<Tweet[]> {
    const db = await this.getDb();
    return await db.select().from(tweets).where(eq(tweets.searchId, searchId));
  }

  async updateTweetBotStatus(tweetId: string, isBot: boolean, analysis?: any): Promise<void> {
    const db = await this.getDb();
    await db.update(tweets)
      .set({ isBot, botAnalysis: analysis })
      .where(eq(tweets.tweetId, tweetId));
  }

  async getRecommendedCashtags(): Promise<RecommendedCashtag[]> {
    const db = await this.getDb();
    const cashtags = await db.select().from(recommendedCashtags);
    // Sort by 24h volume (highest first)
    return cashtags.sort((a: RecommendedCashtag, b: RecommendedCashtag) => b.volume24h - a.volume24h);
  }

  async createRecommendedCashtag(insertCashtag: InsertRecommendedCashtag): Promise<RecommendedCashtag> {
    const db = await this.getDb();
    const [cashtag] = await db.insert(recommendedCashtags).values(insertCashtag).returning();
    return cashtag;
  }

  async updateRecommendedCashtag(symbol: string, updateData: InsertRecommendedCashtag): Promise<void> {
    const db = await this.getDb();
    // Case-insensitive update: "Frieren", "FRIEREN", "frieren" all match
    await db.update(recommendedCashtags)
      .set({ ...updateData, updatedAt: new Date() })
      .where(sql`LOWER(${recommendedCashtags.symbol}) = LOWER(${symbol})`);
  }

  async deleteRecommendedCashtag(symbol: string): Promise<void> {
    const db = await this.getDb();
    // Case-insensitive delete: "Frieren", "FRIEREN", "frieren" all match
    await db.delete(recommendedCashtags).where(
      sql`LOWER(${recommendedCashtags.symbol}) = LOWER(${symbol})`
    );
  }

  async toggleRecommendedCashtagPinned(symbol: string, isPinned: boolean): Promise<void> {
    const db = await this.getDb();
    await db.update(recommendedCashtags)
      .set({ isPinned, updatedAt: new Date() })
      .where(sql`LOWER(${recommendedCashtags.symbol}) = LOWER(${symbol})`);
  }

  async getPinnedRecommendedCashtags(): Promise<RecommendedCashtag[]> {
    const db = await this.getDb();
    return await db.select().from(recommendedCashtags).where(eq(recommendedCashtags.isPinned, true));
  }

  async getPinnedTrendingTokens(): Promise<PinnedTrendingToken[]> {
    const db = await this.getDb();
    return await db.select().from(pinnedTrendingTokens);
  }

  async addPinnedTrendingToken(symbol: string): Promise<PinnedTrendingToken> {
    const db = await this.getDb();
    const [token] = await db.insert(pinnedTrendingTokens).values({ symbol: symbol.toUpperCase() }).returning();
    return token;
  }

  async removePinnedTrendingToken(symbol: string): Promise<void> {
    const db = await this.getDb();
    await db.delete(pinnedTrendingTokens).where(
      sql`LOWER(${pinnedTrendingTokens.symbol}) = LOWER(${symbol})`
    );
  }

  async isPinnedTrendingToken(symbol: string): Promise<boolean> {
    const db = await this.getDb();
    const [token] = await db.select().from(pinnedTrendingTokens).where(
      sql`LOWER(${pinnedTrendingTokens.symbol}) = LOWER(${symbol})`
    );
    return !!token;
  }

  async getTwitterSettings(): Promise<TwitterSettings | undefined> {
    const db = await this.getDb();
    const [settings] = await db.select().from(twitterSettings).where(eq(twitterSettings.isActive, true));
    return settings;
  }

  async getTwitterSettingsByUsername(username: string): Promise<TwitterSettings | undefined> {
    const db = await this.getDb();
    const [settings] = await db.select().from(twitterSettings).where(eq(twitterSettings.username, username));
    return settings;
  }

  async getAllTwitterSettings(): Promise<TwitterSettings[]> {
    const db = await this.getDb();
    const allSettings = await db.select().from(twitterSettings);
    return allSettings;
  }

  async setActiveUsername(username: string): Promise<void> {
    const db = await this.getDb();
    // First, deactivate all settings
    await db.update(twitterSettings).set({ isActive: false });
    // Then activate the selected username
    await db.update(twitterSettings)
      .set({ isActive: true })
      .where(eq(twitterSettings.username, username));
  }

  async createTwitterSettings(insertSettings: InsertTwitterSettings): Promise<TwitterSettings> {
    const db = await this.getDb();
    // First, deactivate any existing settings (only one active at a time)
    await db.update(twitterSettings).set({ isActive: false });
    
    const [settings] = await db.insert(twitterSettings).values(insertSettings).returning();
    return settings;
  }

  async updateTwitterSettings(id: string, updateData: Partial<InsertTwitterSettings>): Promise<void> {
    const db = await this.getDb();
    await db.update(twitterSettings)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(twitterSettings.id, id));
  }

  async updateTwitterSettingsLastUsed(id: string): Promise<void> {
    const db = await this.getDb();
    await db.update(twitterSettings)
      .set({ lastUsed: new Date(), updatedAt: new Date() })
      .where(eq(twitterSettings.id, id));
  }

  async deleteTwitterSettings(id: string): Promise<void> {
    const db = await this.getDb();
    await db.delete(twitterSettings).where(eq(twitterSettings.id, id));
  }

  async getAiConfig(): Promise<AiConfig | undefined> {
    const db = await this.getDb();
    const [config] = await db.select().from(aiConfig).limit(1);
    return config;
  }

  async saveAiConfig(insertConfig: InsertAiConfig): Promise<AiConfig> {
    const db = await this.getDb();
    const [config] = await db.insert(aiConfig).values(insertConfig).returning();
    return config;
  }

  async updateAiConfig(systemPrompt: string): Promise<void> {
    const db = await this.getDb();
    const existing = await this.getAiConfig();
    
    if (existing) {
      await db.update(aiConfig)
        .set({ systemPrompt, updatedAt: new Date() })
        .where(eq(aiConfig.id, existing.id));
    } else {
      await this.saveAiConfig({ systemPrompt });
    }
  }

  async createReplyImage(insertImage: InsertReplyImage): Promise<ReplyImage> {
    const db = await this.getDb();
    const [image] = await db.insert(replyImages).values(insertImage).returning();
    return image;
  }

  async createReplyImageWithId(id: string, insertImage: InsertReplyImage): Promise<ReplyImage> {
    const db = await this.getDb();
    const [image] = await db.insert(replyImages).values({ ...insertImage, id }).returning();
    return image;
  }

  async getAllReplyImages(): Promise<ReplyImage[]> {
    const db = await this.getDb();
    // Only fetch metadata columns, NOT the huge imageData base64 blob
    // This avoids the 64MB response limit error
    return await db.select({
      id: replyImages.id,
      fileName: replyImages.fileName,
      imageUrl: replyImages.imageUrl,
      imageData: sql<string | null>`NULL`.as('imageData'),
      createdAt: replyImages.createdAt,
    }).from(replyImages);
  }

  async getReplyImageById(id: string): Promise<ReplyImage | undefined> {
    const db = await this.getDb();
    // Fetch single image with full data (including imageData for serving)
    const images = await db.select().from(replyImages).where(eq(replyImages.id, id)).limit(1);
    return images[0];
  }

  async updateReplyImageUrl(id: string, imageUrl: string): Promise<void> {
    const db = await this.getDb();
    await db.update(replyImages).set({ imageUrl }).where(eq(replyImages.id, id));
  }

  async deleteReplyImage(id: string): Promise<void> {
    const db = await this.getDb();
    await db.delete(replyImages).where(eq(replyImages.id, id));
  }

  async deleteAllReplyImages(): Promise<number> {
    const db = await this.getDb();
    // Count without fetching large data (avoids 64MB response limit)
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(replyImages);
    const count = Number(countResult[0]?.count ?? 0);
    await db.delete(replyImages);
    return count;
  }

  async getRandomReplyImage(): Promise<ReplyImage | undefined> {
    const db = await this.getDb();
    // Fetch a single random image with full data (including imageData for replies)
    // Uses ORDER BY RANDOM() LIMIT 1 to avoid fetching all images
    const images = await db.select().from(replyImages).orderBy(sql`RANDOM()`).limit(1);
    return images[0];
  }

  async getFilteredHandles(): Promise<FilteredHandles | undefined> {
    const db = await this.getDb();
    const [handles] = await db.select().from(filteredHandles).limit(1);
    return handles;
  }

  async updateFilteredHandles(handlesText: string): Promise<void> {
    const db = await this.getDb();
    const existing = await this.getFilteredHandles();
    
    if (existing) {
      await db.update(filteredHandles)
        .set({ handles: handlesText, updatedAt: new Date() })
        .where(eq(filteredHandles.id, existing.id));
    } else {
      await db.insert(filteredHandles).values({ handles: handlesText });
    }
  }

  async getAllScheduledRuns(): Promise<ScheduledRun[]> {
    const db = await this.getDb();
    return await db.select().from(scheduledRuns);
  }

  async getScheduledRun(id: string): Promise<ScheduledRun | undefined> {
    const db = await this.getDb();
    const [run] = await db.select().from(scheduledRuns).where(eq(scheduledRuns.id, id));
    return run;
  }

  async createScheduledRun(insertRun: InsertScheduledRun): Promise<ScheduledRun> {
    const db = await this.getDb();
    const [run] = await db.insert(scheduledRuns).values(insertRun).returning();
    return run;
  }

  async updateScheduledRun(id: string, updateData: Partial<InsertScheduledRun>): Promise<void> {
    const db = await this.getDb();
    await db.update(scheduledRuns).set(updateData).where(eq(scheduledRuns.id, id));
  }

  async updateScheduledRunLastRun(id: string): Promise<void> {
    const db = await this.getDb();
    await db.update(scheduledRuns).set({ lastRun: new Date() }).where(eq(scheduledRuns.id, id));
  }

  async deleteScheduledRun(id: string): Promise<void> {
    const db = await this.getDb();
    await db.delete(scheduledRuns).where(eq(scheduledRuns.id, id));
  }

  // Organic activity methods
  async createOrganicActivity(activity: InsertOrganicActivity): Promise<OrganicActivity> {
    const db = await this.getDb();
    const [created] = await db.insert(organicActivity).values(activity).returning();
    return created;
  }

  async getOrganicActivityByUsername(username: string, date: string): Promise<OrganicActivity[]> {
    const db = await this.getDb();
    return await db.select().from(organicActivity)
      .where(sql`${organicActivity.username} = ${username} AND DATE(${organicActivity.createdAt}) = ${date}`);
  }

  async getOrganicActivitySchedule(username: string): Promise<OrganicActivitySchedule | undefined> {
    const db = await this.getDb();
    const [schedule] = await db.select().from(organicActivitySchedule)
      .where(eq(organicActivitySchedule.username, username));
    return schedule;
  }

  async getAllOrganicActivitySchedules(): Promise<OrganicActivitySchedule[]> {
    const db = await this.getDb();
    return await db.select().from(organicActivitySchedule);
  }

  async createOrganicActivitySchedule(schedule: InsertOrganicActivitySchedule): Promise<OrganicActivitySchedule> {
    const db = await this.getDb();
    const [created] = await db.insert(organicActivitySchedule).values(schedule).returning();
    return created;
  }

  async updateOrganicActivitySchedule(username: string, updates: Partial<InsertOrganicActivitySchedule>): Promise<void> {
    const db = await this.getDb();
    await db.update(organicActivitySchedule)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(organicActivitySchedule.username, username));
  }

  async deleteOrganicActivitySchedule(username: string): Promise<void> {
    const db = await this.getDb();
    await db.delete(organicActivitySchedule)
      .where(eq(organicActivitySchedule.username, username));
  }

  async resetDailyLikesForAllAccounts(): Promise<void> {
    const db = await this.getDb();
    const today = new Date().toISOString().split('T')[0];
    await db.update(organicActivitySchedule)
      .set({
        likesCompletedToday: 0,
        lastLikeDate: today,
        dailyLikesTarget: sql`floor(random() * 13 + 3)` // Random 3-15
      });
  }

  // Following cache methods
  async getFollowingCache(username: string): Promise<FollowingCache[]> {
    const db = await this.getDb();
    return await db.select().from(followingCache).where(eq(followingCache.username, username));
  }

  async shouldRefreshFollowingCache(username: string): Promise<boolean> {
    const db = await this.getDb();
    const cached = await db.select().from(followingCache)
      .where(eq(followingCache.username, username))
      .limit(1);

    if (cached.length === 0) {
      return true; // No cache, needs refresh
    }

    // Check if last refresh was more than 30 days ago
    const lastRefreshed = new Date(cached[0].lastRefreshed);
    const now = new Date();
    const daysSinceRefresh = (now.getTime() - lastRefreshed.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceRefresh >= 30;
  }

  async refreshFollowingCache(username: string, following: Array<{ userId: string; username: string; name: string }>): Promise<void> {
    const db = await this.getDb();

    // Delete old cache for this user
    await db.delete(followingCache).where(eq(followingCache.username, username));

    // Insert new cache
    if (following.length > 0) {
      await db.insert(followingCache).values(
        following.map(f => ({
          username,
          followingUsername: f.username,
          followingUserId: f.userId,
          followingName: f.name,
          lastRefreshed: new Date()
        }))
      );
    }
  }

  async getRandomFollowingUser(username: string): Promise<FollowingCache | undefined> {
    const db = await this.getDb();
    const cached = await db.select().from(followingCache)
      .where(eq(followingCache.username, username));

    if (cached.length === 0) {
      return undefined;
    }

    const randomIndex = Math.floor(Math.random() * cached.length);
    return cached[randomIndex];
  }

  async getAppSetting(key: string): Promise<string | null> {
    const db = await this.getDb();
    try {
      const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
      return row?.value ?? null;
    } catch (error: any) {
      // Table might not exist yet - create it
      if (error.message?.includes('relation') || error.code === '42P01') {
        await db.execute(sql`CREATE TABLE IF NOT EXISTS "app_settings" ("key" text PRIMARY KEY, "value" text NOT NULL, "updated_at" timestamp NOT NULL DEFAULT now())`);
        return null;
      }
      throw error;
    }
  }

  async setAppSetting(key: string, value: string): Promise<void> {
    const db = await this.getDb();
    try {
      await db.insert(appSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedAt: new Date() }
        });
    } catch (error: any) {
      // Table might not exist yet - create it and retry
      if (error.message?.includes('relation') || error.code === '42P01') {
        await db.execute(sql`CREATE TABLE IF NOT EXISTS "app_settings" ("key" text PRIMARY KEY, "value" text NOT NULL, "updated_at" timestamp NOT NULL DEFAULT now())`);
        await db.insert(appSettings)
          .values({ key, value, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value, updatedAt: new Date() }
          });
      } else {
        throw error;
      }
    }
  }
}

// Fallback MemStorage for development/testing
export class MemStorage implements IStorage {
  private tweetSearches: Map<string, TweetSearch>;
  private tweets: Map<string, Tweet>;
  private recommendedCashtags: Map<string, RecommendedCashtag>;
  private twitterSettings: Map<string, TwitterSettings>;
  private aiConfig: AiConfig | undefined;
  private replyImages: Map<string, ReplyImage>;
  private filteredHandlesData: FilteredHandles | undefined;

  constructor() {
    this.tweetSearches = new Map();
    this.tweets = new Map();
    this.recommendedCashtags = new Map();
    this.twitterSettings = new Map();
    this.aiConfig = undefined;
    this.replyImages = new Map();
    this.filteredHandlesData = undefined;
    this.initializeDefaultCashtags();
  }

  private initializeDefaultCashtags() {
    const defaultCashtags = [
      { symbol: "XAVIER", name: "Xavier Token", marketCap: 125000000, volume24h: 8500000, priceChange24h: 1570 },
      { symbol: "TOKABU", name: "Tokabu", marketCap: 89000000, volume24h: 12300000, priceChange24h: -340 },
      { symbol: "MD", name: "MD Token", marketCap: 45000000, volume24h: 6700000, priceChange24h: 890 },
      { symbol: "CRYPTO", name: "Crypto Token", marketCap: 203000000, volume24h: 14500000, priceChange24h: 560 },
      { symbol: "FINANCE", name: "Finance Token", marketCap: 78000000, volume24h: 9200000, priceChange24h: 320 },
      { symbol: "KORI", name: "Kori Token", marketCap: 156000000, volume24h: 18900000, priceChange24h: 2210 },
      { symbol: "UFD", name: "UFD", marketCap: 134000000, volume24h: 11400000, priceChange24h: -180 },
      { symbol: "MINI", name: "Mini Token", marketCap: 92000000, volume24h: 7800000, priceChange24h: 670 },
      { symbol: "USDUC", name: "USDUC", marketCap: 245000000, volume24h: 25300000, priceChange24h: 45 },
      { symbol: "DCA", name: "DCA Token", marketCap: 187000000, volume24h: 16700000, priceChange24h: 1340 },
      { symbol: "SIGMA", name: "Sigma Token", marketCap: 98000000, volume24h: 13200000, priceChange24h: 890 },
    ];

    defaultCashtags.forEach(cashtag => {
      const id = randomUUID();
      const fullCashtag: RecommendedCashtag = {
        id,
        ...cashtag,
        icon: null,
        isPinned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.recommendedCashtags.set(cashtag.symbol, fullCashtag);
    });
  }

  async createTweetSearch(insertSearch: InsertTweetSearch): Promise<TweetSearch> {
    const id = randomUUID();
    const search: TweetSearch = { 
      id, 
      status: "pending",
      createdAt: new Date(),
      cashtag: insertSearch.cashtag,
      minFollowers: insertSearch.minFollowers ?? 500,
      maxFollowers: insertSearch.maxFollowers ?? 10000,
      timeRange: insertSearch.timeRange ?? "1h",
      maxResults: insertSearch.maxResults ?? 100,
      excludeRetweets: insertSearch.excludeRetweets ?? true,
      verifiedOnly: insertSearch.verifiedOnly ?? false
    };
    this.tweetSearches.set(id, search);
    return search;
  }

  async getTweetSearch(id: string): Promise<TweetSearch | undefined> {
    return this.tweetSearches.get(id);
  }

  async updateTweetSearchStatus(id: string, status: string): Promise<void> {
    const search = this.tweetSearches.get(id);
    if (search) {
      search.status = status;
      this.tweetSearches.set(id, search);
    }
  }

  async createTweet(insertTweet: InsertTweet): Promise<Tweet> {
    const id = randomUUID();
    const tweet: Tweet = { 
      id,
      createdAt: new Date(),
      searchId: insertTweet.searchId,
      tweetId: insertTweet.tweetId,
      content: insertTweet.content,
      authorId: insertTweet.authorId,
      authorName: insertTweet.authorName,
      authorHandle: insertTweet.authorHandle,
      authorFollowers: insertTweet.authorFollowers,
      authorAvatar: insertTweet.authorAvatar ?? null,
      likes: insertTweet.likes ?? 0,
      retweets: insertTweet.retweets ?? 0,
      url: insertTweet.url,
      publishedAt: insertTweet.publishedAt,
      isBot: insertTweet.isBot ?? false,
      botAnalysis: insertTweet.botAnalysis ?? null,
      sourceHashtag: insertTweet.sourceHashtag,
      isReply: insertTweet.isReply ?? false,
      inReplyToTweetId: insertTweet.inReplyToTweetId ?? null,
      inReplyToUserId: insertTweet.inReplyToUserId ?? null,
      inReplyToUsername: insertTweet.inReplyToUsername ?? null,
      parentTweetUrl: insertTweet.parentTweetUrl ?? null,
      parentTweetContent: insertTweet.parentTweetContent ?? null,
      parentTweetAuthor: insertTweet.parentTweetAuthor ?? null,
      parentTweetFollowers: insertTweet.parentTweetFollowers ?? null,
      parentTweetReplies: insertTweet.parentTweetReplies ?? null,
      parentTweetAge: insertTweet.parentTweetAge ?? null,
      meetsReplyCriteria: insertTweet.meetsReplyCriteria ?? false,
      isParentTweet: insertTweet.isParentTweet ?? false
    };
    this.tweets.set(id, tweet);
    return tweet;
  }

  async getTweetsBySearchId(searchId: string): Promise<Tweet[]> {
    return Array.from(this.tweets.values()).filter(tweet => tweet.searchId === searchId);
  }

  async updateTweetBotStatus(tweetId: string, isBot: boolean, analysis?: any): Promise<void> {
    const tweet = Array.from(this.tweets.values()).find(t => t.tweetId === tweetId);
    if (tweet) {
      tweet.isBot = isBot;
      tweet.botAnalysis = analysis ?? null;
      this.tweets.set(tweet.id, tweet);
    }
  }

  async getRecommendedCashtags(): Promise<RecommendedCashtag[]> {
    const cashtags = Array.from(this.recommendedCashtags.values());
    return cashtags.sort((a: RecommendedCashtag, b: RecommendedCashtag) => b.volume24h - a.volume24h);
  }

  async createRecommendedCashtag(insertCashtag: InsertRecommendedCashtag): Promise<RecommendedCashtag> {
    const id = randomUUID();
    const cashtag: RecommendedCashtag = {
      id,
      ...insertCashtag,
      icon: insertCashtag.icon ?? null,
      isPinned: insertCashtag.isPinned ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.recommendedCashtags.set(cashtag.symbol, cashtag);
    return cashtag;
  }

  async updateRecommendedCashtag(symbol: string, updateData: InsertRecommendedCashtag): Promise<void> {
    // Case-insensitive update
    const lowerSymbol = symbol.toLowerCase();
    const keys = Array.from(this.recommendedCashtags.keys());
    const matchingKey = keys.find(key => key.toLowerCase() === lowerSymbol);
    
    if (matchingKey) {
      const existing = this.recommendedCashtags.get(matchingKey)!;
      const updated: RecommendedCashtag = {
        ...existing,
        ...updateData,
        updatedAt: new Date(),
      };
      this.recommendedCashtags.set(matchingKey, updated);
    }
  }

  async deleteRecommendedCashtag(symbol: string): Promise<void> {
    // Case-insensitive delete
    const lowerSymbol = symbol.toLowerCase();
    const keys = Array.from(this.recommendedCashtags.keys());
    const matchingKey = keys.find(key => key.toLowerCase() === lowerSymbol);
    if (matchingKey) {
      this.recommendedCashtags.delete(matchingKey);
    }
  }

  async toggleRecommendedCashtagPinned(symbol: string, isPinned: boolean): Promise<void> {
    const lowerSymbol = symbol.toLowerCase();
    const keys = Array.from(this.recommendedCashtags.keys());
    const matchingKey = keys.find(key => key.toLowerCase() === lowerSymbol);
    if (matchingKey) {
      const existing = this.recommendedCashtags.get(matchingKey)!;
      existing.isPinned = isPinned;
      existing.updatedAt = new Date();
      this.recommendedCashtags.set(matchingKey, existing);
    }
  }

  async getPinnedRecommendedCashtags(): Promise<RecommendedCashtag[]> {
    return Array.from(this.recommendedCashtags.values()).filter(c => c.isPinned);
  }

  private pinnedTrendingTokens: Map<string, PinnedTrendingToken> = new Map();

  async getPinnedTrendingTokens(): Promise<PinnedTrendingToken[]> {
    return Array.from(this.pinnedTrendingTokens.values());
  }

  async addPinnedTrendingToken(symbol: string): Promise<PinnedTrendingToken> {
    const id = randomUUID();
    const token: PinnedTrendingToken = {
      id,
      symbol: symbol.toUpperCase(),
      createdAt: new Date(),
    };
    this.pinnedTrendingTokens.set(symbol.toUpperCase(), token);
    return token;
  }

  async removePinnedTrendingToken(symbol: string): Promise<void> {
    const lowerSymbol = symbol.toLowerCase();
    const keys = Array.from(this.pinnedTrendingTokens.keys());
    const matchingKey = keys.find(key => key.toLowerCase() === lowerSymbol);
    if (matchingKey) {
      this.pinnedTrendingTokens.delete(matchingKey);
    }
  }

  async isPinnedTrendingToken(symbol: string): Promise<boolean> {
    const lowerSymbol = symbol.toLowerCase();
    return Array.from(this.pinnedTrendingTokens.keys()).some(key => key.toLowerCase() === lowerSymbol);
  }

  async getTwitterSettings(): Promise<TwitterSettings | undefined> {
    const settings = Array.from(this.twitterSettings.values()).find(s => s.isActive);
    return settings;
  }

  async getTwitterSettingsByUsername(username: string): Promise<TwitterSettings | undefined> {
    const settings = Array.from(this.twitterSettings.values()).find(s => s.username === username);
    return settings;
  }

  async getAllTwitterSettings(): Promise<TwitterSettings[]> {
    return Array.from(this.twitterSettings.values());
  }

  async setActiveUsername(username: string): Promise<void> {
    // Deactivate all settings
    this.twitterSettings.forEach(settings => {
      settings.isActive = false;
    });
    // Activate the selected username
    const settings = Array.from(this.twitterSettings.values()).find(s => s.username === username);
    if (settings) {
      settings.isActive = true;
    }
  }

  async createTwitterSettings(insertSettings: InsertTwitterSettings): Promise<TwitterSettings> {
    const id = randomUUID();
    
    // Deactivate any existing settings (only one active at a time)
    this.twitterSettings.forEach(settings => {
      settings.isActive = false;
    });
    
    const settings: TwitterSettings = {
      id,
      username: insertSettings.username,
      twitterCookie: insertSettings.twitterCookie ?? null,
      isActive: insertSettings.isActive ?? true,
      isAvailableForRandom: insertSettings.isAvailableForRandom ?? true,
      lastUsed: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.twitterSettings.set(id, settings);
    return settings;
  }

  async updateTwitterSettings(id: string, updateData: Partial<InsertTwitterSettings>): Promise<void> {
    const existing = this.twitterSettings.get(id);
    if (existing) {
      const updated: TwitterSettings = {
        ...existing,
        ...updateData,
        updatedAt: new Date(),
      };
      this.twitterSettings.set(id, updated);
    }
  }

  async updateTwitterSettingsLastUsed(id: string): Promise<void> {
    const existing = this.twitterSettings.get(id);
    if (existing) {
      const updated: TwitterSettings = {
        ...existing,
        lastUsed: new Date(),
        updatedAt: new Date(),
      };
      this.twitterSettings.set(id, updated);
    }
  }

  async deleteTwitterSettings(id: string): Promise<void> {
    this.twitterSettings.delete(id);
  }

  async getAiConfig(): Promise<AiConfig | undefined> {
    return this.aiConfig;
  }

  async saveAiConfig(insertConfig: InsertAiConfig): Promise<AiConfig> {
    const id = randomUUID();
    const config: AiConfig = {
      id,
      systemPrompt: insertConfig.systemPrompt,
      updatedAt: new Date(),
    };
    this.aiConfig = config;
    return config;
  }

  async updateAiConfig(systemPrompt: string): Promise<void> {
    if (this.aiConfig) {
      this.aiConfig = {
        ...this.aiConfig,
        systemPrompt,
        updatedAt: new Date(),
      };
    } else {
      await this.saveAiConfig({ systemPrompt });
    }
  }

  async createReplyImage(insertImage: InsertReplyImage): Promise<ReplyImage> {
    const id = randomUUID();
    const image: ReplyImage = {
      id,
      ...insertImage,
      objectKey: insertImage.objectKey ?? null,
      imageData: insertImage.imageData ?? null,
      createdAt: new Date(),
    };
    this.replyImages.set(id, image);
    return image;
  }

  async createReplyImageWithId(id: string, insertImage: InsertReplyImage): Promise<ReplyImage> {
    const image: ReplyImage = {
      id,
      ...insertImage,
      objectKey: insertImage.objectKey ?? null,
      imageData: insertImage.imageData ?? null,
      createdAt: new Date(),
    };
    this.replyImages.set(id, image);
    return image;
  }

  async getAllReplyImages(): Promise<ReplyImage[]> {
    return Array.from(this.replyImages.values());
  }

  async getReplyImageById(id: string): Promise<ReplyImage | undefined> {
    return this.replyImages.get(id);
  }

  async updateReplyImageUrl(id: string, imageUrl: string): Promise<void> {
    const image = this.replyImages.get(id);
    if (image) {
      this.replyImages.set(id, { ...image, imageUrl });
    }
  }

  async deleteReplyImage(id: string): Promise<void> {
    this.replyImages.delete(id);
  }

  async deleteAllReplyImages(): Promise<number> {
    const count = this.replyImages.size;
    this.replyImages.clear();
    return count;
  }

  async getRandomReplyImage(): Promise<ReplyImage | undefined> {
    const images = Array.from(this.replyImages.values());
    if (images.length === 0) return undefined;
    const randomIndex = Math.floor(Math.random() * images.length);
    return images[randomIndex];
  }

  async getFilteredHandles(): Promise<FilteredHandles | undefined> {
    return this.filteredHandlesData;
  }

  async updateFilteredHandles(handlesText: string): Promise<void> {
    if (!this.filteredHandlesData) {
      this.filteredHandlesData = {
        id: randomUUID(),
        handles: handlesText,
        updatedAt: new Date()
      };
    } else {
      this.filteredHandlesData = {
        ...this.filteredHandlesData,
        handles: handlesText,
        updatedAt: new Date()
      };
    }
  }

  // Scheduled runs (MemStorage implementation)
  private scheduledRuns: Map<string, ScheduledRun> = new Map();

  async getAllScheduledRuns(): Promise<ScheduledRun[]> {
    return Array.from(this.scheduledRuns.values());
  }

  async getScheduledRun(id: string): Promise<ScheduledRun | undefined> {
    return this.scheduledRuns.get(id);
  }

  async createScheduledRun(insertRun: InsertScheduledRun): Promise<ScheduledRun> {
    const id = randomUUID();
    const run: ScheduledRun = {
      id,
      timeOfDay: insertRun.timeOfDay,
      enabled: insertRun.enabled ?? true,
      lastRun: null,
      createdAt: new Date(),
    };
    this.scheduledRuns.set(id, run);
    return run;
  }

  async updateScheduledRun(id: string, updateData: Partial<InsertScheduledRun>): Promise<void> {
    const existing = this.scheduledRuns.get(id);
    if (existing) {
      this.scheduledRuns.set(id, { ...existing, ...updateData });
    }
  }

  async updateScheduledRunLastRun(id: string): Promise<void> {
    const existing = this.scheduledRuns.get(id);
    if (existing) {
      this.scheduledRuns.set(id, { ...existing, lastRun: new Date() });
    }
  }

  async deleteScheduledRun(id: string): Promise<void> {
    this.scheduledRuns.delete(id);
  }

  // Organic activity (MemStorage stub implementations)
  private organicActivities: OrganicActivity[] = [];
  private organicSchedules: Map<string, OrganicActivitySchedule> = new Map();

  async createOrganicActivity(activity: InsertOrganicActivity): Promise<OrganicActivity> {
    const created: OrganicActivity = {
      id: randomUUID(),
      ...activity,
      targetUsername: activity.targetUsername ?? null,
      createdAt: new Date()
    };
    this.organicActivities.push(created);
    return created;
  }

  async getOrganicActivityByUsername(username: string, date: string): Promise<OrganicActivity[]> {
    return this.organicActivities.filter(a => 
      a.username === username && a.createdAt.toISOString().startsWith(date)
    );
  }

  async getOrganicActivitySchedule(username: string): Promise<OrganicActivitySchedule | undefined> {
    return this.organicSchedules.get(username);
  }

  async getAllOrganicActivitySchedules(): Promise<OrganicActivitySchedule[]> {
    return Array.from(this.organicSchedules.values());
  }

  async createOrganicActivitySchedule(schedule: InsertOrganicActivitySchedule): Promise<OrganicActivitySchedule> {
    const created: OrganicActivitySchedule = {
      id: randomUUID(),
      username: schedule.username,
      dailyLikesTarget: schedule.dailyLikesTarget ?? 8,
      likesCompletedToday: schedule.likesCompletedToday ?? 0,
      lastLikeDate: schedule.lastLikeDate ?? null,
      nextLikeTime: schedule.nextLikeTime ?? null,
      lastRetweetDate: schedule.lastRetweetDate ?? null,
      nextRetweetDate: schedule.nextRetweetDate ?? null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.organicSchedules.set(schedule.username, created);
    return created;
  }

  async updateOrganicActivitySchedule(username: string, updates: Partial<InsertOrganicActivitySchedule>): Promise<void> {
    const existing = this.organicSchedules.get(username);
    if (existing) {
      this.organicSchedules.set(username, { ...existing, ...updates, updatedAt: new Date() });
    }
  }

  async deleteOrganicActivitySchedule(username: string): Promise<void> {
    this.organicSchedules.delete(username);
  }

  async resetDailyLikesForAllAccounts(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const entries = Array.from(this.organicSchedules.entries());
    for (const [username, schedule] of entries) {
      this.organicSchedules.set(username, {
        ...schedule,
        likesCompletedToday: 0,
        lastLikeDate: today,
        dailyLikesTarget: Math.floor(Math.random() * 13) + 3
      });
    }
  }

  // Following cache methods (memory storage - simple implementation)
  private followingCacheMap: Map<string, Array<{ username: string; userId: string; name: string; lastRefreshed: Date }>> = new Map();

  async getFollowingCache(username: string): Promise<FollowingCache[]> {
    const cached = this.followingCacheMap.get(username) || [];
    return cached.map((f, idx) => ({
      id: `${username}-${idx}`,
      username,
      followingUsername: f.username,
      followingUserId: f.userId,
      followingName: f.name,
      lastRefreshed: f.lastRefreshed,
      createdAt: f.lastRefreshed
    }));
  }

  async shouldRefreshFollowingCache(username: string): Promise<boolean> {
    const cached = this.followingCacheMap.get(username);
    if (!cached || cached.length === 0) {
      return true;
    }

    const lastRefreshed = cached[0].lastRefreshed;
    const now = new Date();
    const daysSinceRefresh = (now.getTime() - lastRefreshed.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceRefresh >= 30;
  }

  async refreshFollowingCache(username: string, following: Array<{ userId: string; username: string; name: string }>): Promise<void> {
    this.followingCacheMap.set(
      username,
      following.map(f => ({
        username: f.username,
        userId: f.userId,
        name: f.name,
        lastRefreshed: new Date()
      }))
    );
  }

  async getRandomFollowingUser(username: string): Promise<FollowingCache | undefined> {
    const cached = this.followingCacheMap.get(username) || [];
    if (cached.length === 0) {
      return undefined;
    }

    const randomIndex = Math.floor(Math.random() * cached.length);
    const f = cached[randomIndex];
    return {
      id: `${username}-${randomIndex}`,
      username,
      followingUsername: f.username,
      followingUserId: f.userId,
      followingName: f.name,
      lastRefreshed: f.lastRefreshed,
      createdAt: f.lastRefreshed
    };
  }

  private appSettingsMap = new Map<string, string>();

  async getAppSetting(key: string): Promise<string | null> {
    return this.appSettingsMap.get(key) ?? null;
  }

  async setAppSetting(key: string, value: string): Promise<void> {
    this.appSettingsMap.set(key, value);
  }
}

// Create storage instance
let storageInstance: IStorage | null = null;
let initializingPromise: Promise<IStorage> | null = null;

export const getStorage = async (): Promise<IStorage> => {
  // If already initialized, return it
  if (storageInstance) {
    return storageInstance;
  }

  // If initialization is in progress, wait for it
  if (initializingPromise) {
    return initializingPromise;
  }

  // Start initialization
  initializingPromise = (async () => {
    if (process.env.DATABASE_URL) {
      try {
        console.log("🔄 Attempting to initialize DatabaseStorage...");
        const dbStorage = new DatabaseStorage();
        console.log("✅ DatabaseStorage instance created");

        console.log("🔄 Initializing default cashtags...");
        await dbStorage.initializeDefaultCashtags();
        console.log("✅ Default cashtags initialized");

        console.log("🔄 Initializing Twitter settings...");
        await dbStorage.initializeTwitterSettings();
        console.log("✅ Twitter settings initialized");

        storageInstance = dbStorage;
        console.log("✅ Database storage initialized successfully");
        return dbStorage;
      } catch (error) {
        console.error("❌ Failed to initialize database storage, falling back to memory storage");
        console.error("Error type:", error.constructor.name);
        console.error("Error message:", error.message);
        console.error("Full error:", error);
        console.error("Stack trace:", error.stack);
        // Fall through to memory storage
      }
    } else {
      console.log("ℹ️ DATABASE_URL not set, using memory storage");
    }

    storageInstance = new MemStorage();
    console.log("⚠️ Using memory storage (data will NOT persist across restarts)");
    return storageInstance;
  })();

  try {
    return await initializingPromise;
  } finally {
    // Clear the promise so future calls use storageInstance directly
    initializingPromise = null;
  }
};

// For backward compatibility - this will be a promise that needs to be awaited
export const storage = new MemStorage(); // fallback for immediate access
