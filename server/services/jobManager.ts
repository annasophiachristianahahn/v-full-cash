import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export type JobType = 'reply' | 'dm' | 'search' | 'bulk_reply' | 'like';
export type JobStatus = 'pending' | 'scheduled' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  data: any;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: any;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
}

export interface ReplyJobData {
  tweetId: string;
  replyText: string;
  username: string;
  tweetUrl?: string;
  mediaUrl?: string;
  authorHandle?: string;
  delaySeconds: number;
}

export interface DmJobData {
  message: string;
  replyUrl: string;
  delaySeconds: number;
  username: string;
}

export interface BulkReplyJobData {
  replies: ReplyJobData[];
  sendDmAfterReply: boolean;
  dmDelayRange: { min: number; max: number };
}

export interface SearchJobData {
  searchId: string;
  cashtags: string[];
  params: any;
}

class JobManager extends EventEmitter {
  private jobs: Map<string, Job> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private running: boolean = true;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  createJob(type: JobType, data: any, delaySeconds: number = 0): Job {
    const id = randomUUID();
    const now = new Date();

    const job: Job = {
      id,
      type,
      status: delaySeconds > 0 ? 'scheduled' : 'pending',
      data,
      scheduledAt: delaySeconds > 0 ? new Date(now.getTime() + delaySeconds * 1000) : undefined,
    };

    this.jobs.set(id, job);
    this.emit('job:created', job);
    this.emitStateChange();

    if (delaySeconds > 0) {
      this.scheduleJob(job, delaySeconds);
    } else {
      setImmediate(() => this.executeJob(id));
    }

    return job;
  }

  // Synchronous job creation - for cases where we need to directly enqueue
  // without going through the async event system (e.g., DMs after replies)
  createJobSync(type: JobType, data: any): Job {
    const id = randomUUID();

    const job: Job = {
      id,
      type,
      status: 'queued', // Already queued, will be set to running by accountQueueManager
      data,
    };

    this.jobs.set(id, job);
    this.emit('job:created', job);
    this.emitStateChange();

    // Don't emit job:started or call executeJob - caller will handle enqueueing
    return job;
  }

  private scheduleJob(job: Job, delaySeconds: number) {
    const timer = setTimeout(() => {
      this.timers.delete(job.id);
      this.executeJob(job.id);
    }, delaySeconds * 1000);

    this.timers.set(job.id, timer);
    
    const updateInterval = setInterval(() => {
      const currentJob = this.jobs.get(job.id);
      if (!currentJob || currentJob.status !== 'scheduled') {
        clearInterval(updateInterval);
        return;
      }
      this.emitStateChange();
    }, 1000);

    setTimeout(() => clearInterval(updateInterval), delaySeconds * 1000 + 1000);
  }

  async executeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Set to 'queued' - accountQueueManager will set to 'running' when actually processing
    job.status = 'queued';
    this.emit('job:started', job);
    this.emitStateChange();
  }

  // Called by accountQueueManager when job actually starts processing
  markJobRunning(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'running';
    job.startedAt = new Date();
    this.emitStateChange();
  }

  updateJobProgress(jobId: string, current: number, total: number, message?: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = { current, total, message };
    this.emit('job:progress', job);
    this.emitStateChange();
  }

  completeJob(jobId: string, result?: any) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.completedAt = new Date();
    job.result = result;
    this.emit('job:completed', job);
    this.emitStateChange();
  }

  failJob(jobId: string, error: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'failed';
    job.completedAt = new Date();
    job.error = error;
    this.emit('job:failed', job);
    this.emitStateChange();
  }

  cancelJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }

    job.status = 'cancelled';
    job.completedAt = new Date();
    this.emit('job:cancelled', job);
    this.emitStateChange();
  }

  cancelAllPending(): number {
    let cancelled = 0;
    for (const [jobId, job] of this.jobs) {
      if (job.status === 'pending' || job.status === 'scheduled') {
        this.cancelJob(jobId);
        cancelled++;
      }
    }
    return cancelled;
  }

  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  getActiveJobs(): Job[] {
    return Array.from(this.jobs.values()).filter(
      job => job.status === 'pending' || job.status === 'scheduled' || job.status === 'queued' || job.status === 'running'
    );
  }

  getJobsByType(type: JobType): Job[] {
    return Array.from(this.jobs.values()).filter(job => job.type === type);
  }

  getScheduledReplies(): Job[] {
    return Array.from(this.jobs.values()).filter(
      job => job.type === 'reply' && job.status === 'scheduled'
    );
  }

  getTimeRemaining(jobId: string): number {
    const job = this.jobs.get(jobId);
    if (!job || !job.scheduledAt || job.status !== 'scheduled') return 0;
    
    const remaining = job.scheduledAt.getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }

  getState(): {
    jobs: Job[];
    activeCount: number;
    scheduledCount: number;
    queuedCount: number;
    runningCount: number;
    completedCount: number;
  } {
    const jobs = this.getAllJobs();
    return {
      jobs,
      activeCount: jobs.filter(j => ['pending', 'scheduled', 'queued', 'running'].includes(j.status)).length,
      scheduledCount: jobs.filter(j => j.status === 'scheduled').length,
      queuedCount: jobs.filter(j => j.status === 'queued').length,
      runningCount: jobs.filter(j => j.status === 'running').length,
      completedCount: jobs.filter(j => j.status === 'completed').length,
    };
  }

  getFullState(): any {
    const jobs = this.getAllJobs();
    const now = Date.now();
    
    return {
      jobs: jobs.map(job => ({
        ...job,
        timeRemaining: job.scheduledAt && job.status === 'scheduled' 
          ? Math.max(0, Math.floor((job.scheduledAt.getTime() - now) / 1000))
          : undefined
      })),
      summary: {
        total: jobs.length,
        pending: jobs.filter(j => j.status === 'pending').length,
        scheduled: jobs.filter(j => j.status === 'scheduled').length,
        queued: jobs.filter(j => j.status === 'queued').length,
        running: jobs.filter(j => j.status === 'running').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        cancelled: jobs.filter(j => j.status === 'cancelled').length,
      },
      timestamp: new Date().toISOString()
    };
  }

  clearCompletedJobs(olderThanMs: number = 3600000) {
    const cutoff = Date.now() - olderThanMs;
    const entries = Array.from(this.jobs.entries());
    let cleared = 0;
    for (const [id, job] of entries) {
      // Clear completed, failed, and cancelled jobs older than cutoff
      if (job.completedAt && job.completedAt.getTime() < cutoff &&
          (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
        this.jobs.delete(id);
        cleared++;
      }
    }
    if (cleared > 0) {
      this.emitStateChange();
    }
    return cleared;
  }

  // Start automatic cleanup every 30 minutes
  startAutoCleanup() {
    setInterval(() => {
      const cleared = this.clearCompletedJobs(30 * 60 * 1000); // Clear jobs older than 30 minutes
      if (cleared > 0) {
        console.log(`[JobManager] Auto-cleanup: cleared ${cleared} old jobs`);
      }
    }, 30 * 60 * 1000); // Run every 30 minutes

    // Also clear any old jobs on startup (older than 1 hour)
    const initialCleared = this.clearCompletedJobs(60 * 60 * 1000);
    if (initialCleared > 0) {
      console.log(`[JobManager] Startup cleanup: cleared ${initialCleared} old jobs`);
    }
  }

  private emitStateChange() {
    this.emit('state:change', this.getFullState());
  }

  shutdown() {
    this.running = false;
    const timers = Array.from(this.timers.values());
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

export const jobManager = new JobManager();
