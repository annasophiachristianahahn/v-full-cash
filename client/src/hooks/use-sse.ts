import { useState, useEffect, useCallback, useRef } from 'react';

export interface Job {
  id: string;
  type: 'reply' | 'dm' | 'search' | 'bulk_reply';
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';
  data: any;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: any;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
  timeRemaining?: number;
}

export interface JobState {
  jobs: Job[];
  summary: {
    total: number;
    pending: number;
    scheduled: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  timestamp: string;
}

export interface AutoRunState {
  status: 'idle' | 'searching' | 'generating_replies' | 'sending_replies' | 'sending_raid_replies_1' | 'sending_raid_replies_2' | 'completed' | 'paused' | 'cancelled' | 'failed';
  currentStep: string;
  progress: {
    tweetsFound: number;
    repliesGenerated: number;
    repliesSent: number;
    repliesFailed: number;
    raidRepliesSent: number;
    raidRepliesFailed: number;
    totalToProcess: number;
  };
  error?: string;
  searchJobId?: string;
  replyJobIds?: string[];
  raidReplyJobIds?: string[];
  sentReplyUrls?: string[];
  recentErrors?: string[]; // Last few error messages for display
}

export interface ScheduledRunState {
  id: string;
  timeOfDay: string;
  enabled: boolean;
  randomOffsetMinutes: number;
  nextRunTime: string;
  lastRun: string | null;
}

export interface SchedulerState {
  schedules: ScheduledRunState[];
}

interface UseSSEReturn {
  connected: boolean;
  jobState: JobState | null;
  autoRunState: AutoRunState | null;
  schedulerState: SchedulerState | null;
  replyJobs: Job[];
  dmJobs: Job[];
  scheduledReplies: Job[];
  activeReplies: Job[];
}

export function useSSE(): UseSSEReturn {
  const [connected, setConnected] = useState(false);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [autoRunState, setAutoRunState] = useState<AutoRunState | null>(null);
  const [schedulerState, setSchedulerState] = useState<SchedulerState | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/api/events');
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', (event) => {
      setConnected(true);
      console.log('[SSE] Connected:', JSON.parse(event.data));
    });

    eventSource.addEventListener('state', (event) => {
      const state = JSON.parse(event.data);
      setJobState(state);
    });

    eventSource.addEventListener('autorun:state', (event) => {
      const state = JSON.parse(event.data);
      setAutoRunState(state);
    });

    eventSource.addEventListener('scheduler:state', (event) => {
      const state = JSON.parse(event.data);
      setSchedulerState(state);
    });

    eventSource.addEventListener('job:created', (event) => {
      const job = JSON.parse(event.data);
      console.log('[SSE] Job created:', job.id, job.type);
    });

    eventSource.addEventListener('job:started', (event) => {
      const job = JSON.parse(event.data);
      console.log('[SSE] Job started:', job.id);
    });

    eventSource.addEventListener('job:completed', (event) => {
      const job = JSON.parse(event.data);
      console.log('[SSE] Job completed:', job.id, job.result);
    });

    eventSource.addEventListener('job:failed', (event) => {
      const job = JSON.parse(event.data);
      console.log('[SSE] Job failed:', job.id, job.error);
    });

    eventSource.addEventListener('job:cancelled', (event) => {
      const job = JSON.parse(event.data);
      console.log('[SSE] Job cancelled:', job.id);
    });

    eventSource.addEventListener('heartbeat', () => {
    });

    eventSource.onerror = () => {
      setConnected(false);
      eventSource.close();
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('[SSE] Reconnecting...');
        connect();
      }, 3000);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  const replyJobs = jobState?.jobs.filter(j => j.type === 'reply') ?? [];
  const dmJobs = jobState?.jobs.filter(j => j.type === 'dm') ?? [];
  const scheduledReplies = replyJobs.filter(j => j.status === 'scheduled');
  const activeReplies = replyJobs.filter(j => 
    j.status === 'pending' || j.status === 'scheduled' || j.status === 'running'
  );

  return {
    connected,
    jobState,
    autoRunState,
    schedulerState,
    replyJobs,
    dmJobs,
    scheduledReplies,
    activeReplies
  };
}

export function useJobQueue() {
  const queueReply = useCallback(async (data: {
    tweetId: string;
    replyText: string;
    username: string;
    tweetUrl?: string;
    mediaUrl?: string;
    authorHandle?: string;
    delaySeconds?: number;
    sendDm?: boolean;
    dmDelaySeconds?: number;
  }) => {
    const response = await fetch('/api/queue/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to queue reply');
    }
    
    return response.json();
  }, []);

  const queueBulkReplies = useCallback(async (data: {
    replies: Array<{
      tweetId: string;
      replyText: string;
      username: string;
      tweetUrl?: string;
      mediaUrl?: string;
      authorHandle?: string;
    }>;
    sendDm?: boolean;
    dmDelayRange?: { min: number; max: number };
    replyDelayRange?: { min: number; max: number };
  }) => {
    const response = await fetch('/api/queue/bulk-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to queue bulk replies');
    }
    
    return response.json();
  }, []);

  const cancelJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to cancel job');
    }
    
    return response.json();
  }, []);

  const cancelAllJobs = useCallback(async () => {
    const response = await fetch('/api/jobs', {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to cancel all jobs');
    }
    
    return response.json();
  }, []);

  const getQueueStatus = useCallback(async () => {
    const response = await fetch('/api/queue/status');
    
    if (!response.ok) {
      throw new Error('Failed to get queue status');
    }
    
    return response.json();
  }, []);

  return {
    queueReply,
    queueBulkReplies,
    cancelJob,
    cancelAllJobs,
    getQueueStatus
  };
}
