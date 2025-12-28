import { useState, useEffect, useMemo } from 'react';
import { useSSE, ScheduledRunState } from '@/hooks/use-sse';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Clock, 
  Plus, 
  Trash2, 
  ChevronDown, 
  ChevronUp,
  Calendar,
  Timer,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

function formatTimeToEST(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { 
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function formatDateToEST(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { 
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric'
  });
}

function CountdownTimer({ targetTime, isJobRunning }: { targetTime: string; isJobRunning?: boolean }) {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  useEffect(() => {
    const calculateRemaining = () => {
      const target = new Date(targetTime).getTime();
      const now = Date.now();
      return Math.max(0, Math.floor((target - now) / 1000));
    };

    setTimeRemaining(calculateRemaining());

    const interval = setInterval(() => {
      setTimeRemaining(calculateRemaining());
    }, 1000);

    return () => clearInterval(interval);
  }, [targetTime]);

  const hours = Math.floor(timeRemaining / 3600);
  const minutes = Math.floor((timeRemaining % 3600) / 60);
  const seconds = timeRemaining % 60;

  if (timeRemaining === 0) {
    if (isJobRunning) {
      return <span className="text-green-500 font-medium animate-pulse">Running...</span>;
    }
    return <span className="text-yellow-500 font-medium">Starting...</span>;
  }

  return (
    <span className="font-mono text-sm">
      {hours > 0 && `${hours}h `}{minutes}m {seconds}s
    </span>
  );
}

function ScheduleItem({ 
  schedule, 
  onDelete, 
  onToggle,
  isDeleting,
  isJobRunning
}: { 
  schedule: ScheduledRunState; 
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  isDeleting: boolean;
  isJobRunning: boolean;
}) {
  const baseTime = schedule.timeOfDay;
  const offsetMinutes = schedule.randomOffsetMinutes;
  
  const [baseHours, baseMinutes] = baseTime.split(':').map(Number);
  const totalMinutes = baseHours * 60 + baseMinutes + offsetMinutes;
  const actualHours = Math.floor(totalMinutes / 60) % 24;
  const actualMinutes = totalMinutes % 60;
  const actualTimeStr = `${String(actualHours).padStart(2, '0')}:${String(actualMinutes).padStart(2, '0')}`;
  
  const formatTime12h = (time24: string) => {
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div 
      className={cn(
        "p-4 rounded-lg border bg-card",
        !schedule.enabled && "opacity-50"
      )}
      data-testid={`schedule-item-${schedule.id}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Switch
            checked={schedule.enabled}
            onCheckedChange={(checked) => onToggle(schedule.id, checked)}
            data-testid={`switch-toggle-${schedule.id}`}
          />
          
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-lg">
                {formatTime12h(baseTime)} EST
              </span>
              {offsetMinutes > 0 && (
                <Badge variant="outline" className="text-xs">
                  +{offsetMinutes}min offset
                </Badge>
              )}
            </div>
            
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <Timer className="w-3 h-3" />
              <span>Actual run: {formatTime12h(actualTimeStr)} EST</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {schedule.enabled && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-1">Next run in:</div>
              <Badge variant="secondary" className="font-mono">
                <CountdownTimer targetTime={schedule.nextRunTime} isJobRunning={isJobRunning} />
              </Badge>
            </div>
          )}
          
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(schedule.id)}
            disabled={isDeleting}
            data-testid={`button-delete-${schedule.id}`}
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
      
      {schedule.lastRun && (
        <div className="mt-2 text-xs text-muted-foreground">
          Last run: {formatTimeToEST(schedule.lastRun)} on {formatDateToEST(schedule.lastRun)}
        </div>
      )}
    </div>
  );
}

export function SchedulerPanel() {
  const { schedulerState, connected, autoRunState } = useSSE();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(true);
  const [newTime, setNewTime] = useState('09:00');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const addScheduleMutation = useMutation({
    mutationFn: async (timeOfDay: string) => {
      return apiRequest('POST', '/api/schedules', { timeOfDay });
    },
    onSuccess: () => {
      toast({ title: 'Schedule added' });
    },
    onError: (error: any) => {
      toast({ 
        title: 'Failed to add schedule', 
        description: error.message,
        variant: 'destructive' 
      });
    }
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      setDeletingId(id);
      return apiRequest('DELETE', `/api/schedules/${id}`);
    },
    onSuccess: () => {
      toast({ title: 'Schedule deleted' });
      setDeletingId(null);
    },
    onError: (error: any) => {
      toast({ 
        title: 'Failed to delete schedule', 
        description: error.message,
        variant: 'destructive' 
      });
      setDeletingId(null);
    }
  });

  const toggleScheduleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest('PATCH', `/api/schedules/${id}`, { enabled });
    },
    onSuccess: (_, variables) => {
      toast({ title: `Schedule ${variables.enabled ? 'enabled' : 'disabled'}` });
    },
    onError: (error: any) => {
      toast({ 
        title: 'Failed to toggle schedule', 
        description: error.message,
        variant: 'destructive' 
      });
    }
  });

  const handleAddSchedule = () => {
    if (!newTime) return;
    addScheduleMutation.mutate(newTime);
  };

  const schedules = schedulerState?.schedules || [];
  const isAutoRunActive = autoRunState && 
    !['idle', 'completed', 'failed', 'cancelled'].includes(autoRunState.status);

  const sortedSchedules = useMemo(() => {
    return [...schedules].sort((a, b) => {
      const timeA = a.timeOfDay.replace(':', '');
      const timeB = b.timeOfDay.replace(':', '');
      return timeA.localeCompare(timeB);
    });
  }, [schedules]);

  return (
    <Card className="mb-4 border-2 border-primary/20" data-testid="scheduler-panel">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-0 hover:bg-transparent"
              data-testid="button-toggle-scheduler"
            >
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg font-semibold">AUTO RUN SCHEDULER</CardTitle>
                {schedules.length > 0 && (
                  <Badge variant="secondary">{schedules.length} scheduled</Badge>
                )}
                {isAutoRunActive && (
                  <Badge variant="default" className="bg-green-500">
                    <Zap className="w-3 h-3 mr-1" />
                    Running
                  </Badge>
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
            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="text-muted-foreground">
                Schedule daily Auto Runs. Each run randomly selects 4 trending + 4 suggested cashtags 
                and picks a random account for primary replies. Runs repeat daily with new randomized delays (2-15 min).
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-sm text-muted-foreground mb-1 block">
                  Add scheduled time (EST)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="flex-1"
                    data-testid="input-schedule-time"
                  />
                  <Button
                    onClick={handleAddSchedule}
                    disabled={addScheduleMutation.isPending || !newTime}
                    data-testid="button-add-schedule"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {sortedSchedules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No scheduled runs</p>
                <p className="text-xs mt-1">Add a time above to start scheduling</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedSchedules.map(schedule => (
                  <ScheduleItem
                    key={schedule.id}
                    schedule={schedule}
                    onDelete={(id) => deleteScheduleMutation.mutate(id)}
                    onToggle={(id, enabled) => toggleScheduleMutation.mutate({ id, enabled })}
                    isDeleting={deletingId === schedule.id}
                    isJobRunning={autoRunState?.status === 'running' || autoRunState?.status === 'replying'}
                  />
                ))}
              </div>
            )}

            {!connected && (
              <div className="text-center text-sm text-destructive">
                Disconnected from server - schedules will still run on the backend
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
