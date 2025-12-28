import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, Clock, Loader2 } from "lucide-react";
import { ProcessingStep } from "@/lib/types";

interface ProcessingStatusProps {
  steps: ProcessingStep[];
  progress: number;
}

export function ProcessingStatus({ steps, progress }: ProcessingStatusProps) {
  const getStepIcon = (status: ProcessingStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'failed':
        return <CheckCircle className="w-4 h-4 text-destructive" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStepBg = (status: ProcessingStep['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 dark:bg-green-950';
      case 'processing':
        return 'bg-blue-50 dark:bg-blue-950';
      case 'failed':
        return 'bg-red-50 dark:bg-red-950';
      default:
        return 'bg-muted/30';
    }
  };

  return (
    <Card className="mb-8" data-testid="processing-status">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Processing Status</CardTitle>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
            <span className="text-sm text-muted-foreground">Analyzing tweets</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-6">
          {steps.map((step) => (
            <div 
              key={step.id} 
              className={`flex items-center space-x-3 p-3 rounded-lg ${getStepBg(step.status)}`}
              data-testid={`step-${step.id}`}
            >
              <div className="flex-shrink-0">
                {getStepIcon(step.status)}
              </div>
              <div className="flex-grow">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" data-testid={`step-title-${step.id}`}>
                    {step.title}
                  </span>
                  {step.timestamp && (
                    <span className="text-xs text-muted-foreground" data-testid={`step-timestamp-${step.id}`}>
                      {step.timestamp}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground" data-testid={`step-description-${step.id}`}>
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Progress Bar */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-muted-foreground" data-testid="progress-percentage">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2" data-testid="progress-bar" />
        </div>
      </CardContent>
    </Card>
  );
}
