import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSSE, AutoRunState } from "@/hooks/use-sse";
import { Play, Pause, Square, RotateCcw, Zap, Bot, MessageSquare, Send } from "lucide-react";

interface AutoRunPanelProps {
  selectedUsername?: string; // No longer required - backend selects randomly
}

const defaultAutoRunState: AutoRunState = {
  status: 'idle',
  currentStep: 'Ready',
  progress: {
    tweetsFound: 0,
    repliesGenerated: 0,
    repliesSent: 0,
    repliesFailed: 0,
    raidRepliesSent: 0,
    raidRepliesFailed: 0,
    totalToProcess: 0
  }
};

export function AutoRunPanel({ selectedUsername }: AutoRunPanelProps) {
  const { toast } = useToast();
  const [sendDm, setSendDm] = useState(true);
  const [maxTweets, setMaxTweets] = useState(50);

  const { autoRunState: sseAutoRunState } = useSSE();
  const autoRunState = sseAutoRunState || defaultAutoRunState;

  const startMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/auto-run/start", {
        maxTweets,
        sendDm
      });
    },
    onSuccess: (data: any) => {
      const account = data?.selectedAccount || 'random';
      const rounds = data?.raidRounds || '2-4';
      toast({ 
        title: "Auto Run started", 
        description: `Using @${account} with ${rounds} raid rounds` 
      });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Failed to start", description: error.message });
    }
  });

  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auto-run/pause"),
    onSuccess: () => toast({ title: "Auto Run paused" })
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auto-run/resume"),
    onSuccess: () => toast({ title: "Auto Run resumed" })
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auto-run/cancel"),
    onSuccess: () => toast({ title: "Auto Run cancelled" })
  });

  const resetMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auto-run/reset"),
    onSuccess: () => toast({ title: "Auto Run reset" })
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'searching':
      case 'generating_replies':
      case 'sending_replies':
      case 'sending_raid_replies_1':
      case 'sending_raid_replies_2':
        return 'bg-green-500';
      case 'paused': return 'bg-yellow-500';
      case 'completed': return 'bg-blue-500';
      case 'failed':
      case 'cancelled':
        return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'searching': return <Bot className="w-4 h-4" />;
      case 'generating_replies': return <Zap className="w-4 h-4" />;
      case 'sending_replies': return <MessageSquare className="w-4 h-4" />;
      case 'sending_raid_replies_1': return <Send className="w-4 h-4" />;
      case 'sending_raid_replies_2': return <Send className="w-4 h-4" />;
      default: return null;
    }
  };

  const getDisplayStatus = (status: string) => {
    switch (status) {
      case 'searching': return 'SEARCHING';
      case 'generating_replies': return 'GENERATING';
      case 'sending_replies': return 'SENDING PRIMARY';
      case 'sending_raid_replies_1': return 'RAID ROUND 1';
      case 'sending_raid_replies_2': return 'RAID ROUND 2';
      case 'paused': return 'PAUSED';
      case 'completed': return 'COMPLETED';
      case 'failed': return 'FAILED';
      case 'cancelled': return 'CANCELLED';
      default: return 'IDLE';
    }
  };

  const progress = autoRunState.progress || defaultAutoRunState.progress;
  const progressPercent = progress.totalToProcess > 0 
    ? Math.round((progress.repliesSent / progress.totalToProcess) * 100) 
    : 0;

  const canStart = (autoRunState.status === 'idle' || autoRunState.status === 'completed' || 
                    autoRunState.status === 'cancelled' || autoRunState.status === 'failed');
  const isRunning = autoRunState.status === 'searching' || 
                    autoRunState.status === 'generating_replies' || 
                    autoRunState.status === 'sending_replies' ||
                    autoRunState.status === 'sending_raid_replies_1' ||
                    autoRunState.status === 'sending_raid_replies_2';
  const isPaused = autoRunState.status === 'paused';
  const isFinished = autoRunState.status === 'completed' || 
                     autoRunState.status === 'cancelled' || 
                     autoRunState.status === 'failed';

  return (
    <Card className="mb-6 border-2 border-primary/20" data-testid="auto-run-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2" data-testid="auto-run-title">
            <Zap className="w-5 h-5 text-primary" />
            Auto Run
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getStatusColor(autoRunState.status)}`} />
            <Badge variant="outline" data-testid="auto-run-status">
              {getDisplayStatus(autoRunState.status)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canStart && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="max-tweets">Max Tweets per Run</Label>
              <Input
                id="max-tweets"
                type="number"
                value={maxTweets}
                onChange={(e) => setMaxTweets(Number(e.target.value))}
                className="w-24"
                min={1}
                max={200}
                data-testid="input-max-tweets"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="send-dm">Send DMs after replies</Label>
              <Switch
                id="send-dm"
                checked={sendDm}
                onCheckedChange={setSendDm}
                data-testid="switch-send-dm"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <p>Uses pinned cashtags (max 8) + random trending/suggested</p>
              <p>Account: Randomly selected from available accounts</p>
              <p>Raid rounds: Randomly 2-4 rounds per run</p>
            </div>
          </div>
        )}

        {(isRunning || isPaused) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              {getStatusIcon(autoRunState.status)}
              <span>{autoRunState.currentStep || 'Processing...'}</span>
            </div>
            
            <Progress value={progressPercent} className="h-2" />
            
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Primary Replies</p>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg">{progress.tweetsFound}</div>
                  <div className="text-muted-foreground">Found</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg">{progress.repliesGenerated}</div>
                  <div className="text-muted-foreground">Generated</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg text-green-500">{progress.repliesSent}</div>
                  <div className="text-muted-foreground">Sent</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg text-red-500">{progress.repliesFailed}</div>
                  <div className="text-muted-foreground">Failed</div>
                </div>
              </div>
              
              {(progress.raidRepliesSent > 0 || progress.raidRepliesFailed > 0 || 
                autoRunState.status === 'sending_raid_replies_1' || autoRunState.status === 'sending_raid_replies_2') && (
                <>
                  <p className="text-xs text-muted-foreground font-medium mt-3">Raid Replies</p>
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="p-2 bg-muted rounded">
                      <div className="font-bold text-lg text-green-500">{progress.raidRepliesSent || 0}</div>
                      <div className="text-muted-foreground">Sent</div>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <div className="font-bold text-lg text-red-500">{progress.raidRepliesFailed || 0}</div>
                      <div className="text-muted-foreground">Failed</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {isFinished && (
          <div className="py-4 space-y-3">
            <div className={`font-medium text-center ${autoRunState.status === 'completed' ? 'text-green-500' : 'text-red-500'}`}>
              {autoRunState.status === 'completed' ? 'Workflow Complete!' : 
               autoRunState.status === 'cancelled' ? 'Workflow Cancelled' : 'Workflow Failed'}
            </div>
            
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Primary Replies</p>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg">{progress.tweetsFound}</div>
                  <div className="text-muted-foreground">Found</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg">{progress.repliesGenerated}</div>
                  <div className="text-muted-foreground">Generated</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg text-green-500">{progress.repliesSent}</div>
                  <div className="text-muted-foreground">Sent</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="font-bold text-lg text-red-500">{progress.repliesFailed}</div>
                  <div className="text-muted-foreground">Failed</div>
                </div>
              </div>
              
              {(progress.raidRepliesSent > 0 || progress.raidRepliesFailed > 0) && (
                <>
                  <p className="text-xs text-muted-foreground font-medium mt-3">Raid Replies</p>
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="p-2 bg-muted rounded">
                      <div className="font-bold text-lg text-green-500">{progress.raidRepliesSent || 0}</div>
                      <div className="text-muted-foreground">Sent</div>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <div className="font-bold text-lg text-red-500">{progress.raidRepliesFailed || 0}</div>
                      <div className="text-muted-foreground">Failed</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {autoRunState.error && (
          <div className="text-sm text-red-500 p-2 bg-red-500/10 rounded">
            Error: {autoRunState.error}
          </div>
        )}

        {/* Show recent error messages from failed replies */}
        {autoRunState.recentErrors && autoRunState.recentErrors.length > 0 && (
          <div className="text-xs p-2 bg-red-500/10 rounded border border-red-500/20 max-h-32 overflow-y-auto">
            <p className="font-medium text-red-500 mb-1">Recent Errors ({autoRunState.recentErrors.length}):</p>
            {autoRunState.recentErrors.map((err, i) => (
              <p key={i} className="text-red-400 truncate" title={err}>
                {err}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {canStart && (
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="flex-1"
              data-testid="button-start-auto-run"
            >
              <Play className="w-4 h-4 mr-2" />
              Start Auto Run
            </Button>
          )}

          {isRunning && (
            <>
              <Button
                onClick={() => pauseMutation.mutate()}
                variant="outline"
                className="flex-1"
                disabled={pauseMutation.isPending}
                data-testid="button-pause-auto-run"
              >
                <Pause className="w-4 h-4 mr-2" />
                Pause
              </Button>
              <Button
                onClick={() => cancelMutation.mutate()}
                variant="destructive"
                className="flex-1"
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-auto-run"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop Run
              </Button>
            </>
          )}

          {isPaused && (
            <>
              <Button
                onClick={() => resumeMutation.mutate()}
                className="flex-1"
                disabled={resumeMutation.isPending}
                data-testid="button-resume-auto-run"
              >
                <Play className="w-4 h-4 mr-2" />
                Resume
              </Button>
              <Button
                onClick={() => cancelMutation.mutate()}
                variant="destructive"
                className="flex-1"
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-auto-run-paused"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop Run
              </Button>
            </>
          )}

          {isFinished && (
            <Button
              onClick={() => resetMutation.mutate()}
              variant="outline"
              className="flex-1"
              disabled={resetMutation.isPending}
              data-testid="button-reset-auto-run"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
