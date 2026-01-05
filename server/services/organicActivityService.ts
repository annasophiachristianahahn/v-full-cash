import { getStorage } from '../storage';
import { twitterAutomation } from './twitterAutomation';

const log = (message: string, level: string = 'INFO') => {
  console.log(`[${new Date().toISOString()}] [OrganicActivity] [${level}] ${message}`);
};

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const getRandomFutureTime = (minMinutes: number, maxMinutes: number): Date => {
  const now = new Date();
  const offsetMinutes = randomInt(minMinutes, maxMinutes);
  return new Date(now.getTime() + offsetMinutes * 60 * 1000);
};

const getTodayDateString = (): string => {
  return new Date().toISOString().split('T')[0];
};

const getFutureDateString = (daysFromNow: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
};

/**
 * Calculate sleep period for today based on last scheduled run time
 * Sleep starts 0-2 hours after last scheduled run, lasts 6-8 hours
 */
const calculateSleepPeriod = async (): Promise<{ sleepStart: Date; sleepEnd: Date }> => {
  const storage = await getStorage();
  const scheduledRuns = await storage.getAllScheduledRuns();

  // Find latest scheduled run time of day
  let latestRunMinutes = 0; // Minutes since midnight

  for (const run of scheduledRuns.filter(r => r.enabled)) {
    const [hours, minutes] = run.timeOfDay.split(':').map(Number);
    const runMinutes = hours * 60 + minutes;
    if (runMinutes > latestRunMinutes) {
      latestRunMinutes = runMinutes;
    }
  }

  // If no scheduled runs, default to 10 PM (22:00)
  if (latestRunMinutes === 0) {
    latestRunMinutes = 22 * 60; // 10 PM
  }

  // Sleep starts 0-120 minutes after last scheduled run
  const sleepStartOffset = randomInt(0, 120); // 0-2 hours in minutes
  const sleepDuration = randomInt(360, 480); // 6-8 hours in minutes

  const now = new Date();
  const sleepStartMinutes = latestRunMinutes + sleepStartOffset;

  // Create sleep start time for today
  const sleepStart = new Date(now);
  sleepStart.setHours(Math.floor(sleepStartMinutes / 60), sleepStartMinutes % 60, 0, 0);

  // If sleep start is in the past, move it to tomorrow
  if (sleepStart < now) {
    sleepStart.setDate(sleepStart.getDate() + 1);
  }

  // Calculate sleep end time
  const sleepEnd = new Date(sleepStart);
  sleepEnd.setMinutes(sleepEnd.getMinutes() + sleepDuration);

  return { sleepStart, sleepEnd };
};

class OrganicActivityService {
  private checkInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private initialized: boolean = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const isEnabled = process.env.ORGANIC_ACTIVITY_ENABLED !== 'false';
    if (!isEnabled) {
      log('Organic activity disabled (ORGANIC_ACTIVITY_ENABLED=false)');
      return;
    }

    log('Initializing organic activity service...');

    // First sync schedules with twitter_settings to clean up any orphaned entries
    await this.syncSchedulesWithTwitterSettings();

    // Then ensure all accounts with cookies have schedules
    await this.ensureSchedulesExist();
    this.startChecker();
    this.initialized = true;

    log('✅ Organic activity service initialized');
  }

  private async ensureSchedulesExist(): Promise<void> {
    const storage = await getStorage();
    const allSettings = await storage.getAllTwitterSettings();
    const today = getTodayDateString();

    for (const settings of allSettings) {
      if (!settings.twitterCookie) continue;

      let schedule = await storage.getOrganicActivitySchedule(settings.username);

      if (!schedule) {
        const dailyLikesTarget = randomInt(3, 15);
        const nextRetweetDate = getFutureDateString(randomInt(2, 4));
        const { sleepStart, sleepEnd } = await calculateSleepPeriod();

        schedule = await storage.createOrganicActivitySchedule({
          username: settings.username,
          dailyLikesTarget,
          likesCompletedToday: 0,
          lastLikeDate: today,
          nextLikeTime: getRandomFutureTime(45, 240),
          lastRetweetDate: null,
          nextRetweetDate,
          sleepStartTime: sleepStart,
          sleepEndTime: sleepEnd,
          lastSleepCalculation: today
        });

        log(`Created organic schedule for @${settings.username}: ${dailyLikesTarget} likes/day, next retweet ${nextRetweetDate}, sleep ${sleepStart.toLocaleTimeString()}-${sleepEnd.toLocaleTimeString()}`);
      } else {
        // Reset daily likes if new day
        if (schedule.lastLikeDate !== today) {
          const newDailyTarget = randomInt(3, 15);
          await storage.updateOrganicActivitySchedule(settings.username, {
            dailyLikesTarget: newDailyTarget,
            likesCompletedToday: 0,
            lastLikeDate: today,
            nextLikeTime: getRandomFutureTime(45, 240)
          });
          log(`Reset daily likes for @${settings.username}: new target ${newDailyTarget}`);
        }

        // Recalculate sleep period if new day
        if (schedule.lastSleepCalculation !== today) {
          const { sleepStart, sleepEnd } = await calculateSleepPeriod();
          await storage.updateOrganicActivitySchedule(settings.username, {
            sleepStartTime: sleepStart,
            sleepEndTime: sleepEnd,
            lastSleepCalculation: today
          });
          log(`Recalculated sleep period for @${settings.username}: ${sleepStart.toLocaleTimeString()}-${sleepEnd.toLocaleTimeString()}`);
        }
      }
    }
  }

  private startChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkAndExecute();
    }, 60000);

    this.checkAndExecute();
  }

  private async checkAndExecute(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      const storage = await getStorage();
      const schedules = await storage.getAllOrganicActivitySchedules();
      const now = new Date();
      const today = getTodayDateString();

      for (const schedule of schedules) {
        // Check if account is in sleep period
        if (schedule.sleepStartTime && schedule.sleepEndTime) {
          const sleepStart = new Date(schedule.sleepStartTime);
          const sleepEnd = new Date(schedule.sleepEndTime);

          if (now >= sleepStart && now <= sleepEnd) {
            log(`😴 @${schedule.username} is sleeping (${sleepStart.toLocaleTimeString()}-${sleepEnd.toLocaleTimeString()}), skipping organic activity`);
            continue; // Skip all activities during sleep
          }
        }

        // Execute likes if scheduled and not at daily limit
        if (schedule.nextLikeTime && new Date(schedule.nextLikeTime) <= now) {
          if (schedule.likesCompletedToday < schedule.dailyLikesTarget) {
            await this.executeLike(schedule.username);
          }
        }

        // Execute retweets if scheduled
        if (schedule.nextRetweetDate && schedule.nextRetweetDate <= today) {
          await this.executeRetweet(schedule.username);
        }
      }
    } catch (error: any) {
      log(`Error in organic activity check: ${error.message}`, 'ERROR');
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeLike(username: string): Promise<void> {
    const storage = await getStorage();
    const settings = await storage.getTwitterSettingsByUsername(username);

    if (!settings?.twitterCookie) {
      log(`No cookie for @${username}, skipping like`, 'WARN');
      return;
    }

    log(`🔄 Executing organic like for @${username}`);

    try {
      // Check if we need to refresh following cache (monthly)
      const shouldRefresh = await storage.shouldRefreshFollowingCache(username);
      if (shouldRefresh) {
        log(`Refreshing following cache for @${username}...`);
        const followingResult = await twitterAutomation.getFollowing({
          twitterCookie: settings.twitterCookie,
          username
        });

        if (followingResult.success && followingResult.following) {
          await storage.refreshFollowingCache(username, followingResult.following);
          log(`✅ Cached ${followingResult.following.length} following accounts for @${username}`);
        } else {
          log(`❌ Failed to get following list for @${username}: ${followingResult.error}`, 'ERROR');
          await this.scheduleNextLike(username);
          return;
        }
      }

      // Get random account from following cache
      const randomFollowing = await storage.getRandomFollowingUser(username);
      if (!randomFollowing) {
        log(`No following accounts in cache for @${username}`, 'WARN');
        await this.scheduleNextLike(username);
        return;
      }

      log(`@${username} selected @${randomFollowing.followingUsername} from following list`);

      // Search for recent tweets from this user
      const tweetsResult = await twitterAutomation.searchTweetsByUser({
        twitterCookie: settings.twitterCookie,
        username,
        targetUsername: randomFollowing.followingUsername,
        maxItems: 5
      });

      if (!tweetsResult.success || !tweetsResult.tweets || tweetsResult.tweets.length === 0) {
        log(`No tweets found from @${randomFollowing.followingUsername}`, 'WARN');
        await this.scheduleNextLike(username);
        return;
      }

      // Select random tweet from results
      const randomTweet = tweetsResult.tweets[randomInt(0, tweetsResult.tweets.length - 1)];

      const likeResult = await twitterAutomation.likeTweet({
        tweetUrl: randomTweet.tweetUrl,
        twitterCookie: settings.twitterCookie,
        username
      });

      if (likeResult.success) {
        await storage.createOrganicActivity({
          username,
          activityType: 'like',
          targetTweetUrl: randomTweet.tweetUrl,
          targetUsername: randomTweet.authorHandle
        });

        const schedule = await storage.getOrganicActivitySchedule(username);
        if (schedule) {
          await storage.updateOrganicActivitySchedule(username, {
            likesCompletedToday: schedule.likesCompletedToday + 1,
            nextLikeTime: getRandomFutureTime(45, 240)
          });
        }

        log(`✅ @${username} liked tweet from @${randomTweet.authorHandle} (${(schedule?.likesCompletedToday || 0) + 1}/${schedule?.dailyLikesTarget || '?'})`);
      } else {
        log(`❌ Failed to like for @${username}: ${likeResult.error}`, 'ERROR');
        await this.scheduleNextLike(username);
      }
    } catch (error: any) {
      log(`Error executing like for @${username}: ${error.message}`, 'ERROR');
      await this.scheduleNextLike(username);
    }
  }

  private async scheduleNextLike(username: string): Promise<void> {
    const storage = await getStorage();
    await storage.updateOrganicActivitySchedule(username, {
      nextLikeTime: getRandomFutureTime(45, 240) // 45-240 minutes as per requirements
    });
  }

  private async executeRetweet(username: string): Promise<void> {
    const storage = await getStorage();
    const settings = await storage.getTwitterSettingsByUsername(username);

    if (!settings?.twitterCookie) {
      log(`No cookie for @${username}, skipping retweet`, 'WARN');
      return;
    }

    log(`🔄 Executing organic retweet for @${username}`);

    try {
      // Check if we need to refresh following cache (monthly)
      const shouldRefresh = await storage.shouldRefreshFollowingCache(username);
      if (shouldRefresh) {
        log(`Refreshing following cache for @${username}...`);
        const followingResult = await twitterAutomation.getFollowing({
          twitterCookie: settings.twitterCookie,
          username
        });

        if (followingResult.success && followingResult.following) {
          await storage.refreshFollowingCache(username, followingResult.following);
          log(`✅ Cached ${followingResult.following.length} following accounts for @${username}`);
        } else {
          log(`❌ Failed to get following list for @${username}: ${followingResult.error}`, 'ERROR');
          await this.scheduleNextRetweet(username);
          return;
        }
      }

      // Get random account from following cache
      const randomFollowing = await storage.getRandomFollowingUser(username);
      if (!randomFollowing) {
        log(`No following accounts in cache for @${username}`, 'WARN');
        await this.scheduleNextRetweet(username);
        return;
      }

      log(`@${username} selected @${randomFollowing.followingUsername} from following list for retweet`);

      // Search for recent tweets from this user
      const tweetsResult = await twitterAutomation.searchTweetsByUser({
        twitterCookie: settings.twitterCookie,
        username,
        targetUsername: randomFollowing.followingUsername,
        maxItems: 5
      });

      if (!tweetsResult.success || !tweetsResult.tweets || tweetsResult.tweets.length === 0) {
        log(`No tweets found from @${randomFollowing.followingUsername}`, 'WARN');
        await this.scheduleNextRetweet(username);
        return;
      }

      // Select random tweet from results
      const randomTweet = tweetsResult.tweets[randomInt(0, tweetsResult.tweets.length - 1)];

      // ALWAYS like before retweeting
      log(`@${username} liking tweet before retweet...`);
      const likeResult = await twitterAutomation.likeTweet({
        tweetUrl: randomTweet.tweetUrl,
        twitterCookie: settings.twitterCookie,
        username
      });

      if (likeResult.success) {
        await storage.createOrganicActivity({
          username,
          activityType: 'like',
          targetTweetUrl: randomTweet.tweetUrl,
          targetUsername: randomTweet.authorHandle
        });
        log(`✅ @${username} liked tweet from @${randomTweet.authorHandle}`);
      } else {
        log(`⚠️ Like failed but continuing with retweet: ${likeResult.error}`, 'WARN');
      }

      // Wait 6-11 seconds before retweet (respect TwexAPI rate limit)
      const delayMs = randomInt(6000, 11000);
      log(`⏳ Waiting ${(delayMs / 1000).toFixed(1)}s before retweet (TwexAPI rate limit: 5s)`);
      await new Promise(resolve => setTimeout(resolve, delayMs));

      const retweetResult = await twitterAutomation.retweet({
        tweetUrl: randomTweet.tweetUrl,
        twitterCookie: settings.twitterCookie,
        username
      });

      if (retweetResult.success) {
        await storage.createOrganicActivity({
          username,
          activityType: 'retweet',
          targetTweetUrl: randomTweet.tweetUrl,
          targetUsername: randomTweet.authorHandle
        });

        await this.scheduleNextRetweet(username);

        log(`✅ @${username} retweeted from @${randomTweet.authorHandle}`);
      } else {
        log(`❌ Failed to retweet for @${username}: ${retweetResult.error}`, 'ERROR');
        await this.scheduleNextRetweet(username);
      }
    } catch (error: any) {
      log(`Error executing retweet for @${username}: ${error.message}`, 'ERROR');
      await this.scheduleNextRetweet(username);
    }
  }

  private async scheduleNextRetweet(username: string): Promise<void> {
    const storage = await getStorage();
    const nextDate = getFutureDateString(randomInt(2, 4));
    await storage.updateOrganicActivitySchedule(username, {
      lastRetweetDate: getTodayDateString(),
      nextRetweetDate: nextDate
    });
    log(`Scheduled next retweet for @${username}: ${nextDate}`);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    log('Organic activity service stopped');
  }

  getStatus(): { enabled: boolean; initialized: boolean } {
    return {
      enabled: process.env.ORGANIC_ACTIVITY_ENABLED !== 'false',
      initialized: this.initialized
    };
  }

  // Manual trigger for testing - executes a single like for a specific account
  async testLikeForAccount(username: string): Promise<{ success: boolean; message: string }> {
    log(`🧪 Manual test: triggering organic like for @${username}`);

    const storage = await getStorage();
    const settings = await storage.getTwitterSettingsByUsername(username);

    if (!settings?.twitterCookie) {
      return { success: false, message: `No cookie found for @${username}` };
    }

    try {
      await this.executeLike(username);
      return { success: true, message: `Successfully triggered organic like for @${username}` };
    } catch (error: any) {
      return { success: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Sync organic activity schedules with twitter_settings
   * - Deletes orphaned schedules (usernames not in twitter_settings)
   * - Creates missing schedules (accounts with cookies but no schedule)
   */
  async syncSchedulesWithTwitterSettings(): Promise<{ deleted: string[]; created: string[] }> {
    log('🔄 Syncing organic activity schedules with twitter_settings...');

    const storage = await getStorage();
    const allSettings = await storage.getAllTwitterSettings();
    const allSchedules = await storage.getAllOrganicActivitySchedules();

    // Build set of valid usernames (accounts with cookies)
    const validUsernames = new Set(
      allSettings
        .filter(s => s.twitterCookie)
        .map(s => s.username)
    );

    const deleted: string[] = [];
    const created: string[] = [];

    // Delete orphaned schedules (username doesn't exist in twitter_settings)
    for (const schedule of allSchedules) {
      if (!validUsernames.has(schedule.username)) {
        log(`🗑️ Deleting orphaned schedule for @${schedule.username} (not found in twitter_settings)`);
        await storage.deleteOrganicActivitySchedule(schedule.username);
        deleted.push(schedule.username);
      }
    }

    // Build set of existing schedule usernames
    const existingScheduleUsernames = new Set(allSchedules.map(s => s.username));

    // Create missing schedules for accounts that have cookies but no schedule
    const today = getTodayDateString();
    for (const settings of allSettings) {
      if (settings.twitterCookie && !existingScheduleUsernames.has(settings.username)) {
        const dailyLikesTarget = Math.floor(Math.random() * 13) + 3; // 3-15
        const nextRetweetDate = getFutureDateString(Math.floor(Math.random() * 3) + 2); // 2-4 days
        const { sleepStart, sleepEnd } = await calculateSleepPeriod();

        await storage.createOrganicActivitySchedule({
          username: settings.username,
          dailyLikesTarget,
          likesCompletedToday: 0,
          lastLikeDate: today,
          nextLikeTime: getRandomFutureTime(45, 240),
          lastRetweetDate: null,
          nextRetweetDate,
          sleepStartTime: sleepStart,
          sleepEndTime: sleepEnd,
          lastSleepCalculation: today
        });

        log(`✅ Created schedule for @${settings.username}: ${dailyLikesTarget} likes/day`);
        created.push(settings.username);
      }
    }

    log(`🔄 Sync complete: deleted ${deleted.length} orphaned, created ${created.length} new schedules`);
    return { deleted, created };
  }
}

export const organicActivityService = new OrganicActivityService();
