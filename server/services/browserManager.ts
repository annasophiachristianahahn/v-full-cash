import puppeteer, { Browser, Page, HTTPRequest } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import proxyChain from 'proxy-chain';

puppeteerExtra.use(StealthPlugin());

const log = (message: string, level: string = 'INFO') => {
  console.log(`[${new Date().toISOString()}] [BrowserManager] [${level}] ${message}`);
};

interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

// Permanent proxy sessions - each username gets the same IP forever
// Session ID is deterministic based on username only (no timestamp)
class BrowserManager {
  private browser: Browser | null = null;
  private currentBrowserUser: string | null = null;
  private anonymizedProxyUrl: string | null = null;
  private currentProxyConfig: ProxyConfig | null = null;  // For page.authenticate()
  private isInitializing: boolean = false;
  private initPromise: Promise<Browser> | null = null;
  private taskQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue: boolean = false;
  private activeTaskCount: number = 0;

  // NEW: Hybrid browser lifecycle tracking
  private browserCreatedAt: number = 0;
  private tasksCompleted: number = 0;
  private readonly MAX_BROWSER_AGE_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_TASKS_PER_BROWSER = 25;  // Increased from 10 to reduce browser restarts and save bandwidth

  private readonly launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-plugins',
    '--disable-default-apps',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-software-rasterizer',
    '--window-size=800,600',  // Reduced from 1280x720 to save bandwidth
    '--disable-features=IsolateOrigins,site-per-process',
    // BANDWIDTH OPTIMIZATION: Enable disk cache to reuse static assets
    '--disk-cache-size=104857600',  // 100MB cache
    '--aggressive-cache-discard',
    '--disable-application-cache'  // Disable app cache but keep disk cache for efficiency
  ];

  // Map each Twitter account to a specific US city for consistent geolocation
  // Even if IP changes after 24h, new IP will be from the same city
  private readonly cityAssignments: Record<string, string> = {
    'vajme': 'new_york',
    'dozer': 'los_angeles', 
    'homeless_poetry': 'chicago',
    'expert': 'new_york',  // Moved from miami (tunnel issues) to new_york
    'bingo star': 'houston',
    'default': 'new_york'
  };

  // Timezone mapping for each city to match proxy location
  private readonly timezoneMap: Record<string, string> = {
    'new_york': 'America/New_York',
    'los_angeles': 'America/Los_Angeles',
    'chicago': 'America/Chicago',
    'miami': 'America/New_York',  // Miami uses Eastern time
    'houston': 'America/Chicago',  // Houston uses Central time
    'default': 'America/New_York'
  };

  // Geolocation coordinates for each city
  private readonly geoLocationMap: Record<string, { latitude: number; longitude: number }> = {
    'new_york': { latitude: 40.7128, longitude: -74.0060 },
    'los_angeles': { latitude: 34.0522, longitude: -118.2437 },
    'chicago': { latitude: 41.8781, longitude: -87.6298 },
    'miami': { latitude: 25.7617, longitude: -80.1918 },
    'houston': { latitude: 29.7604, longitude: -95.3698 },
    'default': { latitude: 40.7128, longitude: -74.0060 }
  };

  // Randomized session durations per account (18-24 hours in minutes)
  // Each account rotates at a different time for natural behavior
  private readonly sessionDurations: Record<string, number> = {
    'vajme': 1380,         // 23 hours
    'dozer': 1200,         // 20 hours
    'homeless_poetry': 1320, // 22 hours
    'expert': 1100,        // ~18.5 hours
    'bingo star': 1260,    // 21 hours
    'default': 1440        // 24 hours
  };

  // Session rotation counter - increment to force new session when current one is poisoned
  private sessionRotationCounter: number = 0;

  // Generate a session ID that rotates when tunnel errors occur
  // Includes rotation counter to recover from poisoned sessions
  private getSessionIdForUser(twitterUsername: string): string {
    const sanitized = twitterUsername.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    // Use date + hour for more frequent rotation, plus counter for error recovery
    const now = new Date();
    const dateHour = now.toISOString().slice(0, 13).replace(/[-:T]/g, ''); // YYYYMMDDHH
    return `session_${sanitized}_${dateHour}_r${this.sessionRotationCounter}`;
  }

  // Force a new session ID (call when tunnel errors persist)
  public rotateSession(): void {
    this.sessionRotationCounter++;
    log(`Rotating session counter to ${this.sessionRotationCounter} to recover from poisoned session`);
  }

  // Get assigned city for a Twitter account
  private getCityForUser(twitterUsername: string): string {
    const normalized = twitterUsername.toLowerCase();
    return this.cityAssignments[normalized] || this.cityAssignments['default'];
  }

  // Get session duration for a Twitter account (staggered rotation times)
  private getSessionDuration(twitterUsername: string): number {
    const normalized = twitterUsername.toLowerCase();
    return this.sessionDurations[normalized] || this.sessionDurations['default'];
  }

  // Get timezone for a Twitter account based on their assigned city
  getTimezoneForUser(twitterUsername: string): string {
    const city = this.getCityForUser(twitterUsername);
    return this.timezoneMap[city] || this.timezoneMap['default'];
  }

  // Get geolocation for a Twitter account based on their assigned city
  getGeolocationForUser(twitterUsername: string): { latitude: number; longitude: number } {
    const city = this.getCityForUser(twitterUsername);
    return this.geoLocationMap[city] || this.geoLocationMap['default'];
  }

  private getProxyConfig(twitterUsername?: string): ProxyConfig | null {
    // TEMPORARY: Disable proxy for core functionality testing
    // Set USE_PROXY=true to re-enable
    if (process.env.USE_PROXY !== 'true') {
      log('Proxy disabled (USE_PROXY != true) - running without proxy');
      return null;
    }
    
    const baseUsername = process.env.DECODO_USERNAME;
    const password = process.env.DECODO_PASSWORD;
    
    if (!baseUsername || !password) {
      log('Decodo credentials not configured - running without proxy', 'WARN');
      return null;
    }

    let proxyUsername = baseUsername;
    
    if (twitterUsername) {
      const sessionId = this.getSessionIdForUser(twitterUsername);
      const city = this.getCityForUser(twitterUsername);
      const duration = this.getSessionDuration(twitterUsername);
      // city targeting + staggered session duration = natural rotation at different times
      proxyUsername = `user-${baseUsername}-country-us-city-${city}-session-${sessionId}-sessionduration-${duration}`;
      log(`Using ${city.toUpperCase()} proxy for @${twitterUsername} (${Math.round(duration/60)}h session)`);
    }

    return {
      host: 'gate.decodo.com',
      port: 7000,
      username: proxyUsername,
      password
    };
  }

  private async _createBrowser(twitterUsername?: string): Promise<Browser> {
    log('Launching browser with memory-optimized settings...');
    
    // Close any existing proxy before creating a new one
    if (this.anonymizedProxyUrl) {
      try {
        await proxyChain.closeAnonymizedProxy(this.anonymizedProxyUrl, true);
        log('Closed previous anonymized proxy');
      } catch (e: any) {
        log(`Error closing previous proxy: ${e.message}`, 'WARN');
      }
      this.anonymizedProxyUrl = null;
    }
    
    // Get per-user proxy config
    const proxyConfig = this.getProxyConfig(twitterUsername);
    const args = [...this.launchArgs];
    this.currentProxyConfig = proxyConfig;  // Store for reference
    
    if (proxyConfig) {
      // Use proxy-chain to create an anonymized local proxy
      // This handles authentication transparently
      // URL-encode credentials to handle special characters like + in password
      const encodedUsername = encodeURIComponent(proxyConfig.username);
      const encodedPassword = encodeURIComponent(proxyConfig.password);
      const originalProxyUrl = `http://${encodedUsername}:${encodedPassword}@${proxyConfig.host}:${proxyConfig.port}`;
      log(`Original proxy URL (redacted password): http://${encodedUsername}:***@${proxyConfig.host}:${proxyConfig.port}`);
      try {
        this.anonymizedProxyUrl = await proxyChain.anonymizeProxy(originalProxyUrl);
        args.push(`--proxy-server=${this.anonymizedProxyUrl}`);
        log(`Created local proxy: ${this.anonymizedProxyUrl} (forwarding to Decodo for @${twitterUsername || 'default'})`);

        // Give proxy-chain server time to fully initialize
        await new Promise(r => setTimeout(r, 300));

      } catch (proxyError: any) {
        log(`Failed to create/verify local proxy: ${proxyError.message}`, 'ERROR');
        this.anonymizedProxyUrl = null;
      }
    }

    // Use the original headless config that worked with DMs
    const browser = await puppeteerExtra.launch({
      headless: true,
      args,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      timeout: 60000,
      protocolTimeout: 60000,
      ignoreHTTPSErrors: true,
    });

    this.browser = browser;
    this.currentBrowserUser = twitterUsername || null;
    this.browserCreatedAt = Date.now(); // NEW: Track browser age
    this.tasksCompleted = 0; // NEW: Reset task counter
    log('Browser initialized successfully');

    return browser;
  }

  async getBrowser(twitterUsername?: string): Promise<Browser> {
    // NEW: Check if browser needs restart (hybrid architecture)
    const browserAge = Date.now() - this.browserCreatedAt;
    const needsRestart =
      !this.browser || // No browser exists
      !this.browser.isConnected() || // Browser disconnected
      (twitterUsername && this.currentBrowserUser !== twitterUsername) || // Different user
      browserAge > this.MAX_BROWSER_AGE_MS || // Too old (30 min)
      this.tasksCompleted >= this.MAX_TASKS_PER_BROWSER; // Used too much (10 tasks)

    if (needsRestart) {
      if (this.browser && this.browser.isConnected()) {
        const reason = browserAge > this.MAX_BROWSER_AGE_MS ? 'age limit' :
                      this.tasksCompleted >= this.MAX_TASKS_PER_BROWSER ? 'task limit' :
                      'user switch';
        log(`Restarting browser (reason: ${reason}, age: ${Math.round(browserAge / 1000 / 60)}min, tasks: ${this.tasksCompleted})`);
      }
      await this.close();
    } else if (this.browser) {
      return this.browser; // Reuse existing browser
    }

    return this.initBrowser(twitterUsername);
  }

  private async initBrowser(twitterUsername?: string): Promise<Browser> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = this._createBrowser(twitterUsername);
    
    try {
      const browser = await this.initPromise;
      this.isInitializing = false;
      return browser;
    } catch (error) {
      this.isInitializing = false;
      this.initPromise = null;
      throw error;
    }
  }

  async executeTask<T>(task: (page: Page) => Promise<T>, twitterUsername?: string, maxRetries: number = 2): Promise<T> {
    return new Promise((resolve, reject) => {
      const queuedTask = async () => {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
          let page: Page | null = null;
          let context: any = null;
          
          try {
            // Get browser with proxy configured for this user
            // If user differs from current browser, it will restart with new credentials
            const browser = await this.getBrowser(twitterUsername);
            this.activeTaskCount++;
            
            // Create a fresh incognito context for each task
            log(`Creating browser context for @${twitterUsername || 'default'}... (proxy: ${this.currentProxyConfig ? 'enabled' : 'disabled'})`);
            context = await browser.createBrowserContext();
            const newPage = await context.newPage();
            page = newPage;
            log(`Page created for @${twitterUsername || 'default'} (attempt ${attempt})`);

            await newPage.setUserAgent(
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );
            // Reduce viewport size to minimize rendering data and bandwidth
            await newPage.setViewport({ width: 800, height: 600 });

            // Set timezone to match proxy location for this user
            if (twitterUsername) {
              const timezone = this.getTimezoneForUser(twitterUsername);
              const geolocation = this.getGeolocationForUser(twitterUsername);
              
              await newPage.emulateTimezone(timezone);
              
              // Grant geolocation permissions and set coordinates
              const context = newPage.browserContext();
              await context.overridePermissions('https://x.com', ['geolocation']);
              await context.overridePermissions('https://twitter.com', ['geolocation']);
              await newPage.setGeolocation(geolocation);
              
              log(`Set timezone=${timezone}, geolocation=(${geolocation.latitude}, ${geolocation.longitude}) for @${twitterUsername}`);
            }

            // BANDWIDTH OPTIMIZATION: Block unnecessary resources to reduce proxy usage by 60-80%
            await newPage.setRequestInterception(true);
            newPage.on('request', (req: HTTPRequest) => {
              const resourceType = req.resourceType();
              const url = req.url();

              // Block images, videos, fonts, stylesheets - we only need HTML/JS for automation
              if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
                req.abort();
                return;
              }

              // Block third-party analytics and ads to reduce bandwidth
              const blockedDomains = [
                'google-analytics.com',
                'googletagmanager.com',
                'doubleclick.net',
                'analytics.twitter.com',
                'facebook.com',
                'connect.facebook.net'
              ];

              if (blockedDomains.some(domain => url.includes(domain))) {
                req.abort();
                return;
              }

              req.continue();
            });

            const result = await task(newPage);
            this.tasksCompleted++; // NEW: Track task completion
            resolve(result);
            return; // Exit the retry loop on success
            
          } catch (error: any) {
            lastError = error;
            const isTunnelError = error.message?.includes('ERR_TUNNEL') || 
                                  error.message?.includes('ERR_PROXY');
            const isConnectionClosed = error.message?.includes('Connection closed') ||
                                       error.name === 'ConnectionClosedError';
            const isRetryable = isTunnelError ||
                               isConnectionClosed ||
                               error.message?.includes('net::') ||
                               error.message?.includes('Navigation timeout');
            
            if (isRetryable && attempt <= maxRetries) {
              log(`Attempt ${attempt} failed with retryable error: ${error.message}. Retrying in 5s...`, 'WARN');
              
              // For tunnel errors or connection closed, rotate session and restart browser
              if (isTunnelError || isConnectionClosed) {
                log('Connection/tunnel error detected, rotating session and restarting browser...', 'WARN');
                this.rotateSession(); // Force new proxy session ID to escape poisoned session
                this.tasksCompleted = this.MAX_TASKS_PER_BROWSER; // NEW: Force restart on next task
                try {
                  await this.restart();
                } catch (restartError) {
                  log(`Failed to restart browser: ${restartError}`, 'ERROR');
                }
              }
              
              await new Promise(r => setTimeout(r, 5000));
            } else {
              reject(error);
              return;
            }
          } finally {
            this.activeTaskCount--;
            
            // Close both page and context to clean up resources
            if (page) {
              try {
                page.removeAllListeners();
                await page.close();
              } catch (e) {
                log(`Error closing page: ${e}`, 'WARN');
              }
            }
            if (context) {
              try {
                await context.close();
              } catch (e) {
                log(`Error closing context: ${e}`, 'WARN');
              }
            }
          }
        }
        
        // If we've exhausted all retries
        reject(lastError || new Error('Task failed after all retries'));
      };

      this.taskQueue.push(queuedTask);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    
    this.isProcessingQueue = true;
    
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (task) {
        await task();
      }
    }
    
    this.isProcessingQueue = false;
  }

  async setCookies(page: Page, cookieString: string): Promise<void> {
    // Handle both formats:
    // 1. Simple format: "name1=value1; name2=value2; name3=value3"
    // 2. Set-Cookie format (Option B): "name1=value1; Domain=.x.com; Path=/\nname2=value2; Domain=.x.com; Path=/"
    
    const cookiePairs: Array<{ name: string; value: string }> = [];
    
    // Check if this is Set-Cookie format (contains newlines or "Domain=" or "Path=")
    const isSetCookieFormat = cookieString.includes('\n') || 
                              cookieString.includes('Domain=') || 
                              cookieString.includes('Path=');
    
    if (isSetCookieFormat) {
      // Set-Cookie format: split by newlines, then extract name=value from each line
      const lines = cookieString.split(/[\r\n]+/).filter(line => line.trim());
      
      for (const line of lines) {
        // Each line is like: "name=value; Domain=.x.com; Path=/; Secure; HttpOnly"
        // We only want the first part (name=value)
        const parts = line.split(';');
        if (parts.length > 0) {
          const firstPart = parts[0].trim();
          const equalsIndex = firstPart.indexOf('=');
          if (equalsIndex > 0) {
            const name = firstPart.substring(0, equalsIndex).trim();
            const value = firstPart.substring(equalsIndex + 1).trim();
            
            // Skip attribute-like entries (Domain, Path, Secure, HttpOnly, etc.)
            const attributeNames = ['domain', 'path', 'secure', 'httponly', 'expires', 'max-age', 'samesite'];
            if (!attributeNames.includes(name.toLowerCase()) && value) {
              cookiePairs.push({ name, value });
            }
          }
        }
      }
    } else {
      // Simple format: split by semicolons
      const parts = cookieString.split(';');
      for (const part of parts) {
        const trimmed = part.trim();
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex > 0) {
          const name = trimmed.substring(0, equalsIndex).trim();
          const value = trimmed.substring(equalsIndex + 1).trim();
          
          // Skip attribute-like entries
          const attributeNames = ['domain', 'path', 'secure', 'httponly', 'expires', 'max-age', 'samesite'];
          if (!attributeNames.includes(name.toLowerCase()) && value) {
            cookiePairs.push({ name, value });
          }
        }
      }
    }
    
    // Validate critical cookies
    const cookieNames = cookiePairs.map(c => c.name.toLowerCase());
    const hasAuthToken = cookieNames.includes('auth_token');
    const hasCt0 = cookieNames.includes('ct0');
    
    log(`Parsed ${cookiePairs.length} cookies from ${isSetCookieFormat ? 'Set-Cookie' : 'simple'} format`);
    log(`Critical cookies: auth_token=${hasAuthToken}, ct0=${hasCt0}`);
    
    if (!hasAuthToken) {
      log('WARNING: auth_token cookie is missing - authentication will likely fail!', 'WARN');
    }
    if (!hasCt0) {
      log('WARNING: ct0 cookie is missing - CSRF protection will fail!', 'WARN');
    }
    
    const allCookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Strict' | 'Lax' | 'None';
    }> = [];
    
    for (const domain of ['.twitter.com', '.x.com']) {
      for (const { name, value } of cookiePairs) {
        allCookies.push({ 
          name, 
          value, 
          domain, 
          path: '/', 
          httpOnly: name === 'auth_token',
          secure: true,
          sameSite: 'None' as const
        });
      }
    }
    
    await page.setCookie(...allCookies);
    log(`Set ${allCookies.length} cookies for both .twitter.com and .x.com domains`);
  }

  async close(): Promise<void> {
    if (this.browser) {
      log('Closing browser...');
      await this.browser.close();
      this.browser = null;
      this.initPromise = null;
    }
    // Close the anonymized proxy to free up the port
    if (this.anonymizedProxyUrl) {
      try {
        await proxyChain.closeAnonymizedProxy(this.anonymizedProxyUrl, true);
        log('Closed anonymized proxy');
      } catch (e: any) {
        log(`Error closing proxy: ${e.message}`, 'WARN');
      }
      this.anonymizedProxyUrl = null;
    }
  }

  async restart(twitterUsername?: string): Promise<void> {
    const userToRestart = twitterUsername || this.currentBrowserUser || undefined;
    await this.close();
    await this.initBrowser(userToRestart);
  }

  getStats(): { isConnected: boolean; queueLength: number; activeTaskCount: number } {
    return {
      isConnected: this.browser?.isConnected() || false,
      queueLength: this.taskQueue.length,
      activeTaskCount: this.activeTaskCount
    };
  }
}

export const browserManager = new BrowserManager();
