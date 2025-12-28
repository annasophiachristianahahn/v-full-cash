import { rateLimiter } from "./rateLimiter";

interface BotAnalysisResponse {
  isBot: boolean;
  confidence: number;
  reasons: string[];
}

export class OpenRouterService {
  private apiKey: string;
  private baseUrl = "https://openrouter.ai/api/v1";
  private spamPhrases = [
    'trending', 'trend', 'i gave you', 'whale', 'marketcap', 'market cap', 
    'buying now', 'buy now', 'coinmarketcal', 'token unlock', 'whale purchases', 
    'value inflow', 'smarttrader', 'whale just sold', 'whale just bought', 'gainer',
    'vip', 'telegram', 'tg', 'private'
  ]; // Case insensitive spam phrases

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is required");
    }
  }

  // Check if tweet content contains known spam phrases (case insensitive)
  private containsSpamPhrases(content: string): { isSpam: boolean; matchedPhrase?: string } {
    const contentLower = content.toLowerCase();
    console.log(`[SPAM CHECK] Checking content: "${content.substring(0, 100)}..." against phrases: ${this.spamPhrases.join(', ')}`);
    
    for (const phrase of this.spamPhrases) {
      if (contentLower.includes(phrase)) {
        console.log(`[SPAM DETECTED] Found phrase "${phrase}" in content`);
        return { isSpam: true, matchedPhrase: phrase };
      }
    }
    
    console.log(`[SPAM CHECK] No spam phrases found`);
    return { isSpam: false };
  }

  async analyzeBotProbability(tweet: {
    content: string;
    authorName: string;
    authorHandle: string;
    authorFollowers: number;
    likes: number;
    retweets: number;
  }): Promise<BotAnalysisResponse> {
    // Pre-filter: Check for known spam phrases
    const spamCheck = this.containsSpamPhrases(tweet.content);
    if (spamCheck.isSpam) {
      console.log(`Tweet ${tweet.content.substring(0, 50)}... marked as bot due to spam phrase: "${spamCheck.matchedPhrase}"`);
      return {
        isBot: true,
        confidence: 1.0,
        reasons: [`Contains spam phrase: "${spamCheck.matchedPhrase}"`]
      };
    }
    const prompt = `Analyze this tweet to determine if it was likely written by a bot or human. Consider factors like:
- Content quality and naturalness
- Username patterns  
- Engagement ratios
- Writing style
- Promotional/spam indicators
- Automated trading/whale tracking patterns
- Copy-paste template structures
- Excessive use of emojis and symbols
- Price/market data formatting

EXAMPLES OF BOT TWEETS TO IDENTIFY:
1. "🚨 $TROLL whale just sold $34100 of $TROLL 🐋 👇 📊 Coin: $TROLL (TROLL) 💰 Marketcap: $139.90M 💰 Amount: $34100 🚀 CA: 5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2"
2. "🔔 Upcoming Events Today by Coinmarketcal: $KAITO | 8 35MM Token Unlock $VELO | 3B Token Unlock $RSV | Burn $TWT | AMA with PancakeSwap"
3. "1/ SmartTrader Value inflow trend on large-cap coins in the past hour (top 10). NO.1 $Fartcoin +$391.44K NO.2 $TRUMP +$180.70K"
4. "🐳 Whale token purchases 🐳 🛍️ Fartcoin $Fartcoin 4 whales 🛍️ SLERF $SLERF 3 whales"
5. "🔥 Top memecoins gainer on Solana last 7D! What's your moonshot pick?👇 $DOODI @DoodiPals $RETIRE @thelastplaysol $OUTLAW @outlawgamefi $TOKABU @TokabuTheSpirit $LOOK @lookdotfun $A47 @a47news_ai $BAN @ban_comedian $WORTHLESS @Worthless_SOL_ $AVA @AVA_holo $SOL"
6. "💥 $Tokabu is on another level! 💹 $52k → $47.8M MC → 919x explosion! ⚡ ✅ Token: You Owed Respect ⛓️ Chain: #Solana 👉 Don't miss the next mega move—join my VIP TG now! Ca: H8xQ6poBjB9DTPMDTKWzWPrnxu4bDEhybxiouF8Ppump #memecoin"
7. "The pump fun ecosystem is picking up! 🔥 $RUNNER +160.2% $BAGWORK +59.2% $RETIRE +39.8% $BUN COIN +29.1% $TOKABU +9.3%"
8. "$Tokabu is going crazy in my private TG right now — absolute printing mode! 🚀🔥 Only the real ones inside are catching these moves. 💯 Ca: H8xQ6poBjB9DTPMDTKWzWPrnxu4bDEhybxiouF8Ppump"
9. "3x plus, 270k now 200k $ASTHERUS $Crypto #JoyBoyLuffy $ASTHERUS"
10. "5x plus, 875k now 770k $IRL $Crypto #JoyBoyLuffy $"
11. "36x, 5.4M now 1.7M $RUNNER $Crypto #JoyBoyLuffy $"
12. "7.5x plus, 1.8M $AQC $Crypto #JoyBoyLuffy $YARL"
13. "//tier_anomaly: #e30// $elizabeth captures viral interest, driven by perceived endorsement from solana's @aeyakovenko and its announced 'animal launchpad' utility. community is circulating screenshots of @aeyakovenko's interactions as de-facto endorsement, amplified by @solanamobile reposts. the launchpad's 0.2% buy-and-burn mechanism and a 23% supply burn have created a strong deflationary narrative, reversing declining interest into explosive growth. the social layer is coalescing around the 'solana mascot' narrative, a pattern mirroring the success of $myro. attention is fixated on the dual drivers of perceived founder backing and tangible deflationary tokenomics. the complete data stream is being processed on the aikaxbt terminal."

These are clearly automated bot posts with:
- Template structures with repeated emoji patterns
- Automated whale/trading tracking
- Formatted price/market data
- Multiple ticker symbols in lists
- Excessive special characters and emojis
- No natural human conversation

Tweet data:
Author: ${tweet.authorName} (@${tweet.authorHandle})
Followers: ${tweet.authorFollowers}
Content: "${tweet.content}"
Likes: ${tweet.likes}
Retweets: ${tweet.retweets}

Respond with JSON in this exact format:
{
  "isBot": boolean,
  "confidence": number (0-1),
  "reasons": ["reason1", "reason2", ...]
}`;

    try {
      await rateLimiter.acquire('openrouter');
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.REPLIT_DOMAINS?.split(',')[0] || 'http://localhost:5000',
          'X-Title': 'vaj auto cash'
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo", // Much cheaper model for bot detection
          messages: [
            {
              role: "system",
              content: "You are an expert at detecting bot-generated content on social media. Analyze tweets for bot-like patterns and respond with structured JSON."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" },
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const analysis = JSON.parse(content);

      return {
        isBot: analysis.isBot || false,
        confidence: Math.max(0, Math.min(1, analysis.confidence || 0)),
        reasons: Array.isArray(analysis.reasons) ? analysis.reasons : []
      };
    } catch (error) {
      console.error('Error analyzing tweet for bot detection:', error);
      // Mark as unknown on error - these should be excluded from results  
      return {
        isBot: null as any,
        confidence: 0,
        reasons: ["Analysis failed due to API error - should be excluded"]
      };
    }
  }

  async batchAnalyzeTweets(tweets: any[]): Promise<Map<string, BotAnalysisResponse>> {
    const results = new Map<string, BotAnalysisResponse>();
    
    // First, apply spam filtering to ALL tweets (cheap pre-filter)
    const nonSpamTweets = [];
    for (const tweet of tweets) {
      const spamCheck = this.containsSpamPhrases(tweet.content);
      if (spamCheck.isSpam) {
        results.set(tweet.tweetId, {
          isBot: true,
          confidence: 1.0,
          reasons: [`Contains spam phrase: "${spamCheck.matchedPhrase}"`]
        });
      } else {
        nonSpamTweets.push(tweet);
      }
    }
    
    // Analyze ALL non-spam tweets with no limits
    const tweetsToAnalyze = nonSpamTweets;
    console.log(`Analyzing all ${tweetsToAnalyze.length} non-spam tweets for bot detection`);
    
    // Process tweets in batches to respect rate limits
    const batchSize = 5;
    for (let i = 0; i < tweetsToAnalyze.length; i += batchSize) {
      const batch = tweetsToAnalyze.slice(i, i + batchSize);
      const promises = batch.map(async (tweet) => {
        try {
          // All tweets here are already non-spam, proceed with AI analysis
          const analysis = await this.analyzeBotProbability(tweet);
          results.set(tweet.tweetId, analysis);
        } catch (error) {
          console.error(`Error analyzing tweet ${tweet.tweetId}:`, error);
          results.set(tweet.tweetId, {
            isBot: null as any,
            confidence: 0,
            reasons: ["Analysis failed - should be excluded"]
          });
        }
      });
      
      await Promise.all(promises);
      
      // Add delay between batches to avoid rate limiting
      if (i + batchSize < tweetsToAnalyze.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  async generateReply(tweetText: string, systemPrompt: string): Promise<string> {
    await rateLimiter.acquire('openrouter');

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.REPLIT_DOMAINS?.split(',')[0] || 'http://localhost:5000',
        'X-Title': 'vaj auto cash'
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
        ],
        max_tokens: 280
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }
}
