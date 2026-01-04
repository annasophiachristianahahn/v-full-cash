import { Page } from 'puppeteer';
import { browserManager } from './browserManager';

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
    await sleep(randomDelay(1000, 1500));
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
    await sleep(randomDelay(150, 300));
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
    await sleep(randomDelay(300, 600));
  } else {
    await humanTypeText(page, usedSelector, message, 50, 150);
  }

  // Shorter wait after paste - Twitter detects paste faster than typing
  await sleep(randomDelay(800, 1500));

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
        await sleep(1500);
      }
    }
  }

  if (!sendSelector) {
    throw new Error('Could not find enabled send button after multiple attempts');
  }

  await page.click(sendSelector);
  await sleep(randomDelay(300, 600)); // Reduced - just confirm click registered
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
 * Send a Twitter DM using the shared browserManager (much faster than launching new browser)
 */
export async function sendTwitterDM(params: SendDMParams): Promise<SendDMResult> {
  const { message, twitterCookie, username } = params;

  try {
    console.log(`📤 [PuppeteerDM] Sending DM from @${username} (using shared browser)`);
    console.log(`📤 [PuppeteerDM] Message: ${message}`);

    // Use browserManager's executeTask which handles browser lifecycle, proxy, and cookies
    const result = await browserManager.executeTask(async (page: Page) => {
      // Set cookies for this user
      await browserManager.setCookies(page, twitterCookie);

      // Go directly to messages
      console.log('📤 [PuppeteerDM] Navigating to messages');
      const messagesUrl = `https://x.com/messages/${GROUP_CHAT_ID}`;
      await page.goto(messagesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(randomDelay(800, 1200));

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
        minActionDelay: 0.5,
        maxActionDelay: 1,
        skipNavigation: true // Already navigated above
      });

      return { success: true };
    }, username); // Pass username so browserManager uses correct proxy

    console.log(`✅ [PuppeteerDM] DM sent successfully from @${username}`);

    return {
      success: result.success,
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
  }
}
