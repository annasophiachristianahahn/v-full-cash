import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

const GROUP_CHAT_ID = '1969047827406831927'; // vaj prefecture big new sky

// Utility functions
const randomDelay = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const humanTypeText = async (
  page: Page,
  selector: string,
  text: string,
  minDelay = 50,
  maxDelay = 150
): Promise<void> => {
  await page.click(selector);
  await sleep(randomDelay(200, 500));
  for (const char of text) {
    await page.keyboard.type(char);
    await sleep(randomDelay(minDelay, maxDelay));
  }
};

const waitForSelectorSafe = async (
  page: Page,
  selector: string,
  timeout = 10000
): Promise<boolean> => {
  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    return true;
  } catch (error) {
    return false;
  }
};

const setCookies = async (page: Page, cookieString: string): Promise<void> => {
  const cookiePairs = cookieString.split(';').map(cookie => {
    const [name, ...valueParts] = cookie.trim().split('=');
    const value = valueParts.join('=');
    return { name: name.trim(), value: value.trim() };
  });

  const domains = ['.twitter.com', '.x.com'];
  const allCookies = [];

  for (const domain of domains) {
    for (const { name, value } of cookiePairs) {
      allCookies.push({
        name,
        value,
        domain,
        path: '/',
        httpOnly: false,
        secure: true
      });
    }
  }

  await page.setCookie(...allCookies);
};

async function sendSingleDM(
  page: Page,
  message: string,
  options: {
    usePaste?: boolean;
    minActionDelay?: number;
    maxActionDelay?: number;
    skipNavigation?: boolean; // If already on messages page
  } = {}
): Promise<void> {
  const {
    usePaste = true, // Default to paste for URLs (natural behavior)
    minActionDelay = 1,
    maxActionDelay = 2,
    skipNavigation = false
  } = options;

  // Only navigate if not already on the page
  if (!skipNavigation) {
    const messagesUrl = `https://x.com/messages/${GROUP_CHAT_ID}`;
    await page.goto(messagesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomDelay(1500, 2500));
  }

  const messageInputSelectors = [
    'div[data-testid="dmComposerTextInput"]',
    'div[data-testid="tweetTextarea_0"]',
    'div.DraftEditor-root',
    'div[contenteditable="true"][role="textbox"]'
  ];

  let usedSelector: string | null = null;
  for (const selector of messageInputSelectors) {
    if (await waitForSelectorSafe(page, selector, 5000)) {
      usedSelector = selector;
      break;
    }
  }

  if (!usedSelector) {
    throw new Error('Could not find message input field');
  }

  await sleep(randomDelay(minActionDelay * 1000, maxActionDelay * 1000));

  // Use paste for URLs (natural human behavior) or type for custom messages
  if (usePaste) {
    await page.click(usedSelector);
    await sleep(randomDelay(200, 500));
    // Simulate paste: Ctrl+V on Windows/Linux, Cmd+V on Mac
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Control');
    // Actually insert the text via clipboard
    await page.evaluate((selector, text) => {
      const el = document.querySelector(selector);
      if (el) {
        (el as HTMLElement).focus();
        document.execCommand('insertText', false, text);
      }
    }, usedSelector, message);
    await sleep(randomDelay(500, 1000));
  } else {
    await humanTypeText(page, usedSelector, message, 50, 150);
  }

  // Shorter wait after paste - Twitter detects paste faster than typing
  await sleep(randomDelay(1500, 2500));

  const sendButtonSelectors = [
    'button[data-testid="dmComposerSendButton"]',
    'div[data-testid="dmComposerSendButton"]',
    'button[type="button"][aria-label*="Send"]'
  ];

  let sendSelector: string | null = null;
  let attempts = 0;
  const maxAttempts = 5;

  // Try multiple times to find enabled send button (Twitter may need time to enable it)
  while (!sendSelector && attempts < maxAttempts) {
    for (const selector of sendButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          const isEnabled = await page.evaluate(
            (el: Element) => !(el as HTMLButtonElement).disabled && !el.getAttribute('aria-disabled'),
            button
          );
          if (isEnabled) {
            sendSelector = selector;
            console.log(`📤 [PuppeteerDM] Found enabled send button: ${selector}`);
            break;
          }
        }
      } catch (err) {
        continue;
      }
    }

    if (!sendSelector) {
      attempts++;
      if (attempts < maxAttempts) {
        console.log(`📤 [PuppeteerDM] Send button not enabled yet, waiting... (attempt ${attempts}/${maxAttempts})`);
        await sleep(2000);
      }
    }
  }

  if (!sendSelector) {
    throw new Error('Could not find enabled send button after multiple attempts');
  }

  await page.click(sendSelector);
  await sleep(randomDelay(500, 1000)); // Reduced - just confirm click registered
}

export interface SendDMParams {
  message: string;
  twitterCookie: string;
  username: string;
  proxy?: string; // IMPORTANT: Use the same proxy that was used for the reply
}

export interface SendDMResult {
  success: boolean;
  error?: string;
  timestamp: string;
}

/**
 * Send a Twitter DM using Puppeteer with proxy support
 */
export async function sendTwitterDM(params: SendDMParams): Promise<SendDMResult> {
  const { message, twitterCookie, username, proxy } = params;

  let browser: Browser | null = null;

  try {
    console.log(`📤 [PuppeteerDM] Sending DM from @${username}`);
    console.log(`📤 [PuppeteerDM] Message: ${message}`);
    if (proxy) {
      console.log(`📤 [PuppeteerDM] Using proxy: ${proxy.substring(0, 30)}...`);
    }

    const launchOptions: any = {
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled'
      ]
    };

    // Add proxy if provided
    if (proxy) {
      // Extract host:port from proxy URL (format: http://user:pass@host:port)
      const proxyHostMatch = proxy.match(/@([^:]+):(\d+)/);
      if (proxyHostMatch) {
        const [, host, port] = proxyHostMatch;
        launchOptions.args.push(`--proxy-server=${host}:${port}`);
      } else {
        // Fallback: use proxy as-is if format doesn't match
        launchOptions.args.push(`--proxy-server=${proxy}`);
      }
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // Handle proxy authentication if proxy is provided
    if (proxy) {
      // Extract credentials from proxy URL (format: http://user:pass@host:port)
      const proxyMatch = proxy.match(/http:\/\/([^:]+):([^@]+)@/);
      if (proxyMatch) {
        const [, proxyUsername, proxyPassword] = proxyMatch;
        await page.authenticate({
          username: proxyUsername,
          password: proxyPassword
        });
        console.log('📤 [PuppeteerDM] Proxy authentication configured');
      }
    }

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    // Set cookies before navigating (faster than reload)
    console.log('📤 [PuppeteerDM] Setting up authentication');
    await setCookies(page, twitterCookie);

    // Go directly to messages (skip home page)
    console.log('📤 [PuppeteerDM] Navigating to messages');
    const messagesUrl = `https://x.com/messages/${GROUP_CHAT_ID}`;
    await page.goto(messagesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomDelay(1000, 2000));

    // Check authentication
    const loggedInIndicators = [
      'a[data-testid="AppTabBar_Home_Link"]',
      'a[aria-label="Home"]',
      'nav[aria-label="Primary"]'
    ];

    let isLoggedIn = false;
    for (const selector of loggedInIndicators) {
      if (await page.$(selector) !== null) {
        isLoggedIn = true;
        break;
      }
    }

    if (!isLoggedIn) {
      throw new Error('Cookie authentication failed - cookies may be expired or invalid');
    }

    console.log('✅ [PuppeteerDM] Successfully authenticated');

    // Send the DM - use paste for URL (natural behavior), skip navigation since we're already there
    await sendSingleDM(page, message, {
      usePaste: true,
      minActionDelay: 1,
      maxActionDelay: 2,
      skipNavigation: true // Already navigated above
    });

    console.log(`✅ [PuppeteerDM] DM sent successfully from @${username}`);

    return {
      success: true,
      timestamp: new Date().toISOString()
    };

  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [PuppeteerDM] Error sending DM from @${username}: ${errorMessage}`);

    return {
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString()
    };

  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
