import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { User } from "lucide-react";

interface UsernameInfo {
  username: string;
  isActive: boolean;
  hasCookie: boolean;
}

interface AccountDropdownProps {
  onUsernameChange?: (username: string) => void;
}

export function AccountDropdown({ onUsernameChange }: AccountDropdownProps) {
  const { toast } = useToast();

  const { data: usernames = [], isLoading } = useQuery<UsernameInfo[]>({
    queryKey: ["/api/twitter-usernames"],
    retry: false,
  });

  const activeUsername = usernames.find(u => u.isActive)?.username || "";

  const setActiveUsernameMutation = useMutation({
    mutationFn: async (username: string) => {
      return await apiRequest("POST", "/api/twitter-usernames/set-active", { username });
    },
    onSuccess: (_, username) => {
      localStorage.setItem("selectedUsername", username);
      queryClient.invalidateQueries({ queryKey: ["/api/twitter-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/twitter-usernames"] });
      onUsernameChange?.(username);
      toast({
        title: "Account Switched",
        description: `Now using: ${username}`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to switch account",
      });
    },
  });

  const handleValueChange = (value: string) => {
    if (value && value !== activeUsername) {
      setActiveUsernameMutation.mutate(value);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <User className="w-4 h-4" />
        Loading...
      </div>
    );
  }

  if (usernames.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <User className="w-4 h-4" />
        No accounts
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Reply Account:</span>
      <Select
        value={activeUsername}
        onValueChange={handleValueChange}
        disabled={setActiveUsernameMutation.isPending}
      >
        <SelectTrigger 
          className="w-[160px] bg-background"
          data-testid="select-account"
        >
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" />
            <SelectValue placeholder="Select account" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {usernames.map((user) => (
            <SelectItem
              key={user.username}
              value={user.username}
              data-testid={`select-item-${user.username}`}
            >
              <div className="flex items-center gap-2">
                <span>{user.username}</span>
                {!user.hasCookie && (
                  <span className="text-xs text-yellow-500">⚠</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
