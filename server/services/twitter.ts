interface TwitterUser {
  id: string;
  name: string;
  username: string;
  public_metrics: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
  profile_image_url?: string;
  verified?: boolean;
}

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
  };
  referenced_tweets?: Array<{
    type: string;
    id: string;
  }>;
  entities?: {
    cashtags?: Array<{
      start: number;
      end: number;
      tag: string;
    }>;
  };
}

interface TwitterAPIResponse {
  tweets: TwitterAPITweet[];
  has_next_page: boolean;
  next_cursor: string;
}

interface TwitterAPITweet {
  type: string;
  id: string;
  url: string;
  text: string;
  source: string;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  viewCount: number;
  createdAt: string;
  lang: string;
  bookmarkCount: number;
  isReply: boolean;
  inReplyToId?: string;
  conversationId: string;
  inReplyToUserId?: string;
  inReplyToUsername?: string;
  author: TwitterAPIUser;
  entities?: {
    hashtags?: Array<{
      indices: number[];
      text: string;
    }>;
    urls?: Array<{
      display_url: string;
      expanded_url: string;
      indices: number[];
      url: string;
    }>;
    user_mentions?: Array<{
      id_str: string;
      name: string;
      screen_name: string;
    }>;
  };
}

interface TwitterAPIUser {
  type: string;
  userName: string;
  url: string;
  id: string;
  name: string;
  isBlueVerified: boolean;
  verifiedType?: string;
  profilePicture?: string;
  coverPicture?: string;
  description?: string;
  location?: string;
  followers: number;
  following: number;
  canDm: boolean;
  createdAt: string;
  favouritesCount: number;
  hasCustomTimelines: boolean;
  isTranslator: boolean;
  mediaCount: number;
  statusesCount: number;
}

export class TwitterService {
  private apiKey: string;
  private baseUrl = "https://api.twitterapi.io";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.TWITTERAPI_IO_KEY || "";
    if (!this.apiKey) {
      throw new Error("TwitterAPI.io API key is required");
    }
  }

  private async makeRequest(endpoint: string, params: URLSearchParams): Promise<TwitterAPIResponse> {
    const url = `${this.baseUrl}${endpoint}?${params.toString()}`;
    
    const response = await fetch(url, {
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TwitterAPI.io error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  private getTimeFilter(timeRange: string): string {
    const now = new Date();
    let startTime: Date;

    switch (timeRange) {
      case "1h":
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "3h":
        startTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        break;
      case "6h":
        startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        break;
      case "12h":
        startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        break;
      case "24h":
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
    }

    return startTime.toISOString();
  }

  async searchTweets(cashtag: string, options: {
    timeRange: string;
    maxResults: number;
    excludeRetweets: boolean;
    verifiedOnly: boolean;
  }) {

    const allTweets: TwitterAPITweet[] = [];
    const startTime = this.getTimeFilter(options.timeRange);
    
    // Build query using twitterapi.io search syntax
    let query = `"$${cashtag}"`; // Search for exact cashtag
    
    if (options.excludeRetweets) {
      query += " -filter:retweets";
    }
    
    if (options.verifiedOnly) {
      query += " filter:verified";
    }

    // Add time filter using since parameter
    query += ` since:${startTime.substring(0, 10)}`; // Convert ISO to YYYY-MM-DD format

    let cursor: string = "";
    let totalCollected = 0;
    let apiCallCount = 0;
    let retryCount = 0;
    const maxApiCalls = 3; // Allow more calls since twitterapi.io is cheaper
    
    // Paginate through results
    while (totalCollected < options.maxResults && apiCallCount < maxApiCalls) {
      const params = new URLSearchParams({
        query,
        queryType: "Latest"
      });

      if (cursor) {
        params.set("cursor", cursor);
      }

      try {
        console.log(`API call ${apiCallCount + 1}/${maxApiCalls} for ${cashtag}`);
        
        const response = await this.makeRequest("/twitter/tweet/advanced_search", params);
        
        // Only increment counter after successful response
        apiCallCount++;
        retryCount = 0; // Reset retry count on success
        
        if (!response.tweets || response.tweets.length === 0) {
          break; // No more results
        }

        // Filter tweets that contain the exact cashtag and are within time range
        const validTweets = response.tweets.filter((tweet: TwitterAPITweet) => {
          // Check if tweet contains the cashtag (case insensitive)
          const cashtagPattern = new RegExp(`\\$${cashtag}\\b`, 'i');
          const containsCashtag = cashtagPattern.test(tweet.text);
          
          // Check if tweet is within time boundary
          const tweetTime = new Date(tweet.createdAt);
          const isInTimeRange = tweetTime >= new Date(startTime);
          
          return containsCashtag && isInTimeRange;
        });

        if (validTweets.length === 0 && response.tweets.length > 0) {
          // If we have tweets but none match our criteria, continue to next page
          if (response.has_next_page) {
            cursor = response.next_cursor;
            continue;
          } else {
            break;
          }
        }

        allTweets.push(...validTweets);
        totalCollected += validTweets.length;

        // Early stopping: if we have decent results, don't keep burning API calls
        const earlyStopThreshold = Math.max(Math.ceil(options.maxResults * 0.8), 10);
        if (totalCollected >= earlyStopThreshold) {
          console.log(`Early stopping at ${totalCollected} tweets (threshold: ${earlyStopThreshold}) to conserve API credits`);
          break;
        }

        // Check if there are more pages
        if (!response.has_next_page) {
          break; // No more pages
        }
        cursor = response.next_cursor;

        // Rate limiting: small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error: any) {
        console.error(`[SEARCH ERROR] Search request failed for cashtag: $${cashtag}`);
        console.error(`[SEARCH ERROR] Error details:`, {
          message: error.message,
          stack: error.stack,
          name: error.name,
          fullError: error
        });
        console.error(`[SEARCH ERROR] Query parameters:`, {
          query,
          cursor,
          apiCallCount,
          totalCollected
        });
        console.error(`[SEARCH ERROR] API Key configured:`, !!this.apiKey);
        console.error(`[SEARCH ERROR] API Key length:`, this.apiKey?.length || 0);

        // Handle rate limiting with exponential backoff - don't count against API budget
        if (error.message?.includes('429') || error.message?.includes('rate limit')) {
          retryCount++;
          if (retryCount > 3) {
            console.log(`Max retries reached for rate limiting, stopping search`);
            break;
          }

          const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 8000);
          console.log(`Rate limited, backing off for ${backoffTime}ms (retry ${retryCount}/3)`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue; // Retry the same request without incrementing apiCallCount
        }

        break; // For other errors, stop pagination
      }
    }

    if (allTweets.length === 0) {
      return [];
    }

    // Remove any duplicate tweets by ID (shouldn't happen with pagination, but safety check)
    const uniqueTweets = allTweets.filter((tweet, index, self) => 
      index === self.findIndex(t => t.id === tweet.id)
    );

    const result = uniqueTweets.map((tweet: TwitterAPITweet) => {
      return {
        tweetId: tweet.id,
        content: tweet.text,
        authorId: tweet.author.id,
        authorName: tweet.author.name,
        authorHandle: tweet.author.userName,
        authorFollowers: tweet.author.followers,
        authorAvatar: tweet.author.profilePicture,
        likes: tweet.likeCount,
        retweets: tweet.retweetCount,
        url: tweet.url,
        publishedAt: new Date(tweet.createdAt),
        isBot: false,
        // Reply information
        isReply: tweet.isReply || false,
        inReplyToTweetId: tweet.inReplyToId || null,
        inReplyToUserId: tweet.inReplyToUserId || null,
        inReplyToUsername: tweet.inReplyToUsername || null,
        // Initialize parent tweet fields (will be populated later if criteria are met)
        parentTweetUrl: null,
        parentTweetContent: null,
        parentTweetAuthor: null,
        parentTweetFollowers: null,
        parentTweetReplies: null,
        parentTweetAge: null,
        meetsReplyCriteria: false
      };
    });

    // Filter out tweets from accounts with 'agent' in name or handle
    const filteredResults = result.filter(tweet => {
      const hasAgentInName = tweet.authorName.toLowerCase().includes('agent');
      const hasAgentInHandle = tweet.authorHandle.toLowerCase().includes('agent');
      
      if (hasAgentInName || hasAgentInHandle) {
        console.log(`Filtering out tweet from agent account: @${tweet.authorHandle} (${tweet.authorName})`);
        return false;
      }
      return true;
    });

    // Sort by most recent first and limit results
    const finalResults = filteredResults
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, options.maxResults);
    
    console.log(`Search completed: ${finalResults.length} results using ${apiCallCount} API calls`);
    
    // Process reply tweets to check additional criteria
    const processedResults = await this.processReplyTweets(finalResults);
    
    return processedResults;
  }

  async filterByFollowerCount(tweets: any[], minFollowers: number, maxFollowers: number) {
    return tweets.filter(tweet => 
      tweet.authorFollowers >= minFollowers && 
      tweet.authorFollowers <= maxFollowers
    );
  }

  // Try to fetch parent tweet details using the user's timeline
  async fetchParentTweetDetails(parentTweetId: string, parentUsername: string): Promise<{
    content?: string;
    author?: string;
    followers?: number;
    replies?: number;
    ageMinutes?: number;
    url?: string;
  } | null> {
    try {
      const params = new URLSearchParams({
        userName: parentUsername
      });

      const response = await this.makeRequest("/twitter/user/last_tweets", params);
      
      if (!response.tweets || response.tweets.length === 0) {
        return null;
      }

      // Look for the specific tweet ID in the user's recent tweets
      const parentTweet = response.tweets.find((tweet: TwitterAPITweet) => tweet.id === parentTweetId);
      
      if (!parentTweet) {
        console.log(`Parent tweet ${parentTweetId} not found in ${parentUsername}'s recent tweets`);
        return null;
      }

      const tweetAge = new Date();
      const tweetCreatedAt = new Date(parentTweet.createdAt);
      const ageMinutes = Math.floor((tweetAge.getTime() - tweetCreatedAt.getTime()) / (1000 * 60));

      return {
        content: parentTweet.text,
        author: parentTweet.author.name,
        followers: parentTweet.author.followers,
        replies: parentTweet.replyCount,
        ageMinutes,
        url: parentTweet.url
      };
    } catch (error) {
      console.warn(`Failed to fetch parent tweet details for ${parentTweetId}:`, error);
      return null;
    }
  }

  // Check if a reply meets the additional criteria
  checkReplyCriteria(parentTweetDetails: {
    followers?: number;
    replies?: number;
    ageMinutes?: number;
  }): boolean {
    if (!parentTweetDetails.followers || !parentTweetDetails.replies || parentTweetDetails.ageMinutes === undefined) {
      return false;
    }

    // Check the three criteria:
    // 1. Tweet is less than 1 hour old (60 minutes)
    // 2. Author has 500-20k followers  
    // 3. Original post has fewer than 40 responses
    return (
      parentTweetDetails.ageMinutes < 60 &&
      parentTweetDetails.followers >= 500 &&
      parentTweetDetails.followers <= 20000 &&
      parentTweetDetails.replies < 40
    );
  }

  // Process replies to check if they meet additional criteria
  async processReplyTweets(tweets: any[]): Promise<any[]> {
    const processedTweets = [];
    const addedParentTweetIds = new Set(); // Track parent tweets we've already added

    for (const tweet of tweets) {
      if (tweet.isReply && tweet.inReplyToTweetId && tweet.inReplyToUsername) {
        console.log(`Processing reply tweet ${tweet.tweetId} -> ${tweet.inReplyToTweetId}`);
        
        const parentTweetDetails = await this.fetchParentTweetDetails(
          tweet.inReplyToTweetId,
          tweet.inReplyToUsername
        );

        if (parentTweetDetails) {
          const meetsReplyCriteria = this.checkReplyCriteria(parentTweetDetails);
          
          if (meetsReplyCriteria) {
            console.log(`Reply tweet ${tweet.tweetId} meets criteria - including parent tweet details`);
            tweet.parentTweetUrl = parentTweetDetails.url;
            tweet.parentTweetContent = parentTweetDetails.content;
            tweet.parentTweetAuthor = parentTweetDetails.author;
            tweet.parentTweetFollowers = parentTweetDetails.followers;
            tweet.parentTweetReplies = parentTweetDetails.replies;
            tweet.parentTweetAge = parentTweetDetails.ageMinutes;
            tweet.meetsReplyCriteria = true;

            // Also add the parent tweet as a separate result if not already added
            if (!addedParentTweetIds.has(tweet.inReplyToTweetId)) {
              addedParentTweetIds.add(tweet.inReplyToTweetId);
              console.log(`Adding parent tweet ${tweet.inReplyToTweetId} as separate result`);
              
              const parentTweet = {
                tweetId: tweet.inReplyToTweetId,
                content: parentTweetDetails.content || '',
                authorId: null, // Not available in current API response
                authorName: parentTweetDetails.author || '',
                authorHandle: tweet.inReplyToUsername,
                authorFollowers: parentTweetDetails.followers || 0,
                authorAvatar: null, // Not available in current API response
                likes: 0, // Not available in current API response
                retweets: 0, // Not available in current API response
                url: parentTweetDetails.url || '',
                publishedAt: new Date(Date.now() - ((parentTweetDetails.ageMinutes || 0) * 60 * 1000)),
                isBot: false,
                isReply: false,
                inReplyToTweetId: null,
                inReplyToUserId: null,
                inReplyToUsername: null,
                parentTweetUrl: null,
                parentTweetContent: null,
                parentTweetAuthor: null,
                parentTweetFollowers: null,
                parentTweetReplies: null,
                parentTweetAge: null,
                meetsReplyCriteria: false,
                isParentTweet: true // Flag to identify this as a qualifying parent tweet
              };
              
              processedTweets.push(parentTweet);
            }
          } else {
            console.log(`Reply tweet ${tweet.tweetId} does not meet criteria (age: ${parentTweetDetails.ageMinutes}m, followers: ${parentTweetDetails.followers}, replies: ${parentTweetDetails.replies})`);
          }
        }

        // Add a small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      processedTweets.push(tweet);
    }

    return processedTweets;
  }

  // Login to Twitter and get session data using V2 endpoint
  async login(username: string, password: string, twoFactorSecret?: string, proxyUrl?: string, email?: string): Promise<any> {
    try {
      // TwitterAPI.io requires a proxy - empty strings cause 404 errors
      if (!proxyUrl) {
        throw new Error('Proxy URL is required. TwitterAPI.io requires a proxy for login and posting. Please add a proxy URL in Twitter Settings.');
      }

      const loginUrl = `${this.baseUrl}/twitter/user_login_v2`;
      const loginBody: any = {
        user_name: username,
        email: email || username, // If no email provided, try username
        password,
        proxy: proxyUrl
      };
      
      // Only include totp_secret if it's provided (don't send empty string)
      if (twoFactorSecret) {
        loginBody.totp_secret = twoFactorSecret;
      }
      
      console.log('Twitter Login Request (V2):', {
        url: loginUrl,
        hasApiKey: !!this.apiKey,
        user_name: username?.substring(0, 3) + '***',
        hasPassword: !!password,
        hasTotpSecret: !!twoFactorSecret,
        proxy: proxyUrl
      });
      
      const loginResponse = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loginBody)
      });

      if (!loginResponse.ok) {
        const error = await loginResponse.text();
        throw new Error(`Login failed: ${loginResponse.status} - ${error}`);
      }

      const loginData = await loginResponse.json();
      
      console.log('Twitter Login Response:', JSON.stringify(loginData, null, 2));
      
      if (loginData.status === 'error') {
        throw new Error(loginData.msg || loginData.message || JSON.stringify(loginData));
      }

      return loginData;
    } catch (error) {
      console.error('Twitter login error:', error);
      throw error;
    }
  }

  // Post a reply to a tweet using V2 endpoint
  async postReply(tweetId: string, replyText: string, username?: string, password?: string, proxyUrl?: string, sessionData?: any, twoFactorSecret?: string, email?: string): Promise<{ success: boolean; replyUrl?: string; replyId?: string }> {
    try {
      // Check if proxy is available - Twitter API requires it
      if (!proxyUrl) {
        throw new Error('Proxy URL is required. TwitterAPI.io requires a proxy for posting tweets. Get a free proxy at Webshare.io and add it in Twitter Settings.');
      }

      // Use provided credentials or fallback to environment variables
      const twitterUsername = username || process.env.TWITTER_USERNAME;
      const twitterPassword = password || process.env.TWITTER_PASSWORD;

      if (!twitterUsername || !twitterPassword) {
        throw new Error('Twitter credentials not configured');
      }

      // Attempt to login (this is a simplified version)
      // In practice, you'd want to cache session data and only login when needed
      let loginCookies = sessionData?.login_cookie || sessionData;
      
      if (!loginCookies) {
        const loginResult = await this.login(twitterUsername, twitterPassword, twoFactorSecret, proxyUrl, email);
        loginCookies = loginResult.login_cookie;
      }

      // Post the reply using V2 endpoint
      const replyResponse = await fetch(`${this.baseUrl}/twitter/create_tweet_v2`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          login_cookies: loginCookies,
          tweet_text: replyText,
          reply_to_tweet_id: tweetId,
          proxy: proxyUrl
        })
      });

      if (!replyResponse.ok) {
        const error = await replyResponse.text();
        throw new Error(`Failed to post reply: ${replyResponse.status} - ${error}`);
      }

      const replyData = await replyResponse.json();
      
      if (replyData.status === 'error') {
        throw new Error(replyData.msg || 'Failed to post reply');
      }
      
      // Construct the reply URL
      const replyUrl = replyData.tweet_id ? `https://twitter.com/${twitterUsername}/status/${replyData.tweet_id}` : undefined;

      return {
        success: true,
        replyUrl,
        replyId: replyData.tweet_id
      };
    } catch (error) {
      console.error('Error posting tweet reply:', error);
      // Throw the error so we can see what's actually wrong
      throw error;
    }
  }
}
