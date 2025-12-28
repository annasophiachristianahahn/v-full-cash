/**
 * TwexAPI Service - Twitter operations via TwexAPI
 * Replaces Playwright-based automation with API calls
 */

import { proxyManager } from './proxyManager';

const TWEXAPI_BASE_URL = 'https://api.twexapi.io';
const TWEXAPI_TOKEN = process.env.TWEXAPI_TOKEN || 'twitterx_23c263ed5aa668f7097c6220bdc95ce2eb028397a2d7cc92';

interface TwexApiResponse {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

/**
 * Extract ct0 token from cookie string
 * Cookie format: "auth_token=xxx;ct0=yyy;other=zzz"
 * Returns: "yyy"
 */
function extractCt0FromCookie(cookieString: string): string | null {
  const ct0Match = cookieString.match(/ct0=([^;]+)/);
  if (ct0Match && ct0Match[1]) {
    return ct0Match[1];
  }

  // If no ct0 found, check if the entire string might be a token
  if (!cookieString.includes('=') && cookieString.length > 20) {
    return cookieString;
  }

  console.error('[TwexAPI] Could not extract ct0 from cookie');
  return null;
}

export class TwexApiService {
  /**
   * Post a reply to a tweet
   */
  async postReply(params: {
    tweetId: string;
    replyText: string;
    username: string;
    twitterCookie: string;
    mediaUrl?: string;
  }): Promise<{ success: boolean; replyId?: string; replyUrl?: string; error?: string }> {
    try {
      const ct0 = extractCt0FromCookie(params.twitterCookie);
      if (!ct0) {
        return { success: false, error: 'Invalid cookie format - could not extract ct0' };
      }

      const proxy = proxyManager.isProxyEnabled()
        ? proxyManager.getProxyForUser(params.username)
        : undefined;

      const requestBody: any = {
        tweet_content: params.replyText,
        cookie: ct0,
        reply_tweet_id: params.tweetId
      };

      if (params.mediaUrl) {
        requestBody.media_url = params.mediaUrl;
      }

      if (proxy) {
        requestBody.proxy = proxy;
      }

      console.log(`[TwexAPI] Posting reply from @${params.username} to tweet ${params.tweetId}${proxy ? ' (via proxy)' : ''}`);

      const response = await fetch(`${TWEXAPI_BASE_URL}/twitter/tweets/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TWEXAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data: TwexApiResponse = await response.json();

      if (!response.ok || !data.success) {
        const errorMsg = data.error || data.message || 'Unknown error from TwexAPI';
        console.error(`[TwexAPI] Reply failed:`, errorMsg);
        console.error(`[TwexAPI] Full response:`, JSON.stringify(data, null, 2));
        console.error(`[TwexAPI] HTTP Status:`, response.status);
        return { success: false, error: errorMsg };
      }

      // Extract tweet ID from response
      const replyId = data.data?.tweet_id || data.data?.id;
      const replyUrl = replyId ? `https://x.com/i/status/${replyId}` : undefined;

      console.log(`[TwexAPI] ✅ Reply posted successfully: ${replyUrl}`);

      return {
        success: true,
        replyId,
        replyUrl
      };

    } catch (error: any) {
      console.error('[TwexAPI] Error posting reply:', error);
      return {
        success: false,
        error: error.message || 'Network error while posting reply'
      };
    }
  }

  /**
   * Like a tweet
   */
  async likeTweet(params: {
    tweetId: string;
    username: string;
    twitterCookie: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const ct0 = extractCt0FromCookie(params.twitterCookie);
      if (!ct0) {
        return { success: false, error: 'Invalid cookie format - could not extract ct0' };
      }

      const proxy = proxyManager.isProxyEnabled()
        ? proxyManager.getProxyForUser(params.username)
        : undefined;

      const requestBody: any = {
        cookie: ct0
      };

      if (proxy) {
        requestBody.proxy = proxy;
      }

      console.log(`[TwexAPI] Liking tweet ${params.tweetId} from @${params.username}${proxy ? ' (via proxy)' : ''}`);

      const response = await fetch(`${TWEXAPI_BASE_URL}/twitter/tweets/${params.tweetId}/like`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TWEXAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data: TwexApiResponse = await response.json();

      if (!response.ok || !data.success) {
        const errorMsg = data.error || data.message || 'Unknown error from TwexAPI';
        console.error(`[TwexAPI] Like failed:`, errorMsg);
        console.error(`[TwexAPI] Full response:`, JSON.stringify(data, null, 2));
        console.error(`[TwexAPI] HTTP Status:`, response.status);
        return { success: false, error: errorMsg };
      }

      console.log(`[TwexAPI] ✅ Tweet liked successfully`);

      return { success: true };

    } catch (error: any) {
      console.error('[TwexAPI] Error liking tweet:', error);
      return {
        success: false,
        error: error.message || 'Network error while liking tweet'
      };
    }
  }

  /**
   * Send a DM
   */
  async sendDM(params: {
    recipientUsername: string;
    message: string;
    senderUsername: string;
    twitterCookie: string;
    replyToMessageId?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const ct0 = extractCt0FromCookie(params.twitterCookie);
      if (!ct0) {
        return { success: false, error: 'Invalid cookie format - could not extract ct0' };
      }

      const proxy = proxyManager.isProxyEnabled()
        ? proxyManager.getProxyForUser(params.senderUsername)
        : undefined;

      const requestBody: any = {
        username: params.recipientUsername,
        msg: params.message,
        cookie: ct0
      };

      if (params.replyToMessageId) {
        requestBody.reply_to = params.replyToMessageId;
      }

      if (proxy) {
        requestBody.proxy = proxy;
      }

      console.log(`[TwexAPI] Sending DM from @${params.senderUsername} to @${params.recipientUsername}${proxy ? ' (via proxy)' : ''}`);

      const response = await fetch(`${TWEXAPI_BASE_URL}/twitter/send-dm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TWEXAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data: TwexApiResponse = await response.json();

      if (!response.ok || !data.success) {
        const errorMsg = data.error || data.message || 'Unknown error from TwexAPI';
        console.error(`[TwexAPI] DM failed:`, errorMsg);
        return { success: false, error: errorMsg };
      }

      console.log(`[TwexAPI] ✅ DM sent successfully`);

      return { success: true };

    } catch (error: any) {
      console.error('[TwexAPI] Error sending DM:', error);
      return {
        success: false,
        error: error.message || 'Network error while sending DM'
      };
    }
  }

  /**
   * Post reply AND like in sequence (for combined operations)
   */
  async postReplyAndLike(params: {
    tweetId: string;
    replyText: string;
    username: string;
    twitterCookie: string;
    mediaUrl?: string;
  }): Promise<{
    replySuccess: boolean;
    replyId?: string;
    replyUrl?: string;
    replyError?: string;
    likeSuccess: boolean;
    likeError?: string;
  }> {
    // Post reply first
    const replyResult = await this.postReply(params);

    // Then like the original tweet
    const likeResult = await this.likeTweet({
      tweetId: params.tweetId,
      username: params.username,
      twitterCookie: params.twitterCookie
    });

    return {
      replySuccess: replyResult.success,
      replyId: replyResult.replyId,
      replyUrl: replyResult.replyUrl,
      replyError: replyResult.error,
      likeSuccess: likeResult.success,
      likeError: likeResult.error
    };
  }
}

export const twexApiService = new TwexApiService();
