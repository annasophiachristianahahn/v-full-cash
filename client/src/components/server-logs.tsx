import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { FileText, RefreshCw, Download, Filter, Copy, Trash2 } from "lucide-react";

type LogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
};

export function ServerLogs() {
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [limit, setLimit] = useState(500);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['server-logs', filterLevel, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (filterLevel) params.set('level', filterLevel);

      const response = await apiRequest('GET', `/api/logs?${params.toString()}`);
      return response.json() as Promise<{ logs: LogEntry[]; total: number; returned: number }>;
    },
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  const copyLogs = async () => {
    if (!data?.logs) return;

    const logText = data.logs
      .map(log => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(logText);
      toast({
        title: "Logs copied!",
        description: `${data.logs.length} log entries copied to clipboard`,
      });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard. Try the download button instead.",
        variant: "destructive",
      });
    }
  };

  const downloadLogs = () => {
    if (!data?.logs) return;

    const logText = data.logs
      .map(log => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `server-logs-${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearLogs = async () => {
    try {
      const response = await apiRequest('DELETE', '/api/logs');
      const result = await response.json();

      toast({
        title: "Logs cleared!",
        description: result.message || `Cleared ${result.cleared} log entries`,
      });

      // Refetch to show empty logs
      refetch();
    } catch (err) {
      toast({
        title: "Clear failed",
        description: "Could not clear logs. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'destructive';
      case 'warn': return 'warning';
      default: return 'default';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Server Logs
            </CardTitle>
            <CardDescription>
              View and download recent server logs for debugging
              {data && ` (showing ${data.returned} of ${data.total} entries)`}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyLogs}
              disabled={!data?.logs || data.logs.length === 0}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadLogs}
              disabled={!data?.logs || data.logs.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearLogs}
              disabled={!data?.logs || data.logs.length === 0}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Filter controls */}
          <div className="flex gap-2 items-center">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Button
              variant={filterLevel === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterLevel('')}
            >
              All
            </Button>
            <Button
              variant={filterLevel === 'info' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterLevel('info')}
            >
              Info
            </Button>
            <Button
              variant={filterLevel === 'warn' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterLevel('warn')}
            >
              Warnings
            </Button>
            <Button
              variant={filterLevel === 'error' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterLevel('error')}
            >
              Errors
            </Button>
          </div>

          {/* Log display */}
          <ScrollArea className="h-[600px] w-full rounded border bg-muted/20 p-4 font-mono text-sm">
            {isLoading ? (
              <div className="text-muted-foreground">Loading logs...</div>
            ) : !data?.logs || data.logs.length === 0 ? (
              <div className="text-muted-foreground">No logs available</div>
            ) : (
              <div className="space-y-1">
                {data.logs.map((log, index) => (
                  <div key={index} className="flex gap-2 items-start hover:bg-muted/50 p-1 rounded">
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant={getLevelColor(log.level)} className="text-xs">
                      {log.level}
                    </Badge>
                    <span className="flex-1 break-all">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
