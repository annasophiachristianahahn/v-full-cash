import { EventEmitter } from 'events';
import { Job } from './jobManager';

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

  /**
   * Add a job to an account's queue
   */
  enqueueJob(username: string, job: Job): void {
    if (!this.accountQueues.has(username)) {
      this.accountQueues.set(username, []);
    }

    const queue = this.accountQueues.get(username)!;
    queue.push(job);

    console.log(`[AccountQueue] Enqueued ${job.type} job ${job.id} for @${username} (queue size: ${queue.length})`);

    // Start processing if this account isn't already busy
    if (!this.processingJobs.has(username)) {
      this.processNextForAccount(username);
    }
  }

  /**
   * Process the next job for a specific account
   */
  private processNextForAccount(username: string): void {
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

    console.log(`[AccountQueue] Starting ${job.type} job ${job.id} for @${username} (${queue.length} remaining in queue)`);

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
      console.log(`[AccountQueue] Completed job ${jobId} for @${username}`);

      // Process next job for this account
      setImmediate(() => this.processNextForAccount(username));
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
