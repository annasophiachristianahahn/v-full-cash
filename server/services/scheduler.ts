import { getStorage } from "../storage";
import { autoRunService } from "./autoRun";
import type { ScheduledRun } from "@shared/schema";

interface ScheduledRunWithOffset extends ScheduledRun {
  randomOffsetMinutes: number;
  nextRunTime: Date;
}

class SchedulerService {
  private scheduledRunsMap: Map<string, ScheduledRunWithOffset> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private initialized = false;
  private todayOffsets: Map<string, number> = new Map();
  private lastOffsetDate: string = "";

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Check if scheduler should run in this environment
    // Set SCHEDULER_ENABLED=false in development when sharing database with production
    const schedulerEnabled = process.env.SCHEDULER_ENABLED !== 'false';
    
    if (!schedulerEnabled) {
      console.log("🗓️ Scheduler disabled (SCHEDULER_ENABLED=false)");
      console.log("   This prevents duplicate scheduled runs when sharing database with production");
      return;
    }

    console.log("🗓️ Initializing scheduler service...");
    
    await this.loadSchedules();
    this.startScheduleChecker();

    console.log("✅ Scheduler service initialized");
  }

  private async loadSchedules() {
    const storage = await getStorage();
    const runs = await storage.getAllScheduledRuns();
    
    this.scheduledRunsMap.clear();
    
    for (const run of runs) {
      if (run.enabled) {
        const runWithOffset = this.calculateNextRun(run);
        this.scheduledRunsMap.set(run.id, runWithOffset);
      }
    }

    console.log(`📅 Loaded ${this.scheduledRunsMap.size} enabled schedules`);
    await this.broadcastState();
  }

  private calculateNextRun(run: ScheduledRun): ScheduledRunWithOffset {
    const now = new Date();
    const todayStr = this.getESTDateString(now);
    
    if (todayStr !== this.lastOffsetDate) {
      this.todayOffsets.clear();
      this.lastOffsetDate = todayStr;
    }
    
    let randomOffset = this.todayOffsets.get(run.id);
    if (randomOffset === undefined) {
      randomOffset = Math.floor(Math.random() * 14) + 2;
      this.todayOffsets.set(run.id, randomOffset);
    }

    const nextRunTime = this.getNextRunTime(run.timeOfDay, randomOffset);

    return {
      ...run,
      randomOffsetMinutes: randomOffset,
      nextRunTime,
    };
  }

  private getESTDateString(date: Date): string {
    return date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  }

  private getNextRunTime(timeOfDay: string, offsetMinutes: number): Date {
    const [hours, minutes] = timeOfDay.split(':').map(Number);
    
    if (isNaN(hours) || isNaN(minutes)) {
      console.error(`Invalid timeOfDay format: ${timeOfDay}`);
      const fallback = new Date();
      fallback.setHours(fallback.getHours() + 1);
      return fallback;
    }
    
    const now = new Date();
    
    const estFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    
    const parts = estFormatter.formatToParts(now);
    const estParts: { [key: string]: string } = {};
    for (const part of parts) {
      estParts[part.type] = part.value;
    }
    
    const totalMinutes = hours * 60 + minutes + offsetMinutes;
    const scheduledHours = Math.floor(totalMinutes / 60) % 24;
    const scheduledMinutes = totalMinutes % 60;
    
    const currentEstHour = parseInt(estParts.hour, 10);
    const currentEstMinute = parseInt(estParts.minute, 10);
    const currentTotalMinutes = currentEstHour * 60 + currentEstMinute;
    const scheduledTotalMinutes = scheduledHours * 60 + scheduledMinutes;
    
    const scheduledDate = new Date(now);
    
    const diffMinutes = scheduledTotalMinutes - currentTotalMinutes;
    scheduledDate.setMinutes(scheduledDate.getMinutes() + diffMinutes);
    scheduledDate.setSeconds(0);
    scheduledDate.setMilliseconds(0);
    
    if (scheduledDate <= now) {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    }

    return scheduledDate;
  }

  private startScheduleChecker() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkSchedules();
    }, 30000);

    this.checkSchedules();
  }

  private async checkSchedules() {
    const now = new Date();
    const autoRunState = autoRunService.getState();
    
    if (autoRunState.status !== 'idle' && 
        autoRunState.status !== 'completed' && 
        autoRunState.status !== 'failed' && 
        autoRunState.status !== 'cancelled') {
      return;
    }

    const entries = Array.from(this.scheduledRunsMap.entries());
    for (const [id, run] of entries) {
      if (!run.enabled) continue;

      if (now >= run.nextRunTime) {
        console.log(`⏰ Schedule ${id} triggered at ${run.nextRunTime.toISOString()}`);
        await this.executeScheduledRun(run);
        
        const storage = await getStorage();
        await storage.updateScheduledRunLastRun(id);
        
        const updatedRun = await storage.getScheduledRun(id);
        if (updatedRun && updatedRun.enabled) {
          this.todayOffsets.delete(id);
          const newRunWithOffset = this.calculateNextRun(updatedRun);
          this.scheduledRunsMap.set(id, newRunWithOffset);
        }
        
        await this.broadcastState();
        break;
      }
    }
  }

  // Public method to trigger a test run with the same logic as scheduled runs
  async triggerTestRun(): Promise<{ success: boolean; config?: any; error?: string }> {
    try {
      console.log(`🧪 [Test Trigger] Manual scheduler test initiated`);

      const storage = await getStorage();
      const [trendingTokens, recommendedCashtags, pinnedTrendingTokens, allTwitterSettings] = await Promise.all([
        this.fetchTrendingTokens(),
        storage.getRecommendedCashtags(),
        storage.getPinnedTrendingTokens(),
        storage.getAllTwitterSettings(),
      ]);

      const MAX_CASHTAGS = 8;
      
      const pinnedRecommended = recommendedCashtags
        .filter((c: { isPinned: boolean | null }) => c.isPinned)
        .map((c: { symbol: string }) => c.symbol);
      const unpinnedRecommended = recommendedCashtags
        .filter((c: { isPinned: boolean | null }) => !c.isPinned)
        .map((c: { symbol: string }) => c.symbol);
      
      const pinnedTrendingSymbols = new Set(
        pinnedTrendingTokens.map((t: { symbol: string }) => t.symbol.toUpperCase())
      );
      const trendingSymbols: string[] = trendingTokens
        .slice(0, 15)
        .map((t: { symbol: string }) => t.symbol);
      const pinnedTrending = trendingSymbols.filter((s: string) => pinnedTrendingSymbols.has(s.toUpperCase()));
      const unpinnedTrending = trendingSymbols.filter((s: string) => !pinnedTrendingSymbols.has(s.toUpperCase()));
      
      const uniqueCashtags: string[] = [];
      const addUnique = (tag: string) => {
        const upper = tag.toUpperCase();
        if (!uniqueCashtags.some(t => t.toUpperCase() === upper)) {
          uniqueCashtags.push(tag);
        }
      };
      
      for (const tag of pinnedRecommended) addUnique(tag);
      for (const tag of pinnedTrending) addUnique(tag);
      
      const remainingSlots = MAX_CASHTAGS - uniqueCashtags.length;
      if (remainingSlots > 0) {
        const halfRemaining = Math.ceil(remainingSlots / 2);
        const selectedUnpinnedTrending = this.selectRandom(unpinnedTrending, halfRemaining);
        const selectedUnpinnedRecommended = this.selectRandom(unpinnedRecommended, remainingSlots - selectedUnpinnedTrending.length);
        
        for (const tag of selectedUnpinnedTrending) addUnique(tag);
        for (const tag of selectedUnpinnedRecommended) addUnique(tag);
      }
      
      const cashtags = uniqueCashtags.slice(0, MAX_CASHTAGS);

      if (cashtags.length === 0) {
        return { success: false, error: 'No cashtags available' };
      }

      const availableAccounts = allTwitterSettings.filter((s: { twitterCookie: string | null; isAvailableForRandom: boolean | null }) => 
        s.twitterCookie && (s.isAvailableForRandom !== false)
      );
      if (availableAccounts.length === 0) {
        return { success: false, error: 'No Twitter accounts available for random selection' };
      }

      const primaryAccount = availableAccounts[Math.floor(Math.random() * availableAccounts.length)];
      const raidRounds = Math.floor(Math.random() * 3) + 2;

      const config = {
        cashtags,
        pinnedCount: pinnedRecommended.length + pinnedTrending.length,
        primaryAccount: primaryAccount.username,
        raidRounds,
        searchParams: {
          minFollowers: 500,
          maxFollowers: 10000,
          timeRange: '1h',
          maxResults: '100',
          excludeRetweets: true,
          verifiedOnly: false
        },
        maxTweets: Math.floor(Math.random() * (44 - 22 + 1)) + 22, // Random 22-44
        replyDelayRange: { min: 27, max: 47 },
        raidReplyDelayRange: { min: 44, max: 77 },
        dmDelayRange: { min: 7, max: 14 },
        sendDm: true
      };

      console.log(`🧪 [Test Trigger] Config: ${JSON.stringify(config, null, 2)}`);

      await autoRunService.start({
        searchParams: config.searchParams,
        cashtags: config.cashtags,
        username: config.primaryAccount,
        maxTweets: config.maxTweets,
        replyDelayRange: config.replyDelayRange,
        raidReplyDelayRange: config.raidReplyDelayRange,
        dmDelayRange: config.dmDelayRange,
        sendDm: config.sendDm,
        raidRounds: config.raidRounds
      });

      return { success: true, config };

    } catch (error: any) {
      console.error(`🧪 [Test Trigger] Error:`, error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  private async executeScheduledRun(run: ScheduledRunWithOffset) {
    try {
      console.log(`🚀 Executing scheduled Auto Run for schedule ${run.id}`);

      const storage = await getStorage();
      const [trendingTokens, recommendedCashtags, pinnedTrendingTokens, allTwitterSettings] = await Promise.all([
        this.fetchTrendingTokens(),
        storage.getRecommendedCashtags(),
        storage.getPinnedTrendingTokens(),
        storage.getAllTwitterSettings(),
      ]);

      const MAX_CASHTAGS = 8;
      
      const pinnedRecommended = recommendedCashtags
        .filter((c: { isPinned: boolean | null }) => c.isPinned)
        .map((c: { symbol: string }) => c.symbol);
      const unpinnedRecommended = recommendedCashtags
        .filter((c: { isPinned: boolean | null }) => !c.isPinned)
        .map((c: { symbol: string }) => c.symbol);
      
      const pinnedTrendingSymbols = new Set(
        pinnedTrendingTokens.map((t: { symbol: string }) => t.symbol.toUpperCase())
      );
      const trendingSymbols: string[] = trendingTokens
        .slice(0, 15)
        .map((t: { symbol: string }) => t.symbol);
      const pinnedTrending = trendingSymbols.filter((s: string) => pinnedTrendingSymbols.has(s.toUpperCase()));
      const unpinnedTrending = trendingSymbols.filter((s: string) => !pinnedTrendingSymbols.has(s.toUpperCase()));
      
      const uniqueCashtags: string[] = [];
      const addUnique = (tag: string) => {
        const upper = tag.toUpperCase();
        if (!uniqueCashtags.some(t => t.toUpperCase() === upper)) {
          uniqueCashtags.push(tag);
        }
      };
      
      for (const tag of pinnedRecommended) addUnique(tag);
      for (const tag of pinnedTrending) addUnique(tag);
      
      console.log(`📌 Pinned cashtags (priority): ${[...pinnedRecommended, ...pinnedTrending].join(', ') || 'none'}`);
      
      const remainingSlots = MAX_CASHTAGS - uniqueCashtags.length;
      if (remainingSlots > 0) {
        const halfRemaining = Math.ceil(remainingSlots / 2);
        const selectedUnpinnedTrending = this.selectRandom(unpinnedTrending, halfRemaining);
        const selectedUnpinnedRecommended = this.selectRandom(unpinnedRecommended, remainingSlots - selectedUnpinnedTrending.length);
        
        for (const tag of selectedUnpinnedTrending) addUnique(tag);
        for (const tag of selectedUnpinnedRecommended) addUnique(tag);
      }
      
      const cashtags = uniqueCashtags.slice(0, MAX_CASHTAGS);

      if (cashtags.length === 0) {
        console.error("❌ No cashtags available for scheduled run");
        return;
      }

      // Filter accounts that have cookies AND are available for random selection
      const availableAccounts = allTwitterSettings.filter((s: { twitterCookie: string | null; isAvailableForRandom: boolean | null }) => 
        s.twitterCookie && (s.isAvailableForRandom !== false) // Default to true if null
      );
      if (availableAccounts.length === 0) {
        console.error("❌ No Twitter accounts available for random selection (check availability settings)");
        return;
      }

      const primaryAccount = availableAccounts[Math.floor(Math.random() * availableAccounts.length)];

      // Randomly select 2-4 raid reply rounds for this scheduled run
      const raidRounds = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4

      console.log(`📊 Scheduled run config:
        - Cashtags (${cashtags.length}): ${cashtags.join(', ')}
        - Pinned count: ${pinnedRecommended.length + pinnedTrending.length}
        - Primary Account: @${primaryAccount.username}
        - Raid Rounds: ${raidRounds}`);

      await autoRunService.start({
        searchParams: {
          minFollowers: 500,
          maxFollowers: 10000,
          timeRange: '1h',
          maxResults: '100',
          excludeRetweets: true,
          verifiedOnly: false
        },
        cashtags,
        username: primaryAccount.username,
        maxTweets: Math.floor(Math.random() * (44 - 22 + 1)) + 22, // Random 22-44
        replyDelayRange: { min: 27, max: 47 },
        raidReplyDelayRange: { min: 44, max: 77 },
        dmDelayRange: { min: 7, max: 14 },
        sendDm: true,
        raidRounds
      });

    } catch (error) {
      console.error("❌ Failed to execute scheduled run:", error);
    }
  }

  private async fetchTrendingTokens(): Promise<{ symbol: string; name: string }[]> {
    try {
      const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/trending/24h`);
      if (!response.ok) {
        throw new Error(`Failed to fetch trending tokens: ${response.status}`);
      }
      const data = await response.json();
      return data.tokens || [];
    } catch (error) {
      console.error("Error fetching trending tokens:", error);
      return [];
    }
  }

  private selectRandom<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, array.length));
  }

  async addSchedule(timeOfDay: string): Promise<ScheduledRun> {
    const storage = await getStorage();
    const run = await storage.createScheduledRun({ timeOfDay, enabled: true });
    
    const runWithOffset = this.calculateNextRun(run);
    this.scheduledRunsMap.set(run.id, runWithOffset);
    
    await this.broadcastState();
    return run;
  }

  async removeSchedule(id: string): Promise<void> {
    const storage = await getStorage();
    await storage.deleteScheduledRun(id);
    this.scheduledRunsMap.delete(id);
    this.todayOffsets.delete(id);
    await this.broadcastState();
  }

  async toggleSchedule(id: string, enabled: boolean): Promise<void> {
    const storage = await getStorage();
    await storage.updateScheduledRun(id, { enabled });
    
    if (enabled) {
      const run = await storage.getScheduledRun(id);
      if (run) {
        const runWithOffset = this.calculateNextRun(run);
        this.scheduledRunsMap.set(id, runWithOffset);
      }
    } else {
      this.scheduledRunsMap.delete(id);
    }
    
    await this.broadcastState();
  }

  getState(): { schedules: Array<{
    id: string;
    timeOfDay: string;
    enabled: boolean;
    randomOffsetMinutes: number;
    nextRunTime: string;
    lastRun: string | null;
  }> } {
    const entries = Array.from(this.scheduledRunsMap.values());
    const schedules = entries.map(run => ({
      id: run.id,
      timeOfDay: run.timeOfDay,
      enabled: run.enabled,
      randomOffsetMinutes: run.randomOffsetMinutes,
      nextRunTime: run.nextRunTime.toISOString(),
      lastRun: run.lastRun?.toISOString() || null,
    }));

    schedules.sort((a, b) => new Date(a.nextRunTime).getTime() - new Date(b.nextRunTime).getTime());

    return { schedules };
  }

  async getAllSchedules(): Promise<ScheduledRun[]> {
    const storage = await getStorage();
    return storage.getAllScheduledRuns();
  }

  private async broadcastState() {
    const sseManagerModule = await import('./sseManager');
    sseManagerModule.sseManager.broadcastSchedulerState(this.getState());
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.initialized = false;
  }
}

export const schedulerService = new SchedulerService();
