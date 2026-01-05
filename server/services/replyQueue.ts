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
    // NOTE: This listener handles jobs from queueReply (timer-based) and queueLike
    // Jobs from queueBulkReplies and queueDmSync are directly enqueued, NOT via this listener
    jobManager.on('job:started', (job: Job) => {
      const data = job.data as ReplyJobData | DmJobData | LikeJobData;

      // Skip if job is already queued (from createJobSync + direct enqueue)
      // This prevents double-enqueueing for jobs that bypass the event system
      if (job.status === 'queued') {
        console.log(`[ReplyQueue] Job ${job.id} already queued, skipping event-based enqueue`);
        return;
      }

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

  /**
   * Queue bulk replies with unified sequential scheduling.
   *
   * Instead of using independent timers for each reply (which race with DMs),
   * we create all jobs upfront and enqueue them directly to the account queue.
   * The sequence is: Reply1 -> DM1 -> Reply2 -> DM2 -> etc.
   *
   * Timing is handled by:
   * - accountQueueManager's humanization delays between jobs (15-30s)
   * - DM's internal delay before sending (from dmDelayRange)
   */
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
    replyDelayRange: { min: number; max: number };  // Now used for humanization reference, not timers
  }): Promise<Job[]> {
    const jobs: Job[] = [];

    // Group replies by username for per-account sequential processing
    const repliesByUser = new Map<string, typeof replies>();
    for (const reply of replies) {
      if (!repliesByUser.has(reply.username)) {
        repliesByUser.set(reply.username, []);
      }
      repliesByUser.get(reply.username)!.push(reply);
    }

    // For each account, create all reply+DM jobs and enqueue them sequentially
    for (const [username, userReplies] of repliesByUser) {
      console.log(`📋 [ReplyQueue] Queueing ${userReplies.length} replies for @${username} (unified sequential scheduling)`);

      for (let i = 0; i < userReplies.length; i++) {
        const reply = userReplies[i];

        // Generate DM delay for this reply (will be used when DM is created after reply succeeds)
        const dmDelay = options.sendDm
          ? this.getRandomDelay(options.dmDelayRange.min, options.dmDelayRange.max)
          : 0;

        // Create reply job synchronously and enqueue directly (no timer)
        console.log(`📋 [ReplyQueue] Creating reply job with sendDm=${options.sendDm}`);
        const replyJob = jobManager.createJobSync('reply', {
          ...reply,
          sendDm: options.sendDm,
          dmDelaySeconds: dmDelay,
          alsoLikeTweet: false
        });
        console.log(`📋 [ReplyQueue] Created job ${replyJob.id}, job.data.sendDm=${replyJob.data.sendDm}`);

        // Directly enqueue to account queue (sequential processing)
        accountQueueManager.enqueueJob(username, replyJob);

        this.pendingReplies.set(replyJob.id, {
          jobId: replyJob.id,
          tweetId: reply.tweetId,
          replyText: reply.replyText,
          username: reply.username,
          tweetUrl: reply.tweetUrl,
          mediaUrl: reply.mediaUrl,
          authorHandle: reply.authorHandle,
          sendDm: options.sendDm,
          dmDelaySeconds: dmDelay
        });

        jobs.push(replyJob);
        console.log(`📋 [ReplyQueue] Enqueued reply ${i + 1}/${userReplies.length} for @${username} (DM delay: ${dmDelay}s)`);
      }
    }

    console.log(`📋 [ReplyQueue] Total ${jobs.length} reply jobs enqueued (DMs will be created after each reply succeeds)`);
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
      // Use sync version to guarantee DM is queued before completeJob triggers processNext
      // Note: DM delay (7-14s) is handled by accountQueueManager based on job type
      console.log(`📨 [ReplyQueue] DM check: sendDm=${data.sendDm}, replyUrl=${result.replyUrl ? 'yes' : 'no'}`);
      if (data.sendDm && result.replyUrl) {
        console.log(`📨 [ReplyQueue] Queueing DM for @${data.username}`);
        this.queueDmSync(result.replyUrl, data.username, result.proxy);
      } else {
        console.log(`📨 [ReplyQueue] Skipping DM: sendDm=${data.sendDm}, hasReplyUrl=${!!result.replyUrl}`);
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

  queueDmSync(replyUrl: string, username: string, proxy?: string): Job {
    console.log(`📨 [ReplyQueue] Creating DM job for @${username}, replyUrl: ${replyUrl}`);

    // Create job directly without going through the async event system
    // This ensures the DM is in the queue BEFORE completeJob triggers processNext
    // Note: Humanization delay (7-14s) is handled by accountQueueManager
    const job = jobManager.createJobSync('dm', {
      message: replyUrl,
      username,
      proxy
    });

    // Directly enqueue to account queue (bypass the event listener)
    accountQueueManager.enqueueJob(username, job);

    console.log(`📨 [ReplyQueue] DM job ${job.id} directly enqueued (delay handled by accountQueueManager)`);
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
    const data = job.data as DmJobData & { proxy?: string };
    const accountUsername = username || data.username;

    try {
      const storage = await getStorage();
      const settings = await storage.getTwitterSettingsByUsername(data.username);

      if (!settings || !settings.twitterCookie) {
        throw new Error(`No Twitter cookie configured for user: ${data.username}`);
      }

      // Note: Humanization delay (7-14s) is handled by accountQueueManager before this runs
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
