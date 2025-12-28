/**
 * Twitter Automation Service - TwexAPI Implementation
 * Replaces Playwright-based automation with TwexAPI calls
 * Maintains same interface for backward compatibility
 */

import { twexApiService } from './twexApiService';

const log = (message: string, level: string = 'INFO') => {
  console.log(`[${new Date().toISOString()}] [TwitterAutomation] [${level}] ${message}`);
};

// Type definitions (maintain compatibility with existing code)
interface ReplyParams {
  tweetId: string;
  replyText: string;
  twitterCookie: string;
  mediaUrl?: string;
  username?: string;
  tweetUrl?: string;
}

interface ReplyResult {
  success: boolean;
  replyId?: string;
  replyUrl?: string;
  error?: string;
}

interface LikeParams {
  tweetUrl?: string;
  tweetId?: string;
  twitterCookie: string;
  username: string;
}

interface LikeResult {
  success: boolean;
  error?: string;
}

interface ReplyAndLikeParams {
  tweetId: string;
  replyText: string;
  twitterCookie: string;
  mediaUrl?: string;
  username?: string;
  tweetUrl?: string;
}

interface ReplyAndLikeResult {
  replySuccess: boolean;
  replyId?: string;
  replyUrl?: string;
  replyError?: string;
  likeSuccess: boolean;
  likeError?: string;
}

interface DMParams {
  recipientUsername: string;
  message: string;
  twitterCookie: string;
  username: string;
}

interface DMResult {
  success: boolean;
  error?: string;
}

export class TwitterAutomationService {
  /**
   * Post a reply to a tweet
   */
  async postReply(params: ReplyParams): Promise<ReplyResult> {
    log(`Posting reply to tweet ${params.tweetId}${params.username ? ` from @${params.username}` : ''}`);

    if (!params.username) {
      return {
        success: false,
        error: 'Username is required for TwexAPI implementation'
      };
    }

    const result = await twexApiService.postReply({
      tweetId: params.tweetId,
      replyText: params.replyText,
      username: params.username,
      twitterCookie: params.twitterCookie,
      mediaUrl: params.mediaUrl
    });

    return result;
  }

  /**
   * Like a tweet
   */
  async likeTweet(params: LikeParams): Promise<LikeResult> {
    // Extract tweet ID from URL if needed
    let tweetId = params.tweetId;
    if (!tweetId && params.tweetUrl) {
      const match = params.tweetUrl.match(/status\/(\d+)/);
      if (match) {
        tweetId = match[1];
      }
    }

    if (!tweetId) {
      return {
        success: false,
        error: 'Could not extract tweet ID from URL'
      };
    }

    log(`Liking tweet ${tweetId} from @${params.username}`);

    const result = await twexApiService.likeTweet({
      tweetId,
      username: params.username,
      twitterCookie: params.twitterCookie
    });

    return result;
  }

  /**
   * Post reply AND like in same operation
   */
  async postReplyAndLike(params: ReplyAndLikeParams): Promise<ReplyAndLikeResult> {
    log(`Posting reply + like to tweet ${params.tweetId}${params.username ? ` from @${params.username}` : ''}`);

    if (!params.username) {
      return {
        replySuccess: false,
        replyError: 'Username is required for TwexAPI implementation',
        likeSuccess: false,
        likeError: 'Username is required'
      };
    }

    const result = await twexApiService.postReplyAndLike({
      tweetId: params.tweetId,
      replyText: params.replyText,
      username: params.username,
      twitterCookie: params.twitterCookie,
      mediaUrl: params.mediaUrl
    });

    return result;
  }

  /**
   * Send a DM
   */
  async sendDM(params: DMParams): Promise<DMResult> {
    log(`Sending DM from @${params.username} to @${params.recipientUsername}`);

    const result = await twexApiService.sendDM({
      recipientUsername: params.recipientUsername,
      message: params.message,
      senderUsername: params.username,
      twitterCookie: params.twitterCookie
    });

    return result;
  }

  /**
   * Get list of accounts the user follows
   */
  async getFollowing(params: {
    twitterCookie: string;
    username: string;
    limit?: number;
  }): Promise<{ success: boolean; following?: Array<{ userId: string; username: string; name: string }>; error?: string }> {
    log(`Getting following list for @${params.username}`);

    const result = await twexApiService.getFollowing({
      twitterCookie: params.twitterCookie,
      username: params.username,
      limit: params.limit
    });

    return result;
  }

  /**
   * Search for tweets from a specific user
   */
  async searchTweetsByUser(params: {
    twitterCookie: string;
    username: string;
    targetUsername: string;
    maxItems?: number;
  }): Promise<{ success: boolean; tweets?: Array<{ tweetId: string; tweetUrl: string; text: string; authorHandle: string }>; error?: string }> {
    log(`Searching tweets from @${params.targetUsername}`);

    const result = await twexApiService.advancedSearch({
      searchTerms: [`from:${params.targetUsername}`],
      username: params.username,
      twitterCookie: params.twitterCookie,
      maxItems: params.maxItems || 5,
      sortBy: 'Latest'
    });

    return result;
  }

  /**
   * Retweet a tweet
   */
  async retweet(params: {
    tweetUrl: string;
    twitterCookie: string;
    username: string;
  }): Promise<{ success: boolean; error?: string }> {
    // Extract tweet ID from URL
    const match = params.tweetUrl.match(/status\/(\d+)/);
    if (!match) {
      return {
        success: false,
        error: 'Could not extract tweet ID from URL'
      };
    }

    const tweetId = match[1];
    log(`Retweeting tweet ${tweetId} from @${params.username}`);

    const result = await twexApiService.retweet({
      tweetId,
      username: params.username,
      twitterCookie: params.twitterCookie
    });

    return result;
  }
}

export const twitterAutomation = new TwitterAutomationService();
