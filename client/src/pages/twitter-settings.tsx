import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { Cookie, Shield, CheckCircle, AlertTriangle, Chrome, Code } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const twitterSettingsSchema = z.object({
  twitterCookie: z.string().min(10, "Twitter session cookie is required"),
});

type TwitterSettingsForm = z.infer<typeof twitterSettingsSchema>;

export function TwitterSettingsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [hasExistingSettings, setHasExistingSettings] = useState(false);
  const { toast } = useToast();

  const form = useForm<TwitterSettingsForm>({
    resolver: zodResolver(twitterSettingsSchema),
    defaultValues: {
      twitterCookie: "",
    },
  });

  useEffect(() => {
    // Load existing settings
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/twitter-settings");
        if (response.ok) {
          const data = await response.json();
          if (data && data.twitterCookie) {
            form.setValue("twitterCookie", data.twitterCookie);
            setHasExistingSettings(true);
            setConnectionStatus("success");
          }
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      }
    };
    loadSettings();
  }, [form]);

  const onSubmit = async (values: TwitterSettingsForm) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/twitter-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save Twitter settings");
      }

      toast({
        title: "Settings Saved",
        description: "Twitter cookie has been configured successfully.",
      });

      setConnectionStatus("success");
      setHasExistingSettings(true);
    } catch (error) {
      console.error("Error saving Twitter settings:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save Twitter settings. Please try again.",
        variant: "destructive",
      });
      setConnectionStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Cookie className="w-8 h-8" />
          Twitter Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure your Twitter session cookie for automated reply posting
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Settings Form */}
        <div className="space-y-6">
          <Card data-testid="twitter-settings-form">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cookie className="w-5 h-5" />
                Session Cookie
              </CardTitle>
              <CardDescription>
                Paste your Twitter auth_token cookie value below
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
                        <FormLabel>Twitter auth_token Cookie</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Paste your auth_token cookie value here..."
                            className="min-h-[120px] font-mono text-sm"
                            data-testid="input-twitter-cookie"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          This cookie allows the app to post replies on your behalf
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    disabled={isLoading}
                    data-testid="button-save-settings"
                    className="w-full"
                  >
                    {isLoading ? "Saving..." : hasExistingSettings ? "Update Cookie" : "Save Cookie"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Connection Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {connectionStatus === "idle" && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <div className="w-3 h-3 rounded-full bg-gray-300" />
                  No cookie configured
                </div>
              )}
              {connectionStatus === "success" && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  Cookie configured successfully
                </div>
              )}
              {connectionStatus === "error" && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  Failed to save cookie
                </div>
              )}
            </CardContent>
          </Card>

          {/* Security Notice */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Cookie Lifetime
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  <strong>Good news!</strong> Twitter session cookies don't expire automatically. 
                  You only need to update it if you log out from Twitter, change your password, 
                  or clear browser cookies. Once set, it can work for months!
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>

        {/* Instructions Panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>How to Retrieve Your Cookie</CardTitle>
              <CardDescription>
                Choose your preferred method below
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="extension" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="extension" className="flex items-center gap-2">
                    <Chrome className="w-4 h-4" />
                    Extension
                  </TabsTrigger>
                  <TabsTrigger value="devtools" className="flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    Dev Tools
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="extension" className="space-y-4 mt-4">
                  <Alert>
                    <Chrome className="h-4 w-4" />
                    <AlertTitle>Method 1: Cookie-Editor Extension (Easiest)</AlertTitle>
                  </Alert>
                  
                  <div className="space-y-3 text-sm">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        1
                      </div>
                      <div>
                        <p className="font-medium">Install Cookie-Editor Extension</p>
                        <p className="text-muted-foreground mt-1">
                          Add the{" "}
                          <a
                            href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline"
                          >
                            Cookie-Editor
                          </a>
                          {" "}extension from the Chrome Web Store
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        2
                      </div>
                      <div>
                        <p className="font-medium">Open Twitter/X</p>
                        <p className="text-muted-foreground mt-1">
                          Go to{" "}
                          <a
                            href="https://x.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline"
                          >
                            x.com
                          </a>
                          {" "}and make sure you're logged in
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        3
                      </div>
                      <div>
                        <p className="font-medium">Click the Extension Icon</p>
                        <p className="text-muted-foreground mt-1">
                          Click the Cookie-Editor icon in your browser toolbar (looks like a cookie 🍪)
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        4
                      </div>
                      <div>
                        <p className="font-medium">Find auth_token Cookie</p>
                        <p className="text-muted-foreground mt-1">
                          Search for "auth_token" in the cookie list, then click the value to copy it
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        5
                      </div>
                      <div>
                        <p className="font-medium">Paste Into Form</p>
                        <p className="text-muted-foreground mt-1">
                          Paste the cookie value into the textarea above and click "Save Cookie"
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="devtools" className="space-y-4 mt-4">
                  <Alert>
                    <Code className="h-4 w-4" />
                    <AlertTitle>Method 2: Browser Developer Tools</AlertTitle>
                  </Alert>
                  
                  <div className="space-y-3 text-sm">
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        1
                      </div>
                      <div>
                        <p className="font-medium">Open Twitter/X</p>
                        <p className="text-muted-foreground mt-1">
                          Go to{" "}
                          <a
                            href="https://x.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline"
                          >
                            x.com
                          </a>
                          {" "}and make sure you're logged in
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        2
                      </div>
                      <div>
                        <p className="font-medium">Open Developer Tools</p>
                        <p className="text-muted-foreground mt-1">
                          Press <kbd className="px-2 py-1 bg-muted rounded">F12</kbd> or{" "}
                          <kbd className="px-2 py-1 bg-muted rounded">Ctrl+Shift+I</kbd> (Windows/Linux) or{" "}
                          <kbd className="px-2 py-1 bg-muted rounded">Cmd+Option+I</kbd> (Mac)
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        3
                      </div>
                      <div>
                        <p className="font-medium">Go to Application Tab</p>
                        <p className="text-muted-foreground mt-1">
                          Click the "Application" tab in DevTools (or "Storage" in Firefox)
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        4
                      </div>
                      <div>
                        <p className="font-medium">Navigate to Cookies</p>
                        <p className="text-muted-foreground mt-1">
                          In the left sidebar: Storage → Cookies → https://x.com
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        5
                      </div>
                      <div>
                        <p className="font-medium">Find auth_token</p>
                        <p className="text-muted-foreground mt-1">
                          Look for the cookie named "auth_token" in the list
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        6
                      </div>
                      <div>
                        <p className="font-medium">Copy the Value</p>
                        <p className="text-muted-foreground mt-1">
                          Double-click the "Value" field, press{" "}
                          <kbd className="px-2 py-1 bg-muted rounded">Ctrl+A</kbd> to select all, then{" "}
                          <kbd className="px-2 py-1 bg-muted rounded">Ctrl+C</kbd> to copy
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        7
                      </div>
                      <div>
                        <p className="font-medium">Paste Into Form</p>
                        <p className="text-muted-foreground mt-1">
                          Paste the cookie value into the textarea above and click "Save Cookie"
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
