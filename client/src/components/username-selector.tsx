import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UsernameInfo {
  username: string;
  isActive: boolean;
  hasCookie: boolean;
}

export function UsernameSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string>("");
  const { toast } = useToast();

  // Fetch all usernames
  const { data: usernames = [], isLoading } = useQuery<UsernameInfo[]>({
    queryKey: ["/api/twitter-usernames"],
    retry: false,
  });

  // Set active username mutation
  const setActiveUsernameMutation = useMutation({
    mutationFn: async (username: string) => {
      return await apiRequest("POST", "/api/twitter-usernames/set-active", { username });
    },
    onSuccess: (_, username) => {
      localStorage.setItem("selectedUsername", username);
      queryClient.invalidateQueries({ queryKey: ["/api/twitter-settings"] });
      toast({
        title: "Username Selected",
        description: `Now using: ${username}`,
      });
      setIsOpen(false);
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to set active username",
      });
    },
  });

  // Show username selector on every page load
  useEffect(() => {
    if (!isLoading && usernames.length > 0) {
      const activeUsername = usernames.find(u => u.isActive);
      setIsOpen(true);
      setSelectedUsername(activeUsername?.username || usernames[0].username);
    }
  }, [usernames, isLoading]);

  const handleConfirm = () => {
    if (selectedUsername) {
      setActiveUsernameMutation.mutate(selectedUsername);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-username-selector">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">Select Username</DialogTitle>
          <DialogDescription data-testid="text-dialog-description">
            Choose which Twitter account you want to use
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <RadioGroup
            value={selectedUsername}
            onValueChange={setSelectedUsername}
            data-testid="radiogroup-username"
          >
            {usernames.map((user) => (
              <div
                key={user.username}
                className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent cursor-pointer"
                onClick={() => setSelectedUsername(user.username)}
                data-testid={`radio-username-${user.username}`}
              >
                <RadioGroupItem
                  value={user.username}
                  id={user.username}
                  data-testid={`radioitem-${user.username}`}
                />
                <Label
                  htmlFor={user.username}
                  className="flex-1 cursor-pointer"
                  data-testid={`label-${user.username}`}
                >
                  <div className="font-medium">{user.username}</div>
                  <div className="text-sm text-muted-foreground">
                    {user.hasCookie ? "✓ Cookie configured" : "⚠ No cookie"}
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>

          <Button
            onClick={handleConfirm}
            disabled={!selectedUsername || setActiveUsernameMutation.isPending}
            className="w-full"
            data-testid="button-confirm-username"
          >
            {setActiveUsernameMutation.isPending ? "Switching..." : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
