import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Cookie, Shield, CheckCircle, AlertTriangle, Chrome, Code, Settings, Users, Plus, Trash2, Check, X, Shuffle } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const twitterSettingsSchema = z.object({
  twitterCookie: z.string().min(10, "Twitter session cookie is required"),
});

type TwitterSettingsForm = z.infer<typeof twitterSettingsSchema>;

interface TwitterSettingsDialogProps {
  children?: React.ReactNode;
}

export function TwitterSettingsDialog({ children }: TwitterSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [hasExistingSettings, setHasExistingSettings] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newCookie, setNewCookie] = useState("");
  const [selectedUsername, setSelectedUsername] = useState<string>("");
  const { toast } = useToast();

  // Fetch all usernames
  const { data: usernames = [] } = useQuery<Array<{ username: string; isActive: boolean; hasCookie: boolean; isAvailableForRandom: boolean }>>({
    queryKey: ['/api/twitter-usernames'],
    enabled: open,
  });

  const form = useForm<TwitterSettingsForm>({
    resolver: zodResolver(twitterSettingsSchema),
    defaultValues: {
      twitterCookie: "",
    },
  });

  // Create new username mutation
  const createUsernameMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/twitter-usernames/create", {
        username: newUsername,
        twitterCookie: newCookie || null,
      });
    },
    onSuccess: () => {
      toast({
        title: "Username Created",
        description: `Username "${newUsername}" has been added.`,
      });
      setNewUsername("");
      setNewCookie("");
      queryClient.invalidateQueries({ queryKey: ['/api/twitter-usernames'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create username",
        variant: "destructive",
      });
    },
  });

  // Delete username mutation
  const deleteUsernameMutation = useMutation({
    mutationFn: async (username: string) => {
      return await apiRequest("DELETE", `/api/twitter-usernames/${username}`, {});
    },
    onSuccess: () => {
      toast({
        title: "Username Deleted",
        description: "Username has been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/twitter-usernames'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete username",
        variant: "destructive",
      });
    },
  });

  // Update username cookie mutation
  const updateCookieMutation = useMutation({
    mutationFn: async ({ username, cookie }: { username: string; cookie: string }) => {
      return await apiRequest("PATCH", `/api/twitter-usernames/${username}`, {
        twitterCookie: cookie,
      });
    },
    onSuccess: () => {
      toast({
        title: "Cookie Updated",
        description: "Cookie has been updated successfully.",
      });
      setSelectedUsername("");
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/twitter-usernames'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update cookie",
        variant: "destructive",
      });
    },
  });

  // Toggle availability for random selection mutation
  const toggleAvailabilityMutation = useMutation({
    mutationFn: async ({ username, isAvailableForRandom }: { username: string; isAvailableForRandom: boolean }) => {
      return await apiRequest("PATCH", `/api/twitter-usernames/${username}/availability`, {
        isAvailableForRandom,
      });
    },
    onSuccess: (_, variables) => {
      toast({
        title: "Availability Updated",
        description: `${variables.username} is now ${variables.isAvailableForRandom ? 'available' : 'unavailable'} for random selection.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/twitter-usernames'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update availability",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (open && usernames.length > 0 && !selectedUsername) {
      const activeUser = usernames.find((u: any) => u.isActive);
      if (activeUser) {
        setSelectedUsername(activeUser.username);
      }
    }
  }, [open, usernames, selectedUsername]);

  const onSubmit = async (values: TwitterSettingsForm) => {
    if (!selectedUsername) {
      toast({
        title: "Error",
        description: "Please select a username to update",
        variant: "destructive",
      });
      return;
    }

    updateCookieMutation.mutate({
      username: selectedUsername,
      cookie: values.twitterCookie,
    });
  };

  const handleCreateUsername = () => {
    if (!newUsername.trim()) {
      toast({
        title: "Error",
        description: "Username cannot be empty",
        variant: "destructive",
      });
      return;
    }
    createUsernameMutation.mutate();
  };

  const handleDeleteUsername = (username: string) => {
    deleteUsernameMutation.mutate(username);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm" data-testid="button-twitter-settings">
            <Settings className="w-4 h-4 mr-2" />
            Twitter Settings
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="w-6 h-6" />
            Twitter Settings
          </DialogTitle>
          <DialogDescription>
            Configure your Twitter session cookie for automated reply posting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Username Management Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Manage Usernames
              </CardTitle>
              <CardDescription>
                Add, remove, or update cookies for different Twitter accounts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing Usernames List */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Current Accounts</div>
                <div className="grid gap-2">
                  {usernames.map((user) => (
                    <div
                      key={user.username}
                      className="flex items-center justify-between p-3 border rounded-lg"
                      data-testid={`username-item-${user.username}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="font-mono text-sm font-medium">@{user.username}</div>
                        {user.isActive && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                            Active
                          </span>
                        )}
                        {user.hasCookie ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <X className="w-4 h-4 text-red-600" />
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Availability toggle for random selection */}
                        <div className="flex items-center gap-2">
                          <Shuffle className={`w-4 h-4 ${user.isAvailableForRandom ? 'text-green-600' : 'text-muted-foreground'}`} />
                          <Switch
                            checked={user.isAvailableForRandom}
                            onCheckedChange={(checked) => {
                              toggleAvailabilityMutation.mutate({
                                username: user.username,
                                isAvailableForRandom: checked,
                              });
                            }}
                            disabled={toggleAvailabilityMutation.isPending}
                            data-testid={`switch-availability-${user.username}`}
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {user.isAvailableForRandom ? 'Available' : 'Unavailable'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUsername(user.username);
                              form.setValue("twitterCookie", "");
                            }}
                            data-testid={`button-edit-${user.username}`}
                          >
                            Update Cookie
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteUsername(user.username)}
                            disabled={user.isActive || deleteUsernameMutation.isPending}
                            data-testid={`button-delete-${user.username}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add New Username */}
              <div className="pt-4 border-t space-y-3">
                <div className="text-sm font-medium">Add New Account</div>
                <div className="grid gap-3">
                  <div>
                    <Input
                      placeholder="Username (e.g., johnny)"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      data-testid="input-new-username"
                    />
                  </div>
                  <div>
                    <Textarea
                      placeholder="Twitter auth_token cookie (optional - can add later)"
                      value={newCookie}
                      onChange={(e) => setNewCookie(e.target.value)}
                      className="min-h-[80px] font-mono text-xs"
                      data-testid="input-new-cookie"
                    />
                  </div>
                  <Button
                    onClick={handleCreateUsername}
                    disabled={!newUsername.trim() || createUsernameMutation.isPending}
                    className="w-full"
                    data-testid="button-create-username"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {createUsernameMutation.isPending ? "Creating..." : "Add Username"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cookie Update Section */}
          {selectedUsername && (
            <Card data-testid="twitter-settings-form">
              <CardHeader>
                <CardTitle className="text-base">Update Cookie for @{selectedUsername}</CardTitle>
                <CardDescription className="text-xs">
                  Paste the Twitter auth_token cookie value
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="twitterCookie"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>auth_token Cookie</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Paste cookie value here..."
                              className="min-h-[100px] font-mono text-xs"
                              data-testid="input-twitter-cookie"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            This cookie allows the app to post replies on your behalf
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      disabled={updateCookieMutation.isPending}
                      data-testid="button-save-settings"
                      className="w-full"
                    >
                      {updateCookieMutation.isPending ? "Updating..." : "Update Cookie"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">How to Retrieve Your Cookie</CardTitle>
            </CardHeader>
              <CardContent>
                <Tabs defaultValue="extension" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="extension" className="text-xs">
                      <Chrome className="w-3 h-3 mr-1" />
                      Extension
                    </TabsTrigger>
                    <TabsTrigger value="devtools" className="text-xs">
                      <Code className="w-3 h-3 mr-1" />
                      Dev Tools
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="extension" className="space-y-3 mt-4">
                    <Alert>
                      <Chrome className="h-4 w-4" />
                      <AlertTitle className="text-sm">Method 1: Cookie-Editor (Easiest)</AlertTitle>
                    </Alert>
                    
                    <div className="space-y-2 text-xs">
                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">1</div>
                        <div>
                          <p className="font-medium">Install Extension</p>
                          <p className="text-muted-foreground">
                            Add{" "}
                            <a href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                              Cookie-Editor
                            </a>
                            {" "}from Chrome Web Store
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">2</div>
                        <div>
                          <p className="font-medium">Open Twitter/X</p>
                          <p className="text-muted-foreground">Go to <a href="https://x.com" target="_blank" className="text-primary underline">x.com</a> (logged in)</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">3</div>
                        <div>
                          <p className="font-medium">Click Extension Icon</p>
                          <p className="text-muted-foreground">Click Cookie-Editor icon (🍪) in toolbar</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">4</div>
                        <div>
                          <p className="font-medium">Find auth_token</p>
                          <p className="text-muted-foreground">Search for "auth_token", click value to copy</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">5</div>
                        <div>
                          <p className="font-medium">Paste & Save</p>
                          <p className="text-muted-foreground">Paste into form and click "Save Cookie"</p>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="devtools" className="space-y-3 mt-4">
                    <Alert>
                      <Code className="h-4 w-4" />
                      <AlertTitle className="text-sm">Method 2: Browser Developer Tools</AlertTitle>
                    </Alert>
                    
                    <div className="space-y-2 text-xs">
                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">1</div>
                        <div>
                          <p className="font-medium">Open Twitter/X</p>
                          <p className="text-muted-foreground">Go to <a href="https://x.com" target="_blank" className="text-primary underline">x.com</a> (logged in)</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">2</div>
                        <div>
                          <p className="font-medium">Open DevTools</p>
                          <p className="text-muted-foreground">
                            Press <kbd className="px-1 py-0.5 bg-muted rounded text-xs">F12</kbd> or{" "}
                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+Shift+I</kbd>
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">3</div>
                        <div>
                          <p className="font-medium">Application Tab</p>
                          <p className="text-muted-foreground">Click "Application" tab (or "Storage" in Firefox)</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">4</div>
                        <div>
                          <p className="font-medium">Navigate to Cookies</p>
                          <p className="text-muted-foreground">Storage → Cookies → https://x.com</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">5</div>
                        <div>
                          <p className="font-medium">Find auth_token</p>
                          <p className="text-muted-foreground">Look for cookie named "auth_token"</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">6</div>
                        <div>
                          <p className="font-medium">Copy Value</p>
                          <p className="text-muted-foreground">
                            Double-click Value field, <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+A</kbd> then{" "}
                            <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Ctrl+C</kbd>
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">7</div>
                        <div>
                          <p className="font-medium">Paste & Save</p>
                          <p className="text-muted-foreground">Paste into form and click "Save Cookie"</p>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
    </Dialog>
  );
}
