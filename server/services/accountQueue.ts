import { EventEmitter } from 'events';
import { Job, jobManager } from './jobManager';

// Minimum delay between jobs to maintain human-like behavior
// even when jobs pile up due to slow processing
// 15-30 seconds simulates human time to read next tweet, think, and compose response
// Humanization timing constants - simulates realistic human behavior
const MIN_INTER_JOB_DELAY_MS = 15000;  // 15 seconds minimum between jobs
const MAX_INTER_JOB_DELAY_MS = 30000;  // 30 seconds maximum

const randomDelay = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Per-Account Job Queue
 *
 * Ensures that each Twitter account processes jobs sequentially (human-like behavior)
 * while allowing different accounts to work in parallel.
 *
 * This solves the timing issue where event handlers were blocking:
 * - Each account has its own queue
 * - Jobs for an account are processed one at a time
 * - Different accounts can process jobs simultaneously
 * - No event handler blocking - jobs are queued and processed asynchronously
 */
class AccountQueueManager extends EventEmitter {
  // Map of username -> array of pending jobs
  private accountQueues: Map<string, Job[]> = new Map();

  // Map of username -> currently processing job ID
  private processingJobs: Map<string, string> = new Map();

  // Map of username -> timestamp of last job completion (for humanization delays)
  private lastCompletionTimes: Map<string, number> = new Map();

  /**
   * Add a job to an account's queue
   */
  enqueueJob(username: string, job: Job): void {
    if (!this.accountQueues.has(username)) {
      this.accountQueues.set(username, []);
    }

    const queue = this.accountQueues.get(username)!;
    queue.push(job);

    const isAccountBusy = this.processingJobs.has(username);
    const currentJobId = this.processingJobs.get(username);
    console.log(`[AccountQueue] Enqueued ${job.type} job ${job.id} for @${username} (queue size: ${queue.length}, account busy: ${isAccountBusy}, current job: ${currentJobId || 'none'})`);

    // Start processing if this account isn't already busy
    if (!isAccountBusy) {
      this.processNextForAccount(username);
    }
  }

  /**
   * Process the next job for a specific account
   * Adds humanization delay to maintain natural-looking timing even when jobs pile up
   */
  private async processNextForAccount(username: string): Promise<void> {
    const queue = this.accountQueues.get(username);
    if (!queue || queue.length === 0) {
      return;
    }

    // Check if already processing
    if (this.processingJobs.has(username)) {
      return;
    }

    const job = queue.shift()!;
    this.processingJobs.set(username, job.id);

    // Check if there are more jobs waiting - if so, add humanization delay
    // This prevents rapid-fire execution when jobs pile up due to slow processing
    const lastCompletionTime = this.lastCompletionTimes.get(username);
    if (lastCompletionTime) {
      const timeSinceLastJob = Date.now() - lastCompletionTime;
      if (timeSinceLastJob < MIN_INTER_JOB_DELAY_MS) {
        const remainingDelay = randomDelay(MIN_INTER_JOB_DELAY_MS, MAX_INTER_JOB_DELAY_MS) - timeSinceLastJob;
        if (remainingDelay > 0) {
          console.log(`[AccountQueue] Humanization delay: waiting ${Math.round(remainingDelay / 1000)}s before next job for @${username}`);
          await new Promise(resolve => setTimeout(resolve, remainingDelay));
        }
      }
    }

    console.log(`[AccountQueue] Starting ${job.type} job ${job.id} for @${username} (${queue.length} remaining in queue)`);

    // Mark job as actually running now (not just queued)
    jobManager.markJobRunning(job.id);

    // Emit event to start processing
    this.emit('process-job', job, username);
  }

  /**
   * Mark a job as complete and process next job for this account
   */
  completeJob(username: string, jobId: string): void {
    const currentJobId = this.processingJobs.get(username);

    if (currentJobId === jobId) {
      this.processingJobs.delete(username);
      this.lastCompletionTimes.set(username, Date.now()); // Track completion time for humanization
      const queue = this.accountQueues.get(username);
      const queueSize = queue ? queue.length : 0;
      console.log(`[AccountQueue] Completed job ${jobId} for @${username} (${queueSize} jobs remaining in queue)`);

      // Process next job for this account
      setImmediate(() => this.processNextForAccount(username));
    } else {
      console.warn(`[AccountQueue] Tried to complete job ${jobId} for @${username} but current job is ${currentJobId || 'none'}`);
    }
  }

  /**
   * Get queue status for an account
   */
  getAccountQueueStatus(username: string): {
    queueSize: number;
    isProcessing: boolean;
    currentJobId?: string;
  } {
    const queue = this.accountQueues.get(username) || [];
    const currentJobId = this.processingJobs.get(username);

    return {
      queueSize: queue.length,
      isProcessing: !!currentJobId,
      currentJobId
    };
  }

  /**
   * Get all account queue statuses
   */
  getAllAccountStatuses(): Map<string, ReturnType<typeof this.getAccountQueueStatus>> {
    const statuses = new Map();

    // Get all unique usernames
    const usernames = new Set([
      ...this.accountQueues.keys(),
      ...this.processingJobs.keys()
    ]);

    for (const username of usernames) {
      statuses.set(username, this.getAccountQueueStatus(username));
    }

    return statuses;
  }

  /**
   * Clear all jobs for an account
   */
  clearAccountQueue(username: string): number {
    const queue = this.accountQueues.get(username);
    const count = queue ? queue.length : 0;

    if (queue) {
      queue.length = 0;
    }

    this.processingJobs.delete(username);

    return count;
  }
}

export const accountQueueManager = new AccountQueueManager();
