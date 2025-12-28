import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle, Terminal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface LogMessage {
  timestamp: string;
  level: "INFO" | "DEBUG" | "WARN" | "ERROR";
  message: string;
  sessionId: string;
}

const LOG_COLORS = {
  INFO: "#4caf50",
  DEBUG: "#999",
  WARN: "#ff9800",
  ERROR: "#f44336",
};

export function LogViewer() {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [allDmsSent, setAllDmsSent] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Connect to SSE endpoint via backend proxy to avoid CORS issues
    const eventSource = new EventSource("/api/dm-logs");
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const logMessage: LogMessage = JSON.parse(event.data);
        
        setLogs((prev) => [...prev, logMessage]);

        // Check for completion message (case-insensitive, flexible matching)
        const message = logMessage.message.toUpperCase();
        if (
          message.includes("ALL REPLIES SENT AS DMS") ||
          message.includes("ALL DMS SENT") ||
          message.includes("ALL REPLIES SENT")
        ) {
          setAllDmsSent(true);
          // Reset after 5 seconds
          setTimeout(() => setAllDmsSent(false), 5000);
        }
      } catch (error) {
        console.error("Error parsing log message:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      setConnectionError(true);
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Card className="w-full" data-testid="log-viewer">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="w-4 h-4" />
          DM API Logs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {allDmsSent && (
          <Alert className="bg-green-500/10 border-green-500/20" data-testid="alert-dms-complete">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-green-500 font-medium">
              ✅ All DMs Sent!
            </AlertDescription>
          </Alert>
        )}
        
        {connectionError && (
          <Alert variant="destructive" data-testid="alert-connection-error">
            <AlertDescription>
              Unable to connect to log stream. Logs may not be displayed in real-time.
            </AlertDescription>
          </Alert>
        )}

        <div
          ref={scrollRef}
          className="bg-[#1e1e1e] text-white rounded-md p-4 font-mono text-xs overflow-y-auto"
          style={{ maxHeight: "400px" }}
          data-testid="logs-container"
        >
          {logs.length === 0 ? (
            <div className="text-gray-500" data-testid="text-no-logs">
              Waiting for logs...
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={`${log.timestamp}-${index}`}
                className="mb-1"
                data-testid={`log-entry-${index}`}
              >
                <span style={{ color: LOG_COLORS[log.level] }}>
                  [{log.level}]
                </span>{" "}
                {log.message}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
