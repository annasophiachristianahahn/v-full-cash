import { jobManager, Job, ReplyJobData, DmJobData, JobType } from './jobManager';
import { accountQueueManager } from './accountQueue';

interface LikeJobData {
  tweetUrl: string;
  username: string;
}
import { getStorage } from '../storage';
import { twitterAutomation } from './twitterAutomation';
import { normalizeImageUrl } from '../utils/imageUrl';
import { sendTwitterDM } from './puppeteerDM';

interface QueuedReply {
  jobId: string;
  tweetId: string;
  replyText: string;
  username: string;
  tweetUrl?: string;
  mediaUrl?: string;
  authorHandle?: string;
  sendDm: boolean;
  dmDelaySeconds?: number;
}

class ReplyQueue {
  private processing: boolean = false;
  private pendingReplies: Map<string, QueuedReply> = new Map();

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    // Jobs are queued per-account for sequential processing
    jobManager.on('job:started', (job: Job) => {
      const data = job.data as ReplyJobData | DmJobData | LikeJobData;

      // Queue the job for the account - will be processed sequentially per account
      if (data.username) {
        accountQueueManager.enqueueJob(data.username, job);
      } else {
        // Fallback for jobs without username (shouldn't happen)
        console.warn(`[ReplyQueue] Job ${job.id} has no username, processing immediately`);
        this.processJobByType(job);
      }
    });

    // Process jobs as they come out of the account queue
    accountQueueManager.on('process-job', (job: Job, username: string) => {
      this.processJobByType(job, username);
    });
  }

  private processJobByType(job: Job, username?: string): void {
    if (job.type === 'reply') {
      this.processReply(job, username);
    } else if (job.type === 'dm') {
      this.processDm(job, username);
    } else if (job.type === 'like') {
      this.processLike(job, username);
    }
  }

  async queueReply(data: {
    tweetId: string;
    replyText: string;
    username: string;
    tweetUrl?: string;
    mediaUrl?: string;
    authorHandle?: string;
    delaySeconds: number;
    sendDm?: boolean;
    dmDelaySeconds?: number;
    alsoLikeTweet?: boolean;  // Like the original tweet in same browser session (no tunnel reconnect)
  }): Promise<Job> {
    const job = jobManager.createJob('reply', {
      ...data,
      sendDm: data.sendDm ?? false,
      dmDelaySeconds: data.dmDelaySeconds ?? 45,
      alsoLikeTweet: data.alsoLikeTweet ?? false
    }, data.delaySeconds);

    this.pendingReplies.set(job.id, {
      jobId: job.id,
      tweetId: data.tweetId,
      replyText: data.replyText,
      username: data.username,
      tweetUrl: data.tweetUrl,
      mediaUrl: data.mediaUrl,
      authorHandle: data.authorHandle,
      sendDm: data.sendDm ?? false,
      dmDelaySeconds: data.dmDelaySeconds
    });

    return job;
  }

  async queueBulkReplies(replies: Array<{
    tweetId: string;
    replyText: string;
    username: string;
    tweetUrl?: string;
    mediaUrl?: string;
    authorHandle?: string;
  }>, options: {
    sendDm: boolean;
    dmDelayRange: { min: number; max: number };
    replyDelayRange: { min: number; max: number };
  }): Promise<Job[]> {
    const jobs: Job[] = [];
    let cumulativeDelay = 0;

    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i];
      
      const replyDelay = i === 0 ? 0 : this.getRandomDelay(
        options.replyDelayRange.min,
        options.replyDelayRange.max
      );
      cumulativeDelay += replyDelay;

      const dmDelay = options.sendDm 
        ? this.getRandomDelay(options.dmDelayRange.min, options.dmDelayRange.max)
        : 0;

      const job = await this.queueReply({
        ...reply,
        delaySeconds: cumulativeDelay,
        sendDm: options.sendDm,
        dmDelaySeconds: dmDelay
      });

      jobs.push(job);
    }

    return jobs;
  }

  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async processReply(job: Job, username?: string): Promise<void> {
    const data = job.data as ReplyJobData & { sendDm: boolean; dmDelaySeconds: number; alsoLikeTweet?: boolean };
    const accountUsername = username || data.username;
    
    try {
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(data.username);

      if (!settings || !settings.twitterCookie) {
        throw new Error(`No Twitter cookie configured for user: ${data.username}`);
      }

      let finalMediaUrl = data.mediaUrl;
      if (!finalMediaUrl) {
        const randomImage = await storage.getRandomReplyImage();
        if (randomImage) {
          finalMediaUrl = randomImage.imageUrl;
          console.log(`📸 [ReplyQueue] Using random image: ${finalMediaUrl}`);
        }
      }

      if (finalMediaUrl) {
        const originalUrl = finalMediaUrl;
        try {
          finalMediaUrl = normalizeImageUrl(finalMediaUrl) || undefined;
          if (finalMediaUrl && finalMediaUrl !== originalUrl) {
            console.log(`📸 [ReplyQueue] Normalized URL: ${originalUrl} -> ${finalMediaUrl}`);
          }
        } catch (e) {
          console.warn(`📸 [ReplyQueue] Failed to normalize URL ${originalUrl}: ${e}`);
        }
      }

      console.log(`🚀 [ReplyQueue] Processing reply from @${data.username} to tweet ${data.tweetId}${data.alsoLikeTweet ? ' + LIKE' : ''}`);

      let result: { success: boolean; replyId?: string; replyUrl?: string; error?: string };
      let likeResult: { success: boolean; error?: string } | undefined;

      // Use combined reply+like method when alsoLikeTweet is true
      if (data.alsoLikeTweet) {
        const combinedResult = await twitterAutomation.postReplyAndLike({
          tweetId: data.tweetId,
          replyText: data.replyText,
          twitterCookie: settings.twitterCookie,
          mediaUrl: finalMediaUrl,
          username: data.username,
          tweetUrl: data.tweetUrl
        });
        
        result = {
          success: combinedResult.replySuccess,
          replyId: combinedResult.replyId,
          replyUrl: combinedResult.replyUrl,
          error: combinedResult.replyError
        };
        
        likeResult = {
          success: combinedResult.likeSuccess,
          error: combinedResult.likeError
        };
        
        if (combinedResult.likeSuccess) {
          console.log(`❤️ [ReplyQueue] Like succeeded in same session`);
        } else if (combinedResult.likeError) {
          console.warn(`⚠️ [ReplyQueue] Like failed: ${combinedResult.likeError}`);
        }
      } else {
        result = await twitterAutomation.postReply({
          tweetId: data.tweetId,
          replyText: data.replyText,
          twitterCookie: settings.twitterCookie,
          mediaUrl: finalMediaUrl,
          username: data.username,
          tweetUrl: data.tweetUrl
        });
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to post reply');
      }

      await storage.updateTwitterSettingsLastUsed(settings.id);

      console.log(`✅ [ReplyQueue] Reply posted successfully: ${result.replyUrl}`);

      // Queue DM BEFORE marking reply complete - ensures DM is next in account queue
      if (data.sendDm && result.replyUrl) {
        await this.queueDm(result.replyUrl, data.dmDelaySeconds || 45, data.username, result.proxy);
      }

      jobManager.completeJob(job.id, {
        replyId: result.replyId,
        replyUrl: result.replyUrl,
        proxy: result.proxy,
        likeSuccess: likeResult?.success
      });

      // Cooldown after each reply to avoid triggering anti-spam
      const cooldownMs = this.getRandomDelay(3000, 8000); // 3-8 seconds (TwexAPI is fast)
      console.log(`⏳ [ReplyQueue] Cooldown: ${Math.round(cooldownMs / 1000)}s before next action`);
      await new Promise(resolve => setTimeout(resolve, cooldownMs));

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
      console.error(`❌ [ReplyQueue] Failed to post reply:`, errorMessage);
      jobManager.failJob(job.id, errorMessage || 'Unknown error');

      // Cooldown even after failure to avoid rapid retries triggering anti-spam
      const cooldownMs = this.getRandomDelay(8000, 20000); // 8-20 seconds after failure
      console.log(`⏳ [ReplyQueue] Failure cooldown: ${Math.round(cooldownMs / 1000)}s`);
      await new Promise(resolve => setTimeout(resolve, cooldownMs));
    } finally {
      // Mark job complete in account queue so next job can process
      // DM was already queued above (if enabled), so it will be next in line
      if (accountUsername) {
        accountQueueManager.completeJob(accountUsername, job.id);
      }
    }
  }

  async queueDm(replyUrl: string, delaySeconds: number, username: string, proxy?: string): Promise<Job> {
    console.log(`📨 [ReplyQueue] Creating DM job for @${username} (internal delay: ${delaySeconds}s), replyUrl: ${replyUrl}`);

    // Create job with NO external timer (delay=0) - the delay is handled internally during processing
    // This ensures DM runs immediately after its parent reply in the account queue
    const job = jobManager.createJob('dm', {
      message: replyUrl,
      internalDelaySeconds: delaySeconds, // Store delay for internal use during processing
      username,
      proxy // Store the proxy to use for the DM
    }, 0); // No external timer - queue immediately

    console.log(`📨 [ReplyQueue] DM job ${job.id} created with status: ${job.status} (will wait ${delaySeconds}s internally before sending)`);
    return job;
  }

  async queueLike(data: { tweetUrl: string; username: string; delaySeconds: number }): Promise<Job> {
    const job = jobManager.createJob('like', {
      tweetUrl: data.tweetUrl,
      username: data.username
    }, data.delaySeconds);

    console.log(`[ReplyQueue] Queued like job ${job.id} from @${data.username} for ${data.tweetUrl} (delay: ${data.delaySeconds}s)`);
    return job;
  }

  private async processLike(job: Job, username?: string): Promise<void> {
    const data = job.data as LikeJobData;
    const accountUsername = username || data.username;

    try {
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(data.username);

      if (!settings || !settings.twitterCookie) {
        throw new Error(`No Twitter cookie configured for user: ${data.username}`);
      }

      console.log(`❤️ [ReplyQueue] Liking tweet from @${data.username}: ${data.tweetUrl}`);

      const result = await twitterAutomation.likeTweet({
        tweetUrl: data.tweetUrl,
        twitterCookie: settings.twitterCookie,
        username: data.username
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to like tweet');
      }

      jobManager.completeJob(job.id, { liked: true });
      console.log(`✅ [ReplyQueue] Tweet liked successfully by @${data.username}`);

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
      console.error(`❌ [ReplyQueue] Failed to like tweet:`, errorMessage);
      jobManager.failJob(job.id, errorMessage || 'Unknown error');
    } finally {
      // Mark job complete in account queue so next job can process
      if (accountUsername) {
        accountQueueManager.completeJob(accountUsername, job.id);
      }
    }
  }

  private async processDm(job: Job, username?: string): Promise<void> {
    const data = job.data as DmJobData & { proxy?: string; internalDelaySeconds?: number };
    const accountUsername = username || data.username;

    try {
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(data.username);

      if (!settings || !settings.twitterCookie) {
        throw new Error(`No Twitter cookie configured for user: ${data.username}`);
      }

      // Handle internal delay (humanization between reply and DM)
      const internalDelay = data.internalDelaySeconds || 0;
      if (internalDelay > 0) {
        console.log(`⏳ [ReplyQueue] Waiting ${internalDelay}s before sending DM (humanization delay)`);
        await new Promise(resolve => setTimeout(resolve, internalDelay * 1000));
      }

      console.log(`📤 [ReplyQueue] Sending DM from @${data.username} with reply URL: ${data.message}`);
      if (data.proxy) {
        console.log(`📤 [ReplyQueue] Using same proxy as reply: ${data.proxy.substring(0, 30)}...`);
      }

      // Use Puppeteer DM service instead of TwexAPI
      const result = await sendTwitterDM({
        message: data.message,
        twitterCookie: settings.twitterCookie,
        username: data.username,
        proxy: data.proxy // Use the same proxy that was used for the reply
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to send DM');
      }

      jobManager.completeJob(job.id, {
        success: true,
        timestamp: result.timestamp
      });

      console.log(`✅ [ReplyQueue] DM sent successfully via Puppeteer`);

      // No cooldown needed - next job has its own randomized delay

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));
      console.error(`❌ [ReplyQueue] Failed to send DM:`, errorMessage);
      jobManager.failJob(job.id, errorMessage || 'Unknown error');

      // No cooldown needed - failures are already rare and next job has its own delay
    } finally {
      // Mark job complete in account queue so next job can process
      if (accountUsername) {
        accountQueueManager.completeJob(accountUsername, job.id);
      }
    }
  }

  cancelReply(jobId: string): boolean {
    const job = jobManager.getJob(jobId);
    if (!job || job.status !== 'scheduled') {
      return false;
    }

    jobManager.cancelJob(jobId);
    this.pendingReplies.delete(jobId);
    return true;
  }

  cancelAllPending(): number {
    let cancelled = 0;
    const entries = Array.from(this.pendingReplies.entries());
    for (const [jobId] of entries) {
      if (this.cancelReply(jobId)) {
        cancelled++;
      }
    }
    return cancelled;
  }

  getQueueStatus(): {
    pending: number;
    scheduled: number;
    running: number;
    completed: number;
    failed: number;
  } {
    const replyJobs = jobManager.getJobsByType('reply');
    const dmJobs = jobManager.getJobsByType('dm');
    const allJobs = [...replyJobs, ...dmJobs];

    return {
      pending: allJobs.filter(j => j.status === 'pending').length,
      scheduled: allJobs.filter(j => j.status === 'scheduled').length,
      running: allJobs.filter(j => j.status === 'running').length,
      completed: allJobs.filter(j => j.status === 'completed').length,
      failed: allJobs.filter(j => j.status === 'failed').length
    };
  }
}

export const replyQueue = new ReplyQueue();
