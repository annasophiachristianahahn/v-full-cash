/**
 * TwexAPI Service - Twitter operations via TwexAPI
 * Replaces Playwright-based automation with API calls
 */

import { proxyManager } from './proxyManager';

const TWEXAPI_BASE_URL = 'https://api.twexapi.io';
const TWEXAPI_TOKEN = process.env.TWEXAPI_TOKEN || 'twitterx_23c263ed5aa668f7097c6220bdc95ce2eb028397a2d7cc92';

interface TwexApiResponse {
  code: number;
  msg: string;
  data?: any;
  // Legacy fields for backward compatibility
  success?: boolean;
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
      // TwexAPI accepts the full cookie string
      const fullCookie = params.twitterCookie;

      const proxy = proxyManager.isProxyEnabled()
        ? proxyManager.getProxyForUser(params.username)
        : undefined;

      const requestBody: any = {
        tweet_content: params.replyText,
        cookie: fullCookie,
        reply_tweet_id: params.tweetId
      };

      if (params.mediaUrl) {
        requestBody.media_url = params.mediaUrl;
      }

      if (proxy) {
        requestBody.proxy = proxy;
      }

      console.log(`[TwexAPI] ========== POST REPLY REQUEST ==========`);
      console.log(`[TwexAPI] URL: ${TWEXAPI_BASE_URL}/twitter/tweets/create`);
      console.log(`[TwexAPI] Method: POST`);
      console.log(`[TwexAPI] Headers:`, JSON.stringify({
        'Authorization': `Bearer ${TWEXAPI_TOKEN.substring(0, 20)}...`,
        'Content-Type': 'application/json'
      }, null, 2));
      console.log(`[TwexAPI] Request Body:`, JSON.stringify({
        ...requestBody,
        cookie: `${requestBody.cookie.substring(0, 50)}... [${requestBody.cookie.length} chars total]`,
        proxy: proxy ? `${proxy.substring(0, 30)}...` : undefined
      }, null, 2));

      const response = await fetch(`${TWEXAPI_BASE_URL}/twitter/tweets/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TWEXAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data: TwexApiResponse = await response.json();

      console.log(`[TwexAPI] ========== POST REPLY RESPONSE ==========`);
      console.log(`[TwexAPI] HTTP Status: ${response.status} ${response.statusText}`);
      console.log(`[TwexAPI] Response Body:`, JSON.stringify(data, null, 2));

      // TwexAPI uses 'code' and 'msg' fields
      // Success is indicated by HTTP 200 and code in 200-299 range OR msg === 'success'
      const isSuccess = response.ok && (data.msg === 'success' || (data.code >= 200 && data.code < 300));

      if (!isSuccess) {
        const errorMsg = data.msg || data.error || data.message || 'Unknown error from TwexAPI';
        console.error(`[TwexAPI] ❌ Reply failed - HTTP ${response.status}: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      // Check if TwexAPI returned a Twitter error code in the data
      if (data.data?.code && !data.data?.tweet_id) {
        const twitterErrorCode = data.data.code;
        const errorMessages: Record<number, string> = {
          90: 'Rate limit exceeded or invalid/expired token',
          89: 'Invalid or expired token',
          326: 'Account locked',
          261: 'Application cannot perform write actions'
        };
        const errorMsg = errorMessages[twitterErrorCode] || `Twitter error code ${twitterErrorCode}`;
        console.error(`[TwexAPI] Twitter API error in response:`, errorMsg);
        return { success: false, error: `Twitter API error: ${errorMsg}` };
      }

      // Try multiple extraction methods
      const replyId = data.data?.tweet_id || data.data?.id || data.data?.rest_id || (typeof data.data === 'string' ? data.data : null);

      if (!replyId) {
        console.error(`[TwexAPI] No tweet ID in successful response - tweet may not have been posted`);
        return { success: false, error: 'Tweet posted but no ID returned - verify on Twitter' };
      }

      const replyUrl = `https://x.com/i/status/${replyId}`;
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
      // TwexAPI accepts the full cookie string
      const fullCookie = params.twitterCookie;

      const proxy = proxyManager.isProxyEnabled()
        ? proxyManager.getProxyForUser(params.username)
        : undefined;

      const requestBody: any = {
        cookie: fullCookie
      };

      if (proxy) {
        requestBody.proxy = proxy;
      }

      console.log(`[TwexAPI] ========== LIKE TWEET REQUEST ==========`);
      console.log(`[TwexAPI] URL: ${TWEXAPI_BASE_URL}/twitter/tweets/${params.tweetId}/like`);
      console.log(`[TwexAPI] Method: POST`);
      console.log(`[TwexAPI] Headers:`, JSON.stringify({
        'Authorization': `Bearer ${TWEXAPI_TOKEN.substring(0, 20)}...`,
        'Content-Type': 'application/json'
      }, null, 2));
      console.log(`[TwexAPI] Request Body:`, JSON.stringify({
        ...requestBody,
        cookie: `${requestBody.cookie.substring(0, 50)}... [${requestBody.cookie.length} chars total]`,
        proxy: proxy ? `${proxy.substring(0, 30)}...` : undefined
      }, null, 2));

      const response = await fetch(`${TWEXAPI_BASE_URL}/twitter/tweets/${params.tweetId}/like`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TWEXAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data: TwexApiResponse = await response.json();

      console.log(`[TwexAPI] ========== LIKE TWEET RESPONSE ==========`);
      console.log(`[TwexAPI] HTTP Status: ${response.status} ${response.statusText}`);
      console.log(`[TwexAPI] Response Body:`, JSON.stringify(data, null, 2));

      // TwexAPI uses 'code' and 'msg' fields
      const isSuccess = response.ok && (data.msg === 'success' || (data.code >= 200 && data.code < 300));

      if (!isSuccess) {
        const errorMsg = data.msg || data.error || data.message || 'Unknown error from TwexAPI';
        console.error(`[TwexAPI] ❌ Like failed - HTTP ${response.status}: ${errorMsg}`);
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
      // TwexAPI accepts the full cookie string
      const fullCookie = params.twitterCookie;

      const proxy = proxyManager.isProxyEnabled()
        ? proxyManager.getProxyForUser(params.senderUsername)
        : undefined;

      const requestBody: any = {
        username: params.recipientUsername,
        msg: params.message,
        cookie: fullCookie
      };

      if (params.replyToMessageId) {
        requestBody.reply_to = params.replyToMessageId;
      }

      if (proxy) {
        requestBody.proxy = proxy;
      }

      console.log(`[TwexAPI] ========== SEND DM REQUEST ==========`);
      console.log(`[TwexAPI] URL: ${TWEXAPI_BASE_URL}/twitter/send-dm`);
      console.log(`[TwexAPI] Method: POST`);
      console.log(`[TwexAPI] Headers:`, JSON.stringify({
        'Authorization': `Bearer ${TWEXAPI_TOKEN.substring(0, 20)}...`,
        'Content-Type': 'application/json'
      }, null, 2));
      console.log(`[TwexAPI] Request Body:`, JSON.stringify({
        ...requestBody,
        cookie: `${requestBody.cookie.substring(0, 50)}... [${requestBody.cookie.length} chars total]`,
        proxy: proxy ? `${proxy.substring(0, 30)}...` : undefined
      }, null, 2));

      const response = await fetch(`${TWEXAPI_BASE_URL}/twitter/send-dm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TWEXAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data: TwexApiResponse = await response.json();

      console.log(`[TwexAPI] ========== SEND DM RESPONSE ==========`);
      console.log(`[TwexAPI] HTTP Status: ${response.status} ${response.statusText}`);
      console.log(`[TwexAPI] Response Body:`, JSON.stringify(data, null, 2));

      // TwexAPI uses 'code' and 'msg' fields
      const isSuccess = response.ok && (data.msg === 'success' || (data.code >= 200 && data.code < 300));

      if (!isSuccess) {
        const errorMsg = data.msg || data.error || data.message || 'Unknown error from TwexAPI';
        console.error(`[TwexAPI] ❌ DM failed - HTTP ${response.status}: ${errorMsg}`);
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
