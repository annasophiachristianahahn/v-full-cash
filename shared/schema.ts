import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tweetSearches = pgTable("tweet_searches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cashtag: text("cashtag").notNull(),
  minFollowers: integer("min_followers").notNull().default(500),
  maxFollowers: integer("max_followers").notNull().default(10000),
  timeRange: text("time_range").notNull().default("1h"),
  maxResults: integer("max_results").notNull().default(100),
  excludeRetweets: boolean("exclude_retweets").notNull().default(true),
  verifiedOnly: boolean("verified_only").notNull().default(false),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const tweets = pgTable("tweets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  searchId: varchar("search_id").notNull().references(() => tweetSearches.id),
  tweetId: text("tweet_id").notNull().unique(),
  content: text("content").notNull(),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  authorHandle: text("author_handle").notNull(),
  authorFollowers: integer("author_followers").notNull(),
  authorAvatar: text("author_avatar"),
  likes: integer("likes").notNull().default(0),
  retweets: integer("retweets").notNull().default(0),
  url: text("url").notNull(),
  publishedAt: timestamp("published_at").notNull(),
  isBot: boolean("is_bot").notNull().default(false),
  botAnalysis: jsonb("bot_analysis"),
  // Multi-cashtag support
  sourceHashtag: text("source_hashtag").notNull(), // Which cashtag this tweet came from
  // Reply-related fields
  isReply: boolean("is_reply").notNull().default(false),
  inReplyToTweetId: text("in_reply_to_tweet_id"),
  inReplyToUserId: text("in_reply_to_user_id"),
  inReplyToUsername: text("in_reply_to_username"),
  // Parent tweet information (when this tweet meets reply criteria)
  parentTweetUrl: text("parent_tweet_url"),
  parentTweetContent: text("parent_tweet_content"),
  parentTweetAuthor: text("parent_tweet_author"),
  parentTweetFollowers: integer("parent_tweet_followers"),
  parentTweetReplies: integer("parent_tweet_replies"),
  parentTweetAge: integer("parent_tweet_age_minutes"),
  meetsReplyCriteria: boolean("meets_reply_criteria").notNull().default(false),
  isParentTweet: boolean("is_parent_tweet").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const recommendedCashtags = pgTable("recommended_cashtags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  marketCap: bigint("market_cap", { mode: "number" }).notNull(),
  volume24h: bigint("volume_24h", { mode: "number" }).notNull(),
  priceChange24h: integer("price_change_24h").notNull(), // Stored as basis points (e.g., 150 = 1.5%)
  icon: text("icon"),
  isPinned: boolean("is_pinned").notNull().default(false), // Pinned tags get priority in scheduled runs
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Pinned trending tokens - stores symbols that should be prioritized in scheduled runs
export const pinnedTrendingTokens = pgTable("pinned_trending_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull().unique(), // Token symbol (e.g., "PYUSD", "BONK")
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const twitterSettings = pgTable("twitter_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(), // Username to identify this cookie (e.g., "vajme", "dozer")
  twitterCookie: text("twitter_cookie"), // Twitter session cookie for Apify posting (extracted from browser)
  isActive: boolean("is_active").notNull().default(true),
  isAvailableForRandom: boolean("is_available_for_random").notNull().default(true), // Whether this account can be randomly selected for primary/raid replies
  lastUsed: timestamp("last_used"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const aiConfig = pgTable("ai_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  systemPrompt: text("system_prompt").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const replyImages = pgTable("reply_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  imageUrl: text("image_url").notNull(), // Public URL path for serving the image
  objectKey: text("object_key"), // Object Storage key for deletion (e.g., "reply-images/uuid.jpg")
  imageData: text("image_data"), // Legacy: Base64 encoded image data (no longer used)
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const filteredHandles = pgTable("filtered_handles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  handles: text("handles").notNull(), // Comma-separated list of Twitter handles to filter out
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertTweetSearchSchema = createInsertSchema(tweetSearches).omit({
  id: true,
  status: true,
  createdAt: true,
});

export const insertTweetSchema = createInsertSchema(tweets).omit({
  id: true,
  createdAt: true,
});

export const insertRecommendedCashtagSchema = createInsertSchema(recommendedCashtags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPinnedTrendingTokenSchema = createInsertSchema(pinnedTrendingTokens).omit({
  id: true,
  createdAt: true,
});

export const insertTwitterSettingsSchema = createInsertSchema(twitterSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAiConfigSchema = createInsertSchema(aiConfig).omit({
  id: true,
  updatedAt: true,
});

export const insertReplyImageSchema = createInsertSchema(replyImages).omit({
  id: true,
  createdAt: true,
});

export const insertFilteredHandlesSchema = createInsertSchema(filteredHandles).omit({
  id: true,
  updatedAt: true,
});

export type InsertTweetSearch = z.infer<typeof insertTweetSearchSchema>;
export type TweetSearch = typeof tweetSearches.$inferSelect;
export type InsertTweet = z.infer<typeof insertTweetSchema>;
export type Tweet = typeof tweets.$inferSelect;
export type InsertRecommendedCashtag = z.infer<typeof insertRecommendedCashtagSchema>;
export type RecommendedCashtag = typeof recommendedCashtags.$inferSelect;
export type InsertPinnedTrendingToken = z.infer<typeof insertPinnedTrendingTokenSchema>;
export type PinnedTrendingToken = typeof pinnedTrendingTokens.$inferSelect;
export type InsertTwitterSettings = z.infer<typeof insertTwitterSettingsSchema>;
export type TwitterSettings = typeof twitterSettings.$inferSelect;
export type InsertAiConfig = z.infer<typeof insertAiConfigSchema>;
export type AiConfig = typeof aiConfig.$inferSelect;
export type InsertReplyImage = z.infer<typeof insertReplyImageSchema>;
export type ReplyImage = typeof replyImages.$inferSelect;
export type InsertFilteredHandles = z.infer<typeof insertFilteredHandlesSchema>;
export type FilteredHandles = typeof filteredHandles.$inferSelect;

// Scheduled Auto Runs - times are stored in EST
export const scheduledRuns = pgTable("scheduled_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timeOfDay: text("time_of_day").notNull(), // Format: "HH:MM" in EST (e.g., "09:30", "14:00")
  enabled: boolean("enabled").notNull().default(true),
  lastRun: timestamp("last_run"), // When this schedule last triggered
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertScheduledRunSchema = createInsertSchema(scheduledRuns).omit({
  id: true,
  lastRun: true,
  createdAt: true,
});

export type InsertScheduledRun = z.infer<typeof insertScheduledRunSchema>;
export type ScheduledRun = typeof scheduledRuns.$inferSelect;

// Search parameters schema for frontend
export const searchParamsSchema = z.object({
  cashtag1: z.string().min(1, "At least one cashtag is required"),
  cashtag2: z.string().optional(),
  cashtag3: z.string().optional(),
  cashtag4: z.string().optional(),
  cashtag5: z.string().optional(),
  cashtag6: z.string().optional(),
  cashtag7: z.string().optional(),
  cashtag8: z.string().optional(),
  minFollowers: z.number().min(0).default(500),
  maxFollowers: z.number().min(0).default(10000),
  timeRange: z.enum(["1h", "3h", "6h", "12h", "24h"]).default("1h"),
  maxResults: z.enum(["50", "100", "200", "500"]).default("100"),
  excludeRetweets: z.boolean().default(true),
  verifiedOnly: z.boolean().default(false),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

// Organic Activity Tracking - tracks likes/retweets for authentic behavior
export const organicActivity = pgTable("organic_activity", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull(), // Twitter account username
  activityType: text("activity_type").notNull(), // 'like' or 'retweet'
  targetTweetUrl: text("target_tweet_url").notNull(), // URL of liked/retweeted tweet
  targetUsername: text("target_username"), // Username of tweet author
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

// Organic Activity Schedule - tracks when each account should do organic activity
export const organicActivitySchedule = pgTable("organic_activity_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(), // Twitter account username
  dailyLikesTarget: integer("daily_likes_target").notNull().default(8), // Random 3-15 likes per day
  likesCompletedToday: integer("likes_completed_today").notNull().default(0),
  lastLikeDate: text("last_like_date"), // YYYY-MM-DD format
  nextLikeTime: timestamp("next_like_time"), // When to do next like
  lastRetweetDate: text("last_retweet_date"), // YYYY-MM-DD when last retweet was done
  nextRetweetDate: text("next_retweet_date"), // YYYY-MM-DD when next retweet should happen (every 3 days)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertOrganicActivitySchema = createInsertSchema(organicActivity).omit({
  id: true,
  createdAt: true,
});

export const insertOrganicActivityScheduleSchema = createInsertSchema(organicActivitySchedule).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganicActivity = z.infer<typeof insertOrganicActivitySchema>;
export type OrganicActivity = typeof organicActivity.$inferSelect;
export type InsertOrganicActivitySchedule = z.infer<typeof insertOrganicActivityScheduleSchema>;
export type OrganicActivitySchedule = typeof organicActivitySchedule.$inferSelect;
