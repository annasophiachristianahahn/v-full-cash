import { useState, useEffect } from 'react';
import { useSSE, useJobQueue, Job } from '@/hooks/use-sse';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Clock, 
  Play, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Trash2,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Send,
  MessageSquare,
  ExternalLink,
  User
} from 'lucide-react';
import { formatTimeRemaining } from '@/lib/formatters';
import { cn } from '@/lib/utils';

function JobStatusBadge({ status }: { status: Job['status'] }) {
  const config = {
    pending: { label: 'Pending', variant: 'secondary' as const, icon: Clock },
    scheduled: { label: 'Scheduled', variant: 'outline' as const, icon: Clock },
    running: { label: 'Running', variant: 'default' as const, icon: Play },
    completed: { label: 'Completed', variant: 'default' as const, icon: CheckCircle },
    failed: { label: 'Failed', variant: 'destructive' as const, icon: XCircle },
    cancelled: { label: 'Cancelled', variant: 'secondary' as const, icon: AlertCircle },
  };

  const { label, variant, icon: Icon } = config[status];

  return (
    <Badge variant={variant} className="flex items-center gap-1">
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}

function JobItem({ job, onCancel, showTimer = true }: { job: Job; onCancel: (id: string) => void; showTimer?: boolean }) {
  const [timeRemaining, setTimeRemaining] = useState(job.timeRemaining || 0);

  useEffect(() => {
    if (job.status !== 'scheduled' || !job.scheduledAt) return;

    const interval = setInterval(() => {
      const scheduled = new Date(job.scheduledAt!);
      const now = new Date();
      const remaining = Math.max(0, Math.floor((scheduled.getTime() - now.getTime()) / 1000));
      setTimeRemaining(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [job.status, job.scheduledAt]);

  const isActive = ['pending', 'scheduled', 'running'].includes(job.status);
  const canCancel = job.status === 'scheduled';

  return (
    <div 
      className={cn(
        "p-3 rounded-lg border",
        isActive ? "bg-card" : "bg-muted/50",
        job.status === 'failed' && "border-destructive/50"
      )}
      data-testid={`job-item-${job.id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {job.type === 'reply' ? (
            <Send className="w-4 h-4 text-blue-500" />
          ) : job.type === 'dm' ? (
            <MessageSquare className="w-4 h-4 text-green-500" />
          ) : (
            <Clock className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="font-medium text-sm">
            {job.type === 'reply' ? 'Reply' : job.type === 'dm' ? 'DM' : job.type}
          </span>
          <JobStatusBadge status={job.status} />
          
          {job.data?.username && (
            <Badge variant="outline" className="flex items-center gap-1 text-xs">
              <User className="w-3 h-3" />
              @{job.data.username}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showTimer && job.status === 'scheduled' && timeRemaining > 0 && (
            <Badge variant="secondary" className="font-mono text-xs">
              {formatTimeRemaining(timeRemaining)}
            </Badge>
          )}
          
          {canCancel && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onCancel(job.id)}
              data-testid={`button-cancel-job-${job.id}`}
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>
      
      {job.type === 'reply' && job.data?.replyText && (
        <div className="bg-muted/50 rounded p-2 mb-2">
          <p className="text-xs text-foreground line-clamp-2">
            {job.data.replyText}
          </p>
        </div>
      )}

      {job.type === 'dm' && job.data?.message && (
        <div className="bg-muted/50 rounded p-2 mb-2">
          <p className="text-xs text-foreground truncate">
            {job.data.message}
          </p>
        </div>
      )}
      
      {job.error && (
        <p className="text-xs text-destructive mt-1">
          {job.error}
        </p>
      )}
      
      {job.result?.replyUrl && (
        <a 
          href={job.result.replyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-1"
          data-testid={`link-view-reply-${job.id}`}
        >
          <ExternalLink className="w-3 h-3" />
          View on X
        </a>
      )}
    </div>
  );
}

export function JobQueuePanel() {
  const { connected, jobState, scheduledReplies } = useSSE();
  const { cancelJob, cancelAllJobs } = useJobQueue();
  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'complete'>('active');

  const handleCancel = async (jobId: string) => {
    try {
      await cancelJob(jobId);
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  const handleCancelAll = async () => {
    try {
      await cancelAllJobs();
    } catch (error) {
      console.error('Failed to cancel all jobs:', error);
    }
  };

  const activeJobs = jobState?.jobs.filter(j => 
    ['pending', 'scheduled', 'running'].includes(j.status)
  ) ?? [];

  const completedJobs = jobState?.jobs.filter(j => 
    ['completed', 'failed', 'cancelled'].includes(j.status)
  ) ?? [];

  const completedReplies = completedJobs.filter(j => j.type === 'reply' && j.status === 'completed');
  const failedJobs = completedJobs.filter(j => j.status === 'failed');

  if (activeJobs.length === 0 && completedJobs.length === 0) {
    return null;
  }

  return (
    <Card className="mb-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-0 hover:bg-transparent"
              data-testid="button-toggle-job-queue"
            >
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-semibold">JOB QUEUE</CardTitle>
                {connected ? (
                  <Wifi className="w-4 h-4 text-green-500" />
                ) : (
                  <WifiOff className="w-4 h-4 text-destructive" />
                )}
                {activeJobs.length > 0 && (
                  <Badge variant="secondary">{activeJobs.length} active</Badge>
                )}
                {completedJobs.length > 0 && (
                  <Badge variant="outline">{completedJobs.length} complete</Badge>
                )}
              </div>
              {isOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'active' | 'complete')}>
              <div className="flex justify-between items-center mb-3">
                <TabsList>
                  <TabsTrigger value="active" data-testid="tab-active-jobs">
                    ACTIVE
                    {activeJobs.length > 0 && (
                      <Badge variant="secondary" className="ml-2">{activeJobs.length}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="complete" data-testid="tab-complete-jobs">
                    COMPLETE
                    {completedJobs.length > 0 && (
                      <Badge variant="outline" className="ml-2">{completedJobs.length}</Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {activeTab === 'active' && activeJobs.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelAll}
                    data-testid="button-cancel-all-jobs"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Cancel All
                  </Button>
                )}
              </div>

              <TabsContent value="active" className="mt-0">
                {activeJobs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No active jobs</p>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-4 text-xs text-muted-foreground mb-3">
                      <span>{scheduledReplies.length} replies scheduled</span>
                      <span>{activeJobs.filter(j => j.type === 'dm').length} DMs scheduled</span>
                    </div>
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2 pr-4">
                        {activeJobs.map(job => (
                          <JobItem key={job.id} job={job} onCancel={handleCancel} showTimer={true} />
                        ))}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </TabsContent>

              <TabsContent value="complete" className="mt-0">
                {completedJobs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No completed jobs yet</p>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-4 text-xs text-muted-foreground mb-3">
                      <span className="text-green-500">{completedReplies.length} replies sent</span>
                      <span className="text-green-500">{completedJobs.filter(j => j.type === 'dm' && j.status === 'completed').length} DMs sent</span>
                      {failedJobs.length > 0 && (
                        <span className="text-destructive">{failedJobs.length} failed</span>
                      )}
                    </div>
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2 pr-4">
                        {completedJobs.map(job => (
                          <JobItem key={job.id} job={job} onCancel={handleCancel} showTimer={false} />
                        ))}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </TabsContent>
            </Tabs>

            {jobState?.summary && (
              <div className="flex gap-4 text-xs text-muted-foreground border-t pt-3">
                <span>Total: {jobState.summary.total}</span>
                <span className="text-green-500">Completed: {jobState.summary.completed}</span>
                {jobState.summary.failed > 0 && (
                  <span className="text-destructive">Failed: {jobState.summary.failed}</span>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
