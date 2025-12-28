import { Page } from 'puppeteer';
import { browserManager } from './browserManager';
import { 
  typeLikeHuman, 
  typeDirectlyLikeHuman,
  humanizedClick, 
  humanizedClickElement,
  preInteractionRoutine, 
  smoothScroll,
  randomMouseWander,
  humanPause,
  randomDelay,
  sleep 
} from '../utils/humanBehavior';

const log = (message: string, level: string = 'INFO') => {
  console.log(`[${new Date().toISOString()}] [TwitterAutomation] [${level}] ${message}`);
};

// ============================================================================
// ADAPTIVE SELECTOR SYSTEM
// Uses multiple strategies to find UI elements across Twitter's A/B tests
// ============================================================================

interface ElementFinderResult {
  element: any;
  selector: string;
  strategy: string;
}

interface ElementState {
  exists: boolean;
  visible: boolean;
  enabled: boolean;
  inViewport: boolean;
  obscured: boolean;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

// Comprehensive selectors for each UI element - ordered by reliability
const SELECTORS = {
  // Reply button on a tweet - try testid first, then ARIA, then structure
  replyButton: [
    '[data-testid="reply"]',
    'div[data-testid="reply"]',
    'button[data-testid="reply"]',
    '[aria-label*="Reply"]',
    '[aria-label*="reply"]',
    'div[role="button"][aria-label*="repl" i]'
  ],
  
  // Reply text input - compose box
  replyInput: [
    'div[data-testid="tweetTextarea_0"]',
    'div[data-testid="tweetTextarea_0RichTextInputContainer"]',
    '[data-testid="tweetTextarea_0"] [contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    '[aria-label="Post text"]',
    '[aria-label="Tweet text"]',
    '[aria-label*="Post your reply"]',
    '[aria-label*="What\'s happening"]',
    'div[role="textbox"][contenteditable="true"]'
  ],
  
  // Send/Post button - ORDER MATTERS: Most specific first
  sendButton: [
    'button[data-testid="tweetButton"]',        // Modal reply button (HIGHEST PRIORITY)
    '[data-testid="tweetButton"]',              // Modal reply (any element)
    'button[data-testid="tweetButtonInline"]',  // Inline reply button (fallback only)
    '[data-testid="tweetButtonInline"]',        // Inline reply (any element - fallback only)
    // NOTE: Removed aria-label selectors - they match too broadly and find wrong buttons
  ],
  
  // Like button
  likeButton: [
    'button[data-testid="like"]',
    '[data-testid="like"]',
    'div[data-testid="like"]',
    '[aria-label*="Like"]'
  ],
  
  // Authentication indicators
  authIndicators: [
    'a[data-testid="AppTabBar_Home_Link"]',
    'a[aria-label="Home"]',
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    'a[href="/home"]'
  ]
};

// Check detailed state of an element
async function getElementState(page: Page, selector: string): Promise<ElementState> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { exists: false, visible: false, enabled: false, inViewport: false, obscured: false, boundingBox: null };
    
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    // Check visibility
    const visible = style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' &&
                   rect.width > 0 && 
                   rect.height > 0;
    
    // Check enabled state (for buttons)
    const isDisabled = (el as HTMLButtonElement).disabled || 
                      el.getAttribute('aria-disabled') === 'true' ||
                      el.classList.contains('disabled');
    
    // Check if in viewport
    const inViewport = rect.top >= 0 && 
                      rect.left >= 0 && 
                      rect.bottom <= window.innerHeight && 
                      rect.right <= window.innerWidth;
    
    // Check if obscured by another element
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const obscured = topElement !== el && !el.contains(topElement);
    
    return {
      exists: true,
      visible,
      enabled: !isDisabled,
      inViewport,
      obscured,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  }, selector);
}

// NEW: Verify a tweet exists via TwitterAPI.io
async function verifyTweetExists(tweetId: string): Promise<boolean> {
  try {
    const apiKey = process.env.TWITTERAPI_IO_KEY;
    if (!apiKey) {
      log('TwitterAPI.io key not configured - skipping verification', 'WARN');
      return true; // Assume it exists if we can't verify
    }

    log(`Verifying tweet ${tweetId} exists...`);
    const response = await fetch(
      `https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`,
      {
        headers: { 'X-API-Key': apiKey }
      }
    );

    if (!response.ok) {
      log(`TwitterAPI.io verification failed: ${response.status}`, 'WARN');
      return true; // Assume it exists if API fails
    }

    const data = await response.json();
    const exists = data?.tweets && data.tweets.length > 0;
    log(`Tweet ${tweetId} verification: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
    return exists;
  } catch (error: any) {
    log(`Tweet verification error: ${error.message}`, 'WARN');
    return true; // Assume it exists if verification fails
  }
}

// NEW: Wait for send button to be truly ready (enabled, visible, clickable)
async function waitForSendButtonReady(page: Page): Promise<boolean> {
  const maxWait = 15000; // 15 seconds
  const startTime = Date.now();

  log('Waiting for send button to become ready...');

  while (Date.now() - startTime < maxWait) {
    const buttonState = await page.evaluate((selectors) => {
      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLButtonElement | null;
        if (!btn) continue;

        const disabled = btn.disabled ||
                        btn.getAttribute('aria-disabled') === 'true' ||
                        btn.classList.contains('disabled');

        const rect = btn.getBoundingClientRect();
        const visible = rect.height > 0 && rect.width > 0;

        // Twitter-specific: button must have pointer-events enabled
        const style = window.getComputedStyle(btn);
        const clickable = style.pointerEvents !== 'none';

        if (visible && !disabled && clickable) {
          return { ready: true, selector: sel };
        }
      }
      return { ready: false };
    }, SELECTORS.sendButton);

    if (buttonState.ready) {
      log(`Send button ready after ${Date.now() - startTime}ms`);
      return true;
    }

    await sleep(200); // Check every 200ms
  }

  log('Send button never became ready', 'WARN');
  return false;
}

// Find element using multiple selector strategies with state verification
async function findElementWithState(
  page: Page,
  selectors: string[],
  options: { mustBeVisible?: boolean; mustBeEnabled?: boolean; timeout?: number } = {}
): Promise<{ found: boolean; selector: string; state: ElementState }> {
  const { mustBeVisible = true, mustBeEnabled = true, timeout = 5000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    for (const selector of selectors) {
      try {
        const state = await getElementState(page, selector);
        
        if (!state.exists) continue;
        if (mustBeVisible && !state.visible) continue;
        if (mustBeEnabled && !state.enabled) continue;
        
        return { found: true, selector, state };
      } catch (e) {
        continue;
      }
    }
    
    // Wait a bit before retrying
    await sleep(200);
  }
  
  return { found: false, selector: '', state: { exists: false, visible: false, enabled: false, inViewport: false, obscured: false, boundingBox: null } };
}

// Capture comprehensive diagnostics for debugging failures
async function captureDiagnostics(page: Page, context: string): Promise<string> {
  try {
    const diagnostics = await page.evaluate(() => {
      // Find all potentially relevant elements
      const testIdElements = document.querySelectorAll('[data-testid]');
      const testIds = Array.from(testIdElements).slice(0, 30).map(el => ({
        testId: el.getAttribute('data-testid'),
        visible: el.getBoundingClientRect().height > 0,
        tag: el.tagName.toLowerCase()
      }));
      
      // Check for modals/dialogs
      const modals = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
      const modalCount = modals.length;
      
      // Check for textareas
      const textareas = document.querySelectorAll('[contenteditable="true"]');
      const textareaInfo = Array.from(textareas).slice(0, 5).map(el => ({
        text: (el.textContent || '').substring(0, 50),
        visible: el.getBoundingClientRect().height > 0,
        ariaLabel: el.getAttribute('aria-label')
      }));
      
      // Check for buttons
      const buttons = document.querySelectorAll('button[data-testid]');
      const buttonInfo = Array.from(buttons).slice(0, 10).map(el => ({
        testId: el.getAttribute('data-testid'),
        disabled: (el as HTMLButtonElement).disabled,
        visible: el.getBoundingClientRect().height > 0,
        ariaLabel: el.getAttribute('aria-label')
      }));
      
      return {
        url: window.location.href,
        title: document.title,
        modalCount,
        testIds,
        textareas: textareaInfo,
        buttons: buttonInfo
      };
    });
    
    const diagString = JSON.stringify(diagnostics, null, 2);
    log(`[DIAGNOSTICS:${context}] ${diagString}`, 'DEBUG');
    
    // Save screenshot
    const screenshotPath = `/tmp/diag_${context}_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    log(`Diagnostic screenshot: ${screenshotPath}`);
    
    return diagString;
  } catch (e: any) {
    return `Diagnostics failed: ${e.message}`;
  }
}

// In-memory duplicate cache: Set of "tweetId-textHash" to prevent duplicate replies
const postedRepliesCache = new Set<string>();

// Simple text hash for duplicate detection
const hashText = (text: string): string => {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
};

// Build marker for verifying code reload
const BUILD_ID = 'BUILD_20251225_NETINTERCEPT';
console.log(`[TwitterAutomation] ${BUILD_ID} loaded`);

// Legacy function for backwards compatibility - now uses humanized version
const humanTypeText = async (page: Page, selector: string, text: string, minDelay = 30, maxDelay = 150) => {
  await typeLikeHuman(page, selector, text, { minDelay, maxDelay });
};

interface ReplyParams {
  tweetId: string;
  replyText: string;
  twitterCookie: string;
  mediaUrl?: string;
  username?: string;
  tweetUrl?: string;  // Optional full URL (preferred over tweetId)
}

interface ReplyResult {
  success: boolean;
  replyUrl?: string;
  replyId?: string;
  error?: string;
}

interface LikeParams {
  tweetUrl: string;
  twitterCookie: string;
  username?: string;
}

interface LikeResult {
  success: boolean;
  error?: string;
}

interface ReplyAndLikeParams {
  tweetId: string;
  replyText: string;
  twitterCookie: string;
  mediaUrl?: string;
  username?: string;
  likeUsername?: string;  // Can be different user for the like
  likeCookie?: string;    // Cookie for like user (if different)
}

interface ReplyAndLikeResult {
  replySuccess: boolean;
  replyUrl?: string;
  replyId?: string;
  replyError?: string;
  likeSuccess: boolean;
  likeError?: string;
}

interface DmParams {
  message: string;
  twitterCookie: string;
  groupChatId?: string;
  username?: string;
}

interface DmResult {
  success: boolean;
  totalSent?: number;
  messages?: string[];
  error?: string;
}

interface RetweetParams {
  tweetUrl: string;
  twitterCookie: string;
  username?: string;
}

interface RetweetResult {
  success: boolean;
  error?: string;
}

interface FollowingTweet {
  tweetUrl: string;
  authorHandle: string;
  content: string;
}

interface GetFollowingTweetsResult {
  success: boolean;
  tweets: FollowingTweet[];
  error?: string;
}

export class TwitterAutomationService {

  async postReply(params: ReplyParams): Promise<ReplyResult> {
    log(`Posting reply to tweet ${params.tweetId}${params.username ? ` from @${params.username}` : ''}`);
    
    // Pre-flight duplicate check
    const textHash = hashText(params.replyText);
    const duplicateKey = `${params.tweetId}-${textHash}`;
    if (postedRepliesCache.has(duplicateKey)) {
      log(`Duplicate detected: already posted similar reply to tweet ${params.tweetId}`, 'WARN');
      return {
        success: false,
        error: 'DUPLICATE_BLOCKED: Similar reply already posted to this tweet'
      };
    }
    
    return browserManager.executeTask(async (page: Page) => {
      try {
        await browserManager.setCookies(page, params.twitterCookie);
        
        // PROXY FIX: Use 'domcontentloaded' instead of 'networkidle2' to handle slow proxies
        // networkidle2 can timeout when proxies are slow or Twitter has many tracking scripts
        // BUT: If this takes >20s, the proxy is likely broken/blocked
        log('Navigating to https://x.com...');
        const startTime = Date.now();
        try {
          await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (navError: any) {
          const elapsed = Date.now() - startTime;
          throw new Error(`Navigation to Twitter failed after ${elapsed}ms - proxy likely blocked or broken: ${navError.message}`);
        }
        const navTime = Date.now() - startTime;
        log(`Loaded https://x.com in ${navTime}ms`);
        await sleep(2000); // Extra wait for page to stabilize

        const isLoggedIn = await page.$('a[data-testid="AppTabBar_Home_Link"]') ||
                          await page.$('a[aria-label="Home"]');
        if (!isLoggedIn) {
          throw new Error('Cookie authentication failed - not logged in');
        }
        log('Successfully authenticated');

        // Use proper tweet URL format (not /i/status which requires auth redirect)
        const tweetUrl = params.tweetUrl || `https://x.com/i/status/${params.tweetId}`;
        log(`Navigating to tweet: ${tweetUrl}`);
        await page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(2000); // Wait for tweet to load

        // Log final URL after any redirects
        log(`Final URL: ${page.url()}`);
        
        // Check if tweet is unavailable (error page shown)
        const errorDetail = await page.$('[data-testid="error-detail"]');
        if (errorDetail) {
          const errorText = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="error-detail"]');
            return el?.textContent || 'Tweet unavailable';
          });
          log(`Tweet unavailable: ${errorText}`, 'ERROR');
          throw new Error(`Tweet unavailable or deleted: ${errorText.substring(0, 100)}`);
        }

        // Use adaptive selector system to find reply button with state verification
        log('Looking for reply button with adaptive selectors...');
        const replyButtonResult = await findElementWithState(page, SELECTORS.replyButton, {
          mustBeVisible: true,
          mustBeEnabled: true,
          timeout: 8000
        });
        
        if (!replyButtonResult.found) {
          // Capture diagnostics on failure
          await captureDiagnostics(page, 'reply_button_not_found');
          throw new Error('Could not find reply button on tweet');
        }
        
        const replySelector = replyButtonResult.selector;
        log(`Found reply button: ${replySelector} (visible=${replyButtonResult.state.visible}, enabled=${replyButtonResult.state.enabled})`);
        
        const replyButton = await page.$(replySelector);
        if (!replyButton) {
          throw new Error('Reply button element disappeared after finding it');
        }
        
        // Pre-interaction routine: slight scroll and mouse movement
        await preInteractionRoutine(page, replySelector);
        await humanPause('short');
        
        // Humanized click on reply button
        await humanizedClickElement(page, replyButton, { moveFirst: true });
        await humanPause('medium'); // Natural pause after clicking reply
        
        // SNAPSHOT: Capture existing reply IDs before posting
        const existingReplyIds = await page.$$eval('article[data-testid="tweet"] a[href*="/status/"]', links => {
          const ids = new Set<string>();
          links.forEach(link => {
            const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
            if (match) ids.add(match[1]);
          });
          return Array.from(ids);
        }).catch(() => [] as string[]);
        log(`Pre-send snapshot: ${existingReplyIds.length} existing tweets captured`);

        // Wait for reply modal to appear - Twitter can be slow
        await humanPause('medium');
        
        // COMPOSER RECOVERY LOGIC: If modal didn't open, try clicking reply button again
        let inputFound = false;
        let usedInputSelector = '';
        
        for (let composerAttempt = 0; composerAttempt < 3 && !inputFound; composerAttempt++) {
          if (composerAttempt > 0) {
            log(`Composer recovery attempt ${composerAttempt}/3 - re-clicking reply button...`);
            // Modal may have closed - try clicking reply button again
            const recoveryButton = await findElementWithState(page, SELECTORS.replyButton, {
              mustBeVisible: true,
              mustBeEnabled: true,
              timeout: 3000
            });
            
            if (recoveryButton.found) {
              const btn = await page.$(recoveryButton.selector);
              if (btn) {
                await humanizedClickElement(page, btn, { moveFirst: true });
                await humanPause('long');
              }
            }
          }
          
          // Use adaptive selector to find reply input with state verification
          const inputResult = await findElementWithState(page, SELECTORS.replyInput, {
            mustBeVisible: true,
            mustBeEnabled: false, // Inputs don't have disabled state the same way
            timeout: 5000
          });
          
          if (inputResult.found) {
            usedInputSelector = inputResult.selector;
            log(`Found reply input: ${usedInputSelector} (visible=${inputResult.state.visible})`);

            // CRITICAL: Verify we're in a REPLY context, not a new tweet compose window
            const isReplyContext = await page.evaluate(() => {
              // Look for "Replying to @username" text which only appears in reply modals
              const replyingTo = document.querySelector('[dir="ltr"]');
              if (replyingTo?.textContent?.includes('Replying to')) {
                return true;
              }
              // Also check for the reply indicator in the compose area
              const allText = document.body.innerText;
              return allText.includes('Replying to @');
            });

            if (!isReplyContext) {
              log('Not in reply context - compose window is for new tweet, not reply!', 'WARN');
              if (composerAttempt < 2) {
                // Close this compose window and try again
                await page.keyboard.press('Escape');
                await humanPause('medium');
                continue; // Try next recovery attempt
              } else {
                throw new Error('Could not open reply compose window - keeps opening new tweet window instead');
              }
            }

            log('Verified we are in reply context (has "Replying to @username" text)');

            // Random mouse wander before focusing on input
            await randomMouseWander(page);
            await humanPause('micro');

            // Humanized click to focus
            await humanizedClick(page, usedInputSelector, { moveFirst: true });

            // CRITICAL: Wait for compose box to be FULLY ready before typing
            // Without this, the first characters get lost because the field isn't ready
            await humanPause('long');

            // Verify the input is focused and ready
            await page.waitForFunction((selector) => {
              const el = document.querySelector(selector);
              return el && (document.activeElement === el || el.contains(document.activeElement));
            }, { timeout: 3000 }, usedInputSelector).catch(() => {
              log('Input may not be focused, but continuing...', 'WARN');
            });

            await humanPause('short');

            // Use humanized typing with randomized delays (30-150ms)
            await typeDirectlyLikeHuman(page, params.replyText, { minDelay: 30, maxDelay: 150 });
            log(`Typed reply text (${params.replyText.length} chars) with human-like delays`);
            
            // Verify text was entered
            await humanPause('short');
            const textContent = await page.$eval(usedInputSelector, el => el.textContent).catch(() => '');
            log(`Text in compose box: "${textContent?.substring(0, 50)}..."`);
            
            // Verify text was entered - accept any non-empty content (including short replies like emojis)
            const trimmedText = (textContent || '').trim();
            if (!trimmedText) {
              log('Text may not have been entered properly, trying alternative input', 'WARN');
              await humanizedClick(page, usedInputSelector, { moveFirst: true });
              await typeDirectlyLikeHuman(page, params.replyText, { minDelay: 40, maxDelay: 120 });
              await humanPause('short');
              
              // Verify again - accept any non-empty content
              const retryText = await page.$eval(usedInputSelector, el => el.textContent).catch(() => '');
              if (retryText && retryText.trim()) {
                inputFound = true;
              }
            } else {
              inputFound = true;
            }
          }
          
          if (!inputFound) {
            await humanPause('medium');
          }
        }
        
        if (!inputFound) {
          // Capture comprehensive diagnostics on failure
          await captureDiagnostics(page, 'reply_input_not_found');
          throw new Error('Could not find reply text input');
        }

        if (params.mediaUrl) {
          log(`Attaching media: ${params.mediaUrl}`);
          try {
            // Wait for file input to be available
            await page.waitForSelector('input[data-testid="fileInput"]', { timeout: 5000 }).catch(() => {
              log('File input not immediately available, continuing...', 'WARN');
            });

            const inputUploadHandle = await page.$('input[data-testid="fileInput"]');
            if (!inputUploadHandle) {
              throw new Error('File upload input not found');
            }

            const response = await fetch(params.mediaUrl);
            const buffer = await response.arrayBuffer();
            const tempPath = `/tmp/upload_${Date.now()}.jpg`;
            const fs = await import('fs/promises');
            await fs.writeFile(tempPath, Buffer.from(buffer));

            await inputUploadHandle.uploadFile(tempPath);
              
              // Wait for image to fully load and intelligently handle crop dialog if it appears
              log('Waiting for image upload to complete...');
              let cropDialogHandled = false;
              
              let altDialogHandled = false;
              for (let i = 0; i < 60; i++) {
                await humanPause('short');

                // Check for ALL media dialogs that might appear
                const dialogInfo = await page.evaluate(() => {
                  const cropTitle = document.querySelector('div[aria-label="Crop media"]') ||
                                   Array.from(document.querySelectorAll('span')).find(s => s.textContent === 'Crop media');
                  const applyButton = document.querySelector('[data-testid="applyMediaEditsButton"]');

                  // Check for ALT text dialog
                  const altDialog = document.querySelector('[aria-labelledby*="alt"]') ||
                                   Array.from(document.querySelectorAll('span')).find(s =>
                                     s.textContent?.includes('ALT') ||
                                     s.textContent?.includes('Describe') ||
                                     s.textContent?.includes('image description')
                                   );

                  const saveButtons = Array.from(document.querySelectorAll('button')).filter(btn =>
                    btn.textContent?.trim() === 'Save' ||
                    btn.textContent?.trim() === 'Apply' ||
                    btn.textContent?.trim() === 'Done' ||
                    btn.textContent?.trim() === 'Skip'
                  );

                  const removeBtn = document.querySelector('button[aria-label="Remove media"]');
                  const imgPreview = document.querySelector('[data-testid="attachments"] img');

                  return {
                    hasCropTitle: !!cropTitle,
                    hasApplyButton: !!applyButton,
                    hasAltDialog: !!altDialog,
                    hasSaveButton: saveButtons.length > 0,
                    hasImage: !!(removeBtn || imgPreview),
                    saveButtonTexts: saveButtons.map(b => b.textContent?.trim())
                  };
                });

                // Handle crop dialog first
                if (dialogInfo.hasCropTitle || dialogInfo.hasApplyButton) {
                  log('Crop dialog detected, clicking Apply to preserve aspect ratio...');

                  // Try the testid button first (most reliable)
                  if (dialogInfo.hasApplyButton) {
                    const clicked = await humanizedClick(page, '[data-testid="applyMediaEditsButton"]', { moveFirst: true });
                    if (clicked) {
                      log('Clicked Apply - aspect ratio preserved');
                      cropDialogHandled = true;
                      await humanPause('long'); // Wait longer for dialog to fully close
                      continue;
                    }
                  }

                  // Fallback: click Apply button via evaluate
                  const clickedApply = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    for (let i = 0; i < buttons.length; i++) {
                      const text = buttons[i].textContent?.trim();
                      if (text === 'Apply') {
                        (buttons[i] as HTMLButtonElement).click();
                        return true;
                      }
                    }
                    return false;
                  });

                  if (clickedApply) {
                    log('Crop dialog Apply button clicked via evaluate');
                    cropDialogHandled = true;
                    await humanPause('long');
                    continue;
                  }
                }

                // Handle ALT text dialog (skip it)
                if (dialogInfo.hasAltDialog) {
                  log('ALT text dialog detected, clicking Skip/Done to dismiss...');

                  const dismissed = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    for (let i = 0; i < buttons.length; i++) {
                      const text = buttons[i].textContent?.trim();
                      // Skip ALT text entry
                      if (text === 'Skip' || text === 'Done' || text === 'Save') {
                        (buttons[i] as HTMLButtonElement).click();
                        return text;
                      }
                    }
                    return null;
                  });

                  if (dismissed) {
                    log(`ALT dialog dismissed via ${dismissed} button`);
                    altDialogHandled = true;
                    await humanPause('long'); // Wait for dialog to close
                    continue;
                  }
                }

                // Check for image thumbnail (upload complete, not in dialog)
                if (dialogInfo.hasImage && !dialogInfo.hasCropTitle && !dialogInfo.hasAltDialog) {
                  log(`Image upload complete (crop=${cropDialogHandled}, alt=${altDialogHandled})`);
                  break;
                }

                if (i === 59) {
                  log('Image upload timeout, proceeding anyway', 'WARN');
                }
              }

            // CRITICAL: Wait longer for Twitter to finish processing the upload on their servers
            // Even though we see the thumbnail, Twitter may still be processing in the background
            // FIX #2: Extended from 2x to 4x long pauses (8-12 seconds total) for server-side processing
            log('Waiting additional time for Twitter to finish processing image upload...');
            await humanPause('long');
            await humanPause('long');
            await humanPause('long'); // FIX #2: Additional wait for media processing
            await humanPause('long'); // FIX #2: Ensures send button becomes enabled

            // Cleanup temp file
            await fs.unlink(tempPath).catch(() => {});
          } catch (mediaError: any) {
            log(`Media upload failed: ${mediaError.message}, continuing without image`, 'WARN');
          }
        }

        await humanPause('medium');

        // STRATEGIC SCREENSHOT #1: Capture state before dialog detection
        // This helps us see exactly what dialogs are present when we make dismissal decisions
        const preDialogCheckScreenshot = `/tmp/pre_dialog_check_${Date.now()}.png`;
        await page.screenshot({ path: preDialogCheckScreenshot, fullPage: false });
        log(`[SCREENSHOT] Before dialog check: ${preDialogCheckScreenshot}`);

        // FINAL CHECK: Make sure no BLOCKING dialogs are still open before sending
        // NOTE: The reply compose modal itself has [role="dialog"], so we need to be careful
        // to only detect actual blocking dialogs (ALT text, Crop, etc.), not the modal itself
        log('Final check for any blocking dialogs (ALT/Crop) before sending...');
        const finalDialogCheck = await page.evaluate(() => {
          const allText = document.body.innerText || '';
          const hasCrop = allText.includes('Crop');
          const hasALT = (allText.includes('ALT') || allText.includes('Add description')) &&
                         allText.includes('image'); // Must have both ALT and 'image' to be an ALT dialog

          // Get all dialogs and analyze them
          const dialogs = document.querySelectorAll('[role="dialog"]');
          const dialogDetails = Array.from(dialogs).map(dialog => {
            const text = (dialog.textContent || '').substring(0, 300);
            const ariaLabel = dialog.getAttribute('aria-label') || '';
            const testId = dialog.getAttribute('data-testid') || '';

            // Identify dialog types
            const isComposeModal = text.includes('Post text') || ariaLabel.includes('Post') || testId.includes('compose');
            const isDrafts = text.includes('Drafts') || ariaLabel.includes('Drafts');
            const isALT = text.includes('ALT') && text.includes('image');
            const isCrop = text.includes('Crop');

            return { text, ariaLabel, testId, isComposeModal, isDrafts, isALT, isCrop };
          });

          // Only count BLOCKING dialogs (ALT, Crop) - ignore compose modal and Drafts
          const blockingDialogs = dialogDetails.filter(d => d.isALT || d.isCrop);

          return {
            hasCrop,
            hasALT,
            totalDialogs: dialogs.length,
            blockingDialogCount: blockingDialogs.length,
            blockingDialogs,
            sample: allText.substring(0, 200)
          };
        });

        // ONLY dismiss if there are actual BLOCKING dialogs (ALT/Crop), not just the compose modal
        if (finalDialogCheck.hasCrop || finalDialogCheck.hasALT || finalDialogCheck.blockingDialogCount > 0) {
          log(`WARNING: Blocking dialog detected! crop=${finalDialogCheck.hasCrop}, alt=${finalDialogCheck.hasALT}, blocking=${finalDialogCheck.blockingDialogCount}`, 'WARN');
          log(`Page text sample: ${finalDialogCheck.sample}`, 'WARN');
          log(`Blocking dialog details: ${JSON.stringify(finalDialogCheck.blockingDialogs, null, 2)}`, 'WARN');

          // CRITICAL FIX: Only click buttons that are INSIDE blocking dialogs (ALT/Crop)
          // DO NOT click the "Close" button from the compose modal itself (testId="app-bar-close")
          const dismissed = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));

            // ONLY target buttons for ALT/Crop dialogs - use specific keywords
            const dismissTexts = ['Skip', 'Done', 'Apply', 'Save', 'Not now'];

            // First try exact matches for ALT/Crop dialog buttons
            for (const btn of buttons) {
              const text = btn.textContent?.trim();
              const ariaLabel = btn.getAttribute('aria-label');
              const testId = btn.getAttribute('data-testid') || '';

              // CRITICAL: Skip the compose modal's close button
              if (testId === 'app-bar-close') {
                continue; // This closes the ENTIRE modal - skip it!
              }

              if (dismissTexts.some(dt => text === dt || ariaLabel?.includes(dt))) {
                (btn as HTMLButtonElement).click();
                return text || ariaLabel || 'button';
              }
            }

            return null;
          });

          if (dismissed) {
            log(`Dismissed blocking dialog with "${dismissed}" button`);
            await humanPause('long');

            // STRATEGIC SCREENSHOT #2.5: After dialog dismissal, verify compose modal is still open
            const postDismissScreenshot = `/tmp/post_dialog_dismiss_${Date.now()}.png`;
            await page.screenshot({ path: postDismissScreenshot, fullPage: false });
            log(`[SCREENSHOT] After dismissing blocking dialog: ${postDismissScreenshot}`);
          } else {
            // If we couldn't find a dismiss button, try Escape key ONCE for ALT/Crop dialogs
            log('No dismiss button found, trying Escape key for blocking dialogs...');
            await page.keyboard.press('Escape');
            await humanPause('medium');

            // STRATEGIC SCREENSHOT #2.5: After Escape key, verify compose modal is still open
            const postEscapeScreenshot = `/tmp/post_escape_${Date.now()}.png`;
            await page.screenshot({ path: postEscapeScreenshot, fullPage: false });
            log(`[SCREENSHOT] After Escape key: ${postEscapeScreenshot}`);
          }
        } else {
          log(`No blocking dialogs detected (total dialogs: ${finalDialogCheck.totalDialogs}, but all are harmless compose/drafts)`);
        }

        // Humanized send button click sequence with adaptive selectors
        log(`[${BUILD_ID}] Starting humanized send button click sequence`);
        await humanPause('short');

        // Pre-click mouse wander to look natural
        await randomMouseWander(page);

        // Get the text content before clicking to compare later (use adaptive selector)
        const textBefore = await page.$eval(usedInputSelector, el => el.textContent || '').catch(() => '');
        log(`Text before send: "${textBefore.substring(0, 30)}..."`);

        // STRATEGIC SCREENSHOT #2: Capture state before send button check
        // This verifies that the reply text is still present in the compose box
        const preSendScreenshot = `/tmp/pre_send_check_${Date.now()}.png`;
        await page.screenshot({ path: preSendScreenshot, fullPage: false });
        log(`[SCREENSHOT] Before send button check (text length: ${textBefore.length}): ${preSendScreenshot}`);

        // PRE-SEND STATE CHECK: Verify send button exists and is enabled
        // FIX #1: Increased timeout from 5s to 15s for media upload processing
        const sendButtonCheck = await findElementWithState(page, SELECTORS.sendButton, {
          mustBeVisible: true,
          mustBeEnabled: true,
          timeout: 15000  // Increased from 5000ms to handle media processing delays
        });

        if (!sendButtonCheck.found) {
          // Button might be disabled because text wasn't entered - capture diagnostics
          log('Send button not found or disabled - capturing diagnostics', 'WARN');
          // FIX #5: Log detailed button state for debugging
          log(`Button state details: visible=${sendButtonCheck.state.visible}, enabled=${sendButtonCheck.state.enabled}, clickable=${!sendButtonCheck.state.obscured}`, 'WARN');
          await captureDiagnostics(page, 'send_button_not_ready');

          // Try waiting longer for button to become enabled
          await humanPause('long');
          const retryCheck = await findElementWithState(page, SELECTORS.sendButton, {
            mustBeVisible: true,
            mustBeEnabled: true,
            timeout: 10000  // Increased from 5000ms for retry attempt (25s total)
          });

          if (!retryCheck.found) {
            // FIX #5: Log retry state before throwing error
            log(`Retry button state: visible=${retryCheck.state.visible}, enabled=${retryCheck.state.enabled}, clickable=${!retryCheck.state.obscured}`, 'ERROR');

            // STRATEGIC SCREENSHOT #3: Capture final state when send button still not found
            const sendButtonFailScreenshot = `/tmp/send_button_fail_${Date.now()}.png`;
            await page.screenshot({ path: sendButtonFailScreenshot, fullPage: false });
            log(`[SCREENSHOT] Send button still not found after retry: ${sendButtonFailScreenshot}`, 'ERROR');
            await captureDiagnostics(page, 'send_button_retry_failed');

            throw new Error('Send button not available or disabled');
          }
        }
        
        log(`Send button ready: ${sendButtonCheck.selector} (enabled=${sendButtonCheck.state.enabled})`);
        
        // Check if image is attached
        const hasImage = !!params.mediaUrl;
        
        let textAfter = '';
        let success = false;
        
        // NETWORK INTERCEPTION: Capture the new tweet ID from GraphQL response
        let capturedTweetId: string | undefined;
        let responseListener: ((response: any) => void) | undefined;
        
        const setupNetworkInterception = () => {
          // Also listen to requests to see if CreateTweet is being sent
          const requestListener = async (request: any) => {
            try {
              const url = request.url();
              if (url.includes('/graphql/') && url.includes('CreateTweet')) {
                log(`[NetworkIntercept] CreateTweet REQUEST detected! Method: ${request.method()}`);
                const postData = request.postData();
                if (postData) {
                  log(`[NetworkIntercept] Request payload (first 500 chars): ${postData.substring(0, 500)}`);
                }
              }
            } catch (err: any) {
              log(`[NetworkIntercept] Error processing request: ${err.message}`, 'ERROR');
            }
          };

          responseListener = async (response: any) => {
            try {
              const url = response.url();
              const status = response.status();

              // Log ALL GraphQL requests to see what's happening
              if (url.includes('/graphql/')) {
                const operation = url.split('/graphql/').pop()?.split('?')[0] || 'unknown';
                log(`[NetworkIntercept] GraphQL ${operation}: status=${status}`);
              }

              // Only process successful GraphQL CreateTweet responses
              // Match specific endpoint pattern: /graphql/{queryId}/CreateTweet
              if (status === 200 && url.includes('/graphql/') && url.includes('CreateTweet')) {
                log(`[NetworkIntercept] Found CreateTweet response! Parsing...`);
                // Use buffer() instead of text() to avoid consuming the response body
                // Puppeteer captures at protocol level, so this should be safe
                const buffer = await response.buffer().catch(() => null);
                if (buffer) {
                  try {
                    const json = JSON.parse(buffer.toString());
                    log(`[NetworkIntercept] CreateTweet response parsed: ${JSON.stringify(json).substring(0, 500)}...`);

                    // Only extract ID if the response contains create_tweet data
                    if (json?.data?.create_tweet?.tweet_results?.result) {
                      const result = json.data.create_tweet.tweet_results.result;
                      const tweetId = result.rest_id || result.tweet?.rest_id;

                      if (tweetId && !capturedTweetId) {
                        capturedTweetId = tweetId;
                        log(`[NetworkIntercept] Captured new tweet ID: ${tweetId}`);
                      }
                    } else if (json?.errors) {
                      log(`[NetworkIntercept] CreateTweet returned errors: ${JSON.stringify(json.errors)}`, 'ERROR');
                    } else {
                      log(`[NetworkIntercept] CreateTweet response missing expected data structure`, 'WARN');
                    }
                  } catch (parseErr: any) {
                    log(`[NetworkIntercept] Failed to parse CreateTweet response: ${parseErr.message}`, 'ERROR');
                  }
                }
              }
            } catch (err: any) {
              log(`[NetworkIntercept] Error processing response: ${err.message}`, 'ERROR');
            }
          };

          page.on('request', requestListener);
          page.on('response', responseListener);
          log('[NetworkIntercept] Listening for CreateTweet requests and responses...');
        };
        
        const cleanupNetworkInterception = () => {
          if (responseListener) {
            page.off('response', responseListener);
            log(`[NetworkIntercept] Cleanup complete. Captured ID: ${capturedTweetId || 'none'}`);
          }
        };
        
        // Start listening before any send attempts
        setupNetworkInterception();
        
        try {
        // Helper function to check if send was successful
        const checkSendSuccess = async (): Promise<boolean> => {
          // Check if composer is gone or empty
          const textNow = await page.$eval(usedInputSelector, el => el.textContent || '').catch(() => 'GONE');
          
          // Also check if modal/overlay closed
          const composerGone = await page.evaluate(() => {
            const layers = document.querySelectorAll('[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]');
            return layers.length === 0;
          }).catch(() => true);
          
          return textNow === '' || textNow === 'GONE' || composerGone || textNow !== textBefore;
        };
        
        // NEW: Wait for send button to be truly ready before clicking
        log('Waiting for send button to be ready...');
        const buttonReady = await waitForSendButtonReady(page);
        if (!buttonReady) {
          throw new Error('Send button never became ready after 15 seconds');
        }
        log('Send button is ready! Proceeding to click...');

        // Use REAL mouse click instead of JavaScript click to avoid detection
        // Twitter's anti-bot can detect element.click() but not real mouse events
        let clicked = { clicked: false, selector: null as string | null };
        for (const selector of SELECTORS.sendButton) {
          try {
            const button = await page.$(selector);
            if (button) {
              // Use Puppeteer's real click (simulates actual mouse movement and click)
              await button.click();
              clicked = { clicked: true, selector };
              log(`Send button clicked with REAL mouse: ${selector}`);
              break;
            }
          } catch (e: any) {
            log(`Could not click ${selector}: ${e.message}`, 'WARN');
          }
        }

        if (!clicked.clicked) {
          throw new Error('Could not click send button with any selector');
        }

        log(`Send button clicked: ${JSON.stringify(clicked)}`);

        // Wait for UI confirmation (composer closes) - increased wait time
        log('Waiting 5 seconds for Twitter to process...');
        await sleep(5000);
        success = await checkSendSuccess();
        textAfter = await page.$eval(usedInputSelector, el => el.textContent || '').catch(() => 'GONE');
        log(`After click: text="${textAfter.substring(0, 20)}", success=${success}`);

        // Check for Twitter error messages in the UI
        const errorMessage = await page.evaluate(() => {
          // Common error message selectors
          const errorSelectors = [
            '[data-testid="toast"]',
            '[role="alert"]',
            '[data-testid="error-detail"]',
            '.r-1oszu61', // Twitter's error toast class
          ];

          for (const selector of errorSelectors) {
            const errorEl = document.querySelector(selector);
            if (errorEl?.textContent) {
              return errorEl.textContent.trim();
            }
          }
          return null;
        }).catch(() => null);

        if (errorMessage) {
          log(`[UI ERROR DETECTED] Twitter showed error: "${errorMessage}"`, 'ERROR');

          // If it's the media crop/ALT error, try to dismiss it
          if (errorMessage.includes('Crop') || errorMessage.includes('media') || errorMessage.includes('ALT')) {
            log('Attempting to dismiss media error dialog...', 'WARN');

            // Try to click any close/dismiss buttons
            const dismissed = await page.evaluate(() => {
              // Look for close buttons
              const closeButtons = Array.from(document.querySelectorAll('button'));
              for (const btn of closeButtons) {
                const ariaLabel = btn.getAttribute('aria-label');
                const text = btn.textContent?.trim();
                if (ariaLabel?.includes('Close') || text === 'Close' || text === 'Cancel' || ariaLabel?.includes('Dismiss')) {
                  (btn as HTMLButtonElement).click();
                  return true;
                }
              }
              return false;
            }).catch(() => false);

            if (dismissed) {
              log('Dismissed media error dialog', 'WARN');
            }

            throw new Error(`Twitter media error: ${errorMessage}`);
          }
        }

        // Take screenshot
        const fs = await import('fs/promises');
        const screenshotPath = `/tmp/after_send_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
        log(`Screenshot saved: ${screenshotPath}`);
        
        if (!success) {
          log('All methods tried - checking if reply posted anyway...', 'WARN');
        }
        
        await sleep(1000);
        
        } finally {
          // Cleanup network interception on all exit paths
          cleanupNetworkInterception();
        }

        // After posting, determine the new reply ID
        // Priority: Network interception > URL change > Snapshot comparison > Profile check
        
        let newReplyId: string | undefined;
        let newReplyUrl: string | undefined;
        
        // PRIMARY METHOD: Use network-intercepted tweet ID (most reliable)
        if (capturedTweetId) {
          // NEW: Verify the captured tweet ID actually exists via TwitterAPI.io
          const verified = await verifyTweetExists(capturedTweetId);
          if (verified) {
            newReplyId = capturedTweetId;
            newReplyUrl = `https://x.com/i/status/${capturedTweetId}`;
            log(`[NetworkIntercept] Using VERIFIED captured tweet ID: ${newReplyUrl}`);
            postedRepliesCache.add(duplicateKey);
          } else {
            log(`[NetworkIntercept] Captured tweet ID ${capturedTweetId} does NOT exist - discarding`, 'WARN');
            // Will fall through to snapshot method
          }
        }
        
        // FALLBACK METHODS: Only run if network interception didn't capture the ID
        const currentUrl = page.url();
        const currentIdMatch = currentUrl.match(/status\/(\d+)/);
        
        if (!newReplyId) {
          // FALLBACK 1: Check if URL changed (sometimes Twitter navigates to the reply)
          if (currentIdMatch && !currentUrl.includes('/compose/')) {
            const originalTweetId = params.tweetUrl?.match(/status\/(\d+)/)?.[1] || params.tweetId;
            if (currentIdMatch[1] !== originalTweetId) {
              newReplyId = currentIdMatch[1];
              newReplyUrl = `https://x.com/i/status/${newReplyId}`;
              log(`Found reply via URL change: ${newReplyUrl}`);
              postedRepliesCache.add(duplicateKey);
            }
          }
        }
        
        if (!newReplyId) {
          // FALLBACK 2: SNAPSHOT COMPARISON - Find truly NEW reply by comparing to pre-send snapshot
          try {
            // Wait a bit for the reply to appear in the UI
            await sleep(2000);
            
            // Capture current reply IDs
            const currentReplyIds = await page.$$eval('article[data-testid="tweet"] a[href*="/status/"]', links => {
              const ids = new Set<string>();
              links.forEach(link => {
                const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
                if (match) ids.add(match[1]);
              });
              return Array.from(ids);
            }).catch(() => [] as string[]);
            
            log(`Post-send check: ${currentReplyIds.length} tweets visible (was ${existingReplyIds.length})`);
            
            // Find NEW IDs that weren't in the snapshot
            const originalTweetId = params.tweetUrl?.match(/status\/(\d+)/)?.[1] || params.tweetId;
            const newIds = currentReplyIds.filter(id => 
              !existingReplyIds.includes(id) && id !== originalTweetId
            );
            
            if (newIds.length > 0) {
              // Found a genuinely new tweet - this is our reply!
              newReplyId = newIds[0];
              newReplyUrl = `https://x.com/i/status/${newReplyId}`;
              log(`Found NEW reply via snapshot diff: ${newReplyUrl}`);
              
              // Add to duplicate cache to prevent future duplicates
              postedRepliesCache.add(duplicateKey);
            } else {
              // No new tweets found yet - wait and try again (Twitter may be slow to update)
              log('No new tweet IDs found on first check - waiting and retrying...');
              
              // Wait for compose modal to close and page to update
              await sleep(2000);
              
              // If still on compose page, go back to the original tweet
              const checkUrl = page.url();
              if (checkUrl.includes('/compose/')) {
                log('Still on compose page, navigating back to tweet...');
                const tweetUrl = params.tweetUrl || `https://x.com/i/status/${params.tweetId}`;
                await page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await sleep(2000);
              }
              
              // Try snapshot comparison again
              const retryReplyIds = await page.$$eval('article[data-testid="tweet"] a[href*="/status/"]', links => {
                const ids = new Set<string>();
                links.forEach(link => {
                  const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
                  if (match) ids.add(match[1]);
                });
                return Array.from(ids);
              }).catch(() => [] as string[]);
              
              const retryNewIds = retryReplyIds.filter(id => 
                !existingReplyIds.includes(id) && id !== originalTweetId
              );
              
              if (retryNewIds.length > 0) {
                newReplyId = retryNewIds[0];
                newReplyUrl = `https://x.com/i/status/${newReplyId}`;
                log(`Found NEW reply on retry: ${newReplyUrl}`);
                postedRepliesCache.add(duplicateKey);
              } else {
                // Last resort: check user's profile for their most recent tweet
                log('Still no new tweets in thread - checking user profile for recent activity...');
                
                const username = params.username?.replace('@', '') || '';
                if (username) {
                  try {
                    await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await sleep(2000);
                    
                    // Get tweets from user's profile that are REPLIES (have "Replying to" text)
                    const profileReplyInfo = await page.$$eval('article[data-testid="tweet"]', articles => {
                      const replies: { id: string; timestamp: number }[] = [];
                      articles.forEach(article => {
                        // Check if this tweet has "Replying to" indicator
                        const replyingTo = article.querySelector('[dir="ltr"] span');
                        const isReply = replyingTo?.textContent?.includes('Replying to');
                        if (isReply) {
                          // Extract tweet ID from link
                          const link = article.querySelector('a[href*="/status/"]');
                          const match = link?.getAttribute('href')?.match(/\/status\/(\d+)/);
                          // Get timestamp for sorting
                          const timeEl = article.querySelector('time');
                          const timestamp = timeEl ? new Date(timeEl.getAttribute('datetime') || '').getTime() : 0;
                          if (match) {
                            replies.push({ id: match[1], timestamp });
                          }
                        }
                      });
                      return replies;
                    }).catch(() => [] as { id: string; timestamp: number }[]);

                    // Filter to only NEW replies (not in original snapshot)
                    const profileNewReplies = profileReplyInfo
                      .filter(r => !existingReplyIds.includes(r.id) && r.id !== originalTweetId)
                      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

                    if (profileNewReplies.length > 0) {
                      newReplyId = profileNewReplies[0].id;
                      newReplyUrl = `https://x.com/i/status/${newReplyId}`;
                      log(`Found NEW reply from user profile: ${newReplyUrl} (timestamp: ${new Date(profileNewReplies[0].timestamp).toISOString()})`);
                      postedRepliesCache.add(duplicateKey);
                    } else {
                      log('No new REPLIES found on user profile - tweet may not have posted', 'WARN');
                    }
                  } catch (profileError: any) {
                    log(`Could not check user profile: ${profileError.message}`, 'WARN');
                  }
                }
              }
            }
            
            // If compose box still had text, it's a true failure
            if (!newReplyId && textAfter && textAfter !== '' && textAfter !== 'GONE') {
              log('Compose box still has text - reply NOT sent (likely duplicate content blocked)', 'WARN');
            }
          } catch (e: any) {
            log(`Could not extract new reply ID: ${e.message}`, 'WARN');
          }
        }
        
        // CRITICAL: Only return success if we have PROOF the reply was posted
        // We MUST have a new reply ID - don't accept fallback URLs
        if (!newReplyId) {
          log(`Reply FAILED - no new reply ID found (text cleared: ${success})`, 'ERROR');

          // Capture comprehensive diagnostics on failure
          await captureDiagnostics(page, 'send_failed');

          throw new Error('Reply not posted - no new reply ID captured despite send');
        }

        // We have a verified new reply ID
        const finalReplyUrl = newReplyUrl || `https://x.com/i/status/${newReplyId}`;
        const finalReplyId = newReplyId;

        log(`Reply posted successfully: ${finalReplyUrl}`);
        
        return {
          success: true,
          replyUrl: finalReplyUrl,
          replyId: finalReplyId
        };

      } catch (error: any) {
        log(`Error posting reply: ${error.message}`, 'ERROR');
        
        // Let network errors bubble up for retry logic in browserManager
        const isNetworkError = error.message?.includes('ERR_TUNNEL') ||
                               error.message?.includes('ERR_PROXY') ||
                               error.message?.includes('net::') ||
                               error.message?.includes('Navigation timeout');
        
        if (isNetworkError) {
          throw error; // Let browserManager retry
        }
        
        return {
          success: false,
          error: error.message
        };
      }
    }, params.username, 3); // 3 retries for replies
  }

  async likeTweet(params: LikeParams): Promise<LikeResult> {
    log(`Liking tweet: ${params.tweetUrl} for @${params.username}`);
    
    return browserManager.executeTask(async (page: Page) => {
      try {
        await browserManager.setCookies(page, params.twitterCookie);
        
        // Navigate to x.com first to activate cookies (same as postReply)
        log(`Navigating to x.com to activate cookies...`);
        await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        // Check if we're logged in
        const isLoggedIn = await page.$('a[data-testid="AppTabBar_Home_Link"]') || 
                          await page.$('a[aria-label="Home"]');
        if (!isLoggedIn) {
          const url = page.url();
          log(`Login check failed at URL: ${url} - cookie may be invalid`, 'WARN');
          throw new Error('Cookie authentication failed - not logged in');
        }
        log('Successfully authenticated for like');

        // Now navigate to the tweet
        log(`Navigating to tweet: ${params.tweetUrl}`);
        await page.goto(params.tweetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);

        // Wait for either like or unlike button to appear
        let likeButton = null;
        let unlikeButton = null;
        
        try {
          // Wait up to 10 seconds for the like/unlike button to appear
          await page.waitForSelector('button[data-testid="like"], button[data-testid="unlike"]', { timeout: 10000 });
          likeButton = await page.$('button[data-testid="like"]');
          unlikeButton = await page.$('button[data-testid="unlike"]');
        } catch (e) {
          log('Timeout waiting for like button, checking page state...', 'WARN');
          const pageUrl = page.url();
          const pageTitle = await page.title();
          log(`Page URL: ${pageUrl}, Title: ${pageTitle}`, 'WARN');
          
          // Check for common issues
          const pageContent = await page.content();
          const hasLoginPrompt = pageContent.includes('Log in') || pageContent.includes('Sign up');
          const hasAgeGate = pageContent.includes('Date of birth') || pageContent.includes('age');
          const hasSensitive = pageContent.includes('sensitive content') || pageContent.includes('View');
          // More specific checks to avoid false positives
          const suspendedMatch = pageContent.includes('Account suspended') ? 'Account suspended' :
                                 pageContent.includes('This Tweet was deleted') ? 'Tweet was deleted' :
                                 pageContent.includes('this page doesn\'t exist') ? 'page doesn\'t exist' :
                                 pageContent.includes('Hmm...this page doesn') ? 'Hmm page doesn\'t' : null;
          
          // Log available testids FIRST for debugging before throwing errors
          const testIds = await page.$$eval('[data-testid]', els => els.map(el => el.getAttribute('data-testid')).filter(Boolean).slice(0, 30));
          log(`Available testids on page: ${testIds.join(', ')}`, 'WARN');
          
          // Get error-detail text if present
          const errorDetail = await page.$eval('[data-testid="error-detail"]', el => el.textContent).catch(() => null);
          if (errorDetail) {
            log(`Error detail: ${errorDetail}`, 'WARN');
          }
          
          // Save screenshot for debugging
          await page.screenshot({ path: '/tmp/twitter-debug.png', fullPage: false });
          log('Saved debug screenshot to /tmp/twitter-debug.png', 'WARN');
          
          if (hasLoginPrompt) {
            throw new Error('Login prompt appeared - cookie may be expired');
          }
          if (suspendedMatch) {
            // "Hmm page doesn't" just means the tweet URL doesn't exist - not suspended
            const message = suspendedMatch === 'Hmm page doesn\'t' 
              ? `Tweet not found (page doesn't exist)` 
              : `Tweet or account suspended/deleted (matched: ${suspendedMatch})`;
            throw new Error(message);
          }
          if (hasSensitive) {
            log('Sensitive content warning detected, trying to click through...', 'WARN');
            const viewButton = await page.$('button[data-testid="empty_state_button_text"]');
            if (viewButton) {
              await viewButton.click();
              await sleep(2000);
              likeButton = await page.$('button[data-testid="like"]');
              unlikeButton = await page.$('button[data-testid="unlike"]');
            }
          }
        }

        if (!likeButton) {
          if (unlikeButton) {
            log('Tweet already liked');
            return { success: true };
          }
          throw new Error('Could not find like button');
        }

        await likeButton.click();
        await sleep(1000);

        log('Tweet liked successfully');
        return { success: true };

      } catch (error: any) {
        log(`Error liking tweet: ${error.message}`, 'ERROR');
        
        // Let network errors bubble up for retry logic in browserManager
        const isNetworkError = error.message?.includes('ERR_TUNNEL') ||
                               error.message?.includes('ERR_PROXY') ||
                               error.message?.includes('net::') ||
                               error.message?.includes('Navigation timeout');
        
        if (isNetworkError) {
          throw error; // Let browserManager retry
        }
        
        return {
          success: false,
          error: error.message
        };
      }
    }, params.username, 3); // 3 retries for likes
  }

  /**
   * Combined reply + like in a single browser session.
   * This avoids proxy tunnel reconnection issues between separate operations.
   * The like happens AFTER the reply succeeds, using the same warm page.
   */
  async postReplyAndLike(params: ReplyAndLikeParams): Promise<ReplyAndLikeResult> {
    log(`Posting reply + like to tweet ${params.tweetId}${params.username ? ` from @${params.username}` : ''}`);

    // Pre-flight duplicate check
    const textHash = hashText(params.replyText);
    const duplicateKey = `${params.tweetId}-${textHash}`;
    if (postedRepliesCache.has(duplicateKey)) {
      log(`Duplicate detected: already posted similar reply to tweet ${params.tweetId}`, 'WARN');
      return {
        replySuccess: false,
        likeSuccess: false,
        replyError: 'DUPLICATE_BLOCKED: Similar reply already posted to this tweet'
      };
    }

    return browserManager.executeTask(async (page: Page) => {
      const result: ReplyAndLikeResult = {
        replySuccess: false,
        likeSuccess: false
      };

      try {
        // Set cookies and authenticate
        await browserManager.setCookies(page, params.twitterCookie);

        // BANDWIDTH OPTIMIZATION: Navigate directly to tweet URL instead of homepage first
        // This saves one full page load per reply operation
        const tweetUrl = `https://x.com/i/status/${params.tweetId}`;
        await page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        // Verify authentication on the tweet page itself
        const isLoggedIn = await page.$('a[data-testid="AppTabBar_Home_Link"]') ||
                          await page.$('a[aria-label="Home"]');
        if (!isLoggedIn) {
          throw new Error('Cookie authentication failed - not logged in');
        }
        log('Successfully authenticated');

        // === STEP 1: POST REPLY (exact copy of working postReply logic) ===
        try {
          // CRITICAL FIX: When the target tweet is itself a reply, Twitter shows BOTH the parent tweet
          // and the target tweet on the page. We need to find the reply button specifically for the
          // TARGET tweet, not the parent tweet. We do this by finding the article containing a link
          // to our specific tweet ID, then finding the reply button within that article.

          log(`Looking for reply button specifically for tweet ${params.tweetId}...`);

          // Find the article element that contains a link to our target tweet ID
          const tweetArticle = await page.evaluateHandle((tweetId) => {
            const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
            for (const article of articles) {
              // Look for a link that contains our tweet ID
              const link = article.querySelector(`a[href*="/status/${tweetId}"]`);
              if (link) {
                return article;
              }
            }
            return null;
          }, params.tweetId);

          if (!tweetArticle || await tweetArticle.evaluate(el => el === null)) {
            await captureDiagnostics(page, 'target_tweet_article_not_found');
            throw new Error(`Could not find article for target tweet ${params.tweetId}`);
          }

          // Now find the reply button WITHIN this specific article
          const replyButton = await tweetArticle.evaluateHandle((article) => {
            const replyBtn = article.querySelector('[data-testid="reply"]');
            return replyBtn;
          });

          if (!replyButton || await replyButton.evaluate(el => el === null)) {
            await captureDiagnostics(page, 'reply_button_not_found_in_article');
            throw new Error('Could not find reply button within target tweet article');
          }

          log(`Found reply button within target tweet ${params.tweetId}'s article`);

          // Pre-interaction routine: scroll the reply button into view
          await replyButton.evaluate((el: Element) => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          await humanPause('short');

          // Humanized click on reply button
          await humanizedClickElement(page, replyButton, { moveFirst: true });
          await humanPause('medium'); // Natural pause after clicking reply

          // SNAPSHOT: Capture existing reply IDs before posting
          const existingReplyIds = await page.$$eval('article[data-testid="tweet"] a[href*="/status/"]', links => {
            const ids = new Set<string>();
            links.forEach(link => {
              const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
              if (match) ids.add(match[1]);
            });
            return Array.from(ids);
          }).catch(() => [] as string[]);
          log(`Pre-send snapshot: ${existingReplyIds.length} existing tweets captured`);

          // Wait for reply modal to appear - Twitter can be slow
          await humanPause('medium');

          // COMPOSER RECOVERY LOGIC: If modal didn't open, try clicking reply button again
          let inputFound = false;
          let usedInputSelector = '';

          for (let composerAttempt = 0; composerAttempt < 3 && !inputFound; composerAttempt++) {
            if (composerAttempt > 0) {
              log(`Composer recovery attempt ${composerAttempt}/3 - re-clicking reply button...`);
              // Modal may have closed - try clicking reply button again
              const recoveryButton = await findElementWithState(page, SELECTORS.replyButton, {
                mustBeVisible: true,
                mustBeEnabled: true,
                timeout: 3000
              });

              if (recoveryButton.found) {
                const btn = await page.$(recoveryButton.selector);
                if (btn) {
                  await humanizedClickElement(page, btn, { moveFirst: true });
                  await humanPause('long');
                }
              }
            }

            // Use adaptive selector to find reply input with state verification
            const inputResult = await findElementWithState(page, SELECTORS.replyInput, {
              mustBeVisible: true,
              mustBeEnabled: false, // Inputs don't have disabled state the same way
              timeout: 5000
            });

            if (inputResult.found) {
              usedInputSelector = inputResult.selector;
              log(`Found reply input: ${usedInputSelector} (visible=${inputResult.state.visible})`);

              // CRITICAL: Verify we're in a REPLY context, not a new tweet compose window
              const isReplyContext = await page.evaluate(() => {
                // Look for "Replying to @username" text which only appears in reply modals
                const replyingTo = document.querySelector('[dir="ltr"]');
                if (replyingTo?.textContent?.includes('Replying to')) {
                  return true;
                }
                // Also check for the reply indicator in the compose area
                const allText = document.body.innerText;
                return allText.includes('Replying to @');
              });

              if (!isReplyContext) {
                log('Not in reply context - compose window is for new tweet, not reply!', 'WARN');
                if (composerAttempt < 2) {
                  // Close this compose window and try again
                  await page.keyboard.press('Escape');
                  await humanPause('medium');
                  continue; // Try next recovery attempt
                } else {
                  throw new Error('Could not open reply compose window - keeps opening new tweet window instead');
                }
              }

              log('Verified we are in reply context (has "Replying to @username" text)');

              // Random mouse wander before focusing on input
              await randomMouseWander(page);
              await humanPause('micro');

              // Humanized click to focus
              await humanizedClick(page, usedInputSelector, { moveFirst: true });

              // CRITICAL: Wait for compose box to be FULLY ready before typing
              // Without this, the first characters get lost because the field isn't ready
              await humanPause('long');

              // Verify the input is focused and ready
              await page.waitForFunction((selector) => {
                const el = document.querySelector(selector);
                return el && (document.activeElement === el || el.contains(document.activeElement));
              }, { timeout: 3000 }, usedInputSelector).catch(() => {
                log('Input may not be focused, but continuing...', 'WARN');
              });

              await humanPause('short');

              // Use humanized typing with randomized delays (30-150ms)
              await typeDirectlyLikeHuman(page, params.replyText, { minDelay: 30, maxDelay: 150 });
              log(`Typed reply text (${params.replyText.length} chars) with human-like delays`);

              // Verify text was entered
              await humanPause('short');
              const textContent = await page.$eval(usedInputSelector, el => el.textContent).catch(() => '');
              log(`Text in compose box: "${textContent?.substring(0, 50)}..."`);

              // Verify text was entered - accept any non-empty content (including short replies like emojis)
              const trimmedText = (textContent || '').trim();
              if (!trimmedText) {
                log('Text may not have been entered properly, trying alternative input', 'WARN');
                await humanizedClick(page, usedInputSelector, { moveFirst: true });
                await typeDirectlyLikeHuman(page, params.replyText, { minDelay: 40, maxDelay: 120 });
                await humanPause('short');

                // Verify again - accept any non-empty content
                const retryText = await page.$eval(usedInputSelector, el => el.textContent).catch(() => '');
                if (retryText && retryText.trim()) {
                  inputFound = true;
                }
              } else {
                inputFound = true;
              }
            }

            if (!inputFound) {
              await humanPause('medium');
            }
          }

          if (!inputFound) {
            // Capture comprehensive diagnostics on failure
            await captureDiagnostics(page, 'reply_input_not_found');
            throw new Error('Could not find reply text input');
          }

          if (params.mediaUrl) {
            log(`Attaching media: ${params.mediaUrl}`);
            try {
              // Wait for file input to be available
              await page.waitForSelector('input[data-testid="fileInput"]', { timeout: 5000 }).catch(() => {
                log('File input not immediately available, continuing...', 'WARN');
              });

              const inputUploadHandle = await page.$('input[data-testid="fileInput"]');
              if (!inputUploadHandle) {
                throw new Error('File upload input not found');
              }

              const response = await fetch(params.mediaUrl);
              const buffer = await response.arrayBuffer();
              const tempPath = `/tmp/upload_${Date.now()}.jpg`;
              const fs = await import('fs/promises');
              await fs.writeFile(tempPath, Buffer.from(buffer));

              await inputUploadHandle.uploadFile(tempPath);

                // Wait for image to fully load and intelligently handle crop dialog if it appears
                log('Waiting for image upload to complete...');
                let cropDialogHandled = false;

                let altDialogHandled = false;
                for (let i = 0; i < 30; i++) {
                  await humanPause('short');

                  // Check for ALL media dialogs that might appear
                  const dialogInfo = await page.evaluate(() => {
                    const cropTitle = document.querySelector('div[aria-label="Crop media"]') ||
                                     Array.from(document.querySelectorAll('span')).find(s => s.textContent === 'Crop media');
                    const applyButton = document.querySelector('[data-testid="applyMediaEditsButton"]');

                    // Check for ALT text dialog
                    const altDialog = document.querySelector('[aria-labelledby*="alt"]') ||
                                     Array.from(document.querySelectorAll('span')).find(s =>
                                       s.textContent?.includes('ALT') ||
                                       s.textContent?.includes('Describe') ||
                                       s.textContent?.includes('image description')
                                     );

                    const saveButtons = Array.from(document.querySelectorAll('button')).filter(btn =>
                      btn.textContent?.trim() === 'Save' ||
                      btn.textContent?.trim() === 'Apply' ||
                      btn.textContent?.trim() === 'Done' ||
                      btn.textContent?.trim() === 'Skip'
                    );

                    const removeBtn = document.querySelector('button[aria-label="Remove media"]');
                    const imgPreview = document.querySelector('[data-testid="attachments"] img');

                    return {
                      hasCropTitle: !!cropTitle,
                      hasApplyButton: !!applyButton,
                      hasAltDialog: !!altDialog,
                      hasSaveButton: saveButtons.length > 0,
                      hasImage: !!(removeBtn || imgPreview),
                      saveButtonTexts: saveButtons.map(b => b.textContent?.trim())
                    };
                  });

                  // Handle crop dialog first
                  if (dialogInfo.hasCropTitle || dialogInfo.hasApplyButton) {
                    log('Crop dialog detected, clicking Apply to preserve aspect ratio...');

                    // Try the testid button first (most reliable)
                    if (dialogInfo.hasApplyButton) {
                      const clicked = await humanizedClick(page, '[data-testid="applyMediaEditsButton"]', { moveFirst: true });
                      if (clicked) {
                        log('Clicked Apply - aspect ratio preserved');
                        cropDialogHandled = true;
                        await humanPause('long'); // Wait longer for dialog to fully close
                        continue;
                      }
                    }

                    // Fallback: click Apply button via evaluate
                    const clickedApply = await page.evaluate(() => {
                      const buttons = Array.from(document.querySelectorAll('button'));
                      for (let i = 0; i < buttons.length; i++) {
                        const text = buttons[i].textContent?.trim();
                        if (text === 'Apply') {
                          (buttons[i] as HTMLButtonElement).click();
                          return true;
                        }
                      }
                      return false;
                    });

                    if (clickedApply) {
                      log('Crop dialog Apply button clicked via evaluate');
                      cropDialogHandled = true;
                      await humanPause('long');
                      continue;
                    }
                  }

                  // Handle ALT text dialog (skip it)
                  if (dialogInfo.hasAltDialog) {
                    log('ALT text dialog detected, clicking Skip/Done to dismiss...');

                    const dismissed = await page.evaluate(() => {
                      const buttons = Array.from(document.querySelectorAll('button'));
                      for (let i = 0; i < buttons.length; i++) {
                        const text = buttons[i].textContent?.trim();
                        // Skip ALT text entry
                        if (text === 'Skip' || text === 'Done' || text === 'Save') {
                          (buttons[i] as HTMLButtonElement).click();
                          return text;
                        }
                      }
                      return null;
                    });

                    if (dismissed) {
                      log(`ALT dialog dismissed via ${dismissed} button`);
                      altDialogHandled = true;
                      await humanPause('long'); // Wait for dialog to close
                      continue;
                    }
                  }

                  // Check for image thumbnail (upload complete, not in dialog)
                  if (dialogInfo.hasImage && !dialogInfo.hasCropTitle && !dialogInfo.hasAltDialog) {
                    log(`Image upload complete (crop=${cropDialogHandled}, alt=${altDialogHandled})`);
                    break;
                  }

                  if (i === 29) {
                    log('Image upload timeout, proceeding anyway', 'WARN');
                  }
                }

              // CRITICAL: Wait longer for Twitter to finish processing the upload on their servers
              // Even though we see the thumbnail, Twitter may still be processing in the background
              log('Waiting additional time for Twitter to finish processing image upload...');
              await humanPause('long');
              await humanPause('long'); // Extra wait to ensure upload is FULLY complete

              // Cleanup temp file
              await fs.unlink(tempPath).catch(() => {});
            } catch (mediaError: any) {
              log(`Media upload failed: ${mediaError.message}, continuing without image`, 'WARN');
            }
          }

          await humanPause('medium');

          // STRATEGIC SCREENSHOT #1: Capture state before dialog detection
          // This helps us see exactly what dialogs are present when we make dismissal decisions
          const preDialogCheckScreenshot = `/tmp/pre_dialog_check_${Date.now()}.png`;
          await page.screenshot({ path: preDialogCheckScreenshot, fullPage: false });
          log(`[SCREENSHOT] Before dialog check: ${preDialogCheckScreenshot}`);

          // FINAL CHECK: Make sure no BLOCKING dialogs are still open before sending
          // NOTE: The reply compose modal itself has [role="dialog"], so we need to be careful
          // to only detect actual blocking dialogs (ALT text, Crop, etc.), not the modal itself
          log('Final check for any blocking dialogs (ALT/Crop) before sending...');
          const finalDialogCheck = await page.evaluate(() => {
            const allText = document.body.innerText || '';
            const hasCrop = allText.includes('Crop');
            const hasALT = (allText.includes('ALT') || allText.includes('Add description')) &&
                           allText.includes('image'); // Must have both ALT and 'image' to be an ALT dialog

            // Get all dialogs and analyze them
            const dialogs = document.querySelectorAll('[role="dialog"]');
            const dialogDetails = Array.from(dialogs).map(dialog => {
              const text = (dialog.textContent || '').substring(0, 300);
              const ariaLabel = dialog.getAttribute('aria-label') || '';
              const testId = dialog.getAttribute('data-testid') || '';

              // Identify dialog types
              const isComposeModal = text.includes('Post text') || ariaLabel.includes('Post') || testId.includes('compose');
              const isDrafts = text.includes('Drafts') || ariaLabel.includes('Drafts');
              const isALT = text.includes('ALT') && text.includes('image');
              const isCrop = text.includes('Crop');

              return { text, ariaLabel, testId, isComposeModal, isDrafts, isALT, isCrop };
            });

            // Only count BLOCKING dialogs (ALT, Crop) - ignore compose modal and Drafts
            const blockingDialogs = dialogDetails.filter(d => d.isALT || d.isCrop);

            return {
              hasCrop,
              hasALT,
              totalDialogs: dialogs.length,
              blockingDialogCount: blockingDialogs.length,
              blockingDialogs,
              sample: allText.substring(0, 200)
            };
          });

          // ONLY dismiss if there are actual BLOCKING dialogs (ALT/Crop), not just the compose modal
          if (finalDialogCheck.hasCrop || finalDialogCheck.hasALT || finalDialogCheck.blockingDialogCount > 0) {
            log(`WARNING: Blocking dialog detected! crop=${finalDialogCheck.hasCrop}, alt=${finalDialogCheck.hasALT}, blocking=${finalDialogCheck.blockingDialogCount}`, 'WARN');
            log(`Page text sample: ${finalDialogCheck.sample}`, 'WARN');
            log(`Blocking dialog details: ${JSON.stringify(finalDialogCheck.blockingDialogs, null, 2)}`, 'WARN');

            // CRITICAL FIX: Only click buttons that are INSIDE blocking dialogs (ALT/Crop)
            // DO NOT click the "Close" button from the compose modal itself (testId="app-bar-close")
            const dismissed = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button'));

              // ONLY target buttons for ALT/Crop dialogs - use specific keywords
              const dismissTexts = ['Skip', 'Done', 'Apply', 'Save', 'Not now'];

              // First try exact matches for ALT/Crop dialog buttons
              for (const btn of buttons) {
                const text = btn.textContent?.trim();
                const ariaLabel = btn.getAttribute('aria-label');
                const testId = btn.getAttribute('data-testid') || '';

                // CRITICAL: Skip the compose modal's close button
                if (testId === 'app-bar-close') {
                  continue; // This closes the ENTIRE modal - skip it!
                }

                if (dismissTexts.some(dt => text === dt || ariaLabel?.includes(dt))) {
                  (btn as HTMLButtonElement).click();
                  return text || ariaLabel || 'button';
                }
              }

              return null;
            });

            if (dismissed) {
              log(`Dismissed blocking dialog with "${dismissed}" button`);
              await humanPause('long');

              // STRATEGIC SCREENSHOT #2.5: After dialog dismissal, verify compose modal is still open
              const postDismissScreenshot = `/tmp/post_dialog_dismiss_${Date.now()}.png`;
              await page.screenshot({ path: postDismissScreenshot, fullPage: false });
              log(`[SCREENSHOT] After dismissing blocking dialog: ${postDismissScreenshot}`);
            } else {
              // If we couldn't find a dismiss button, try Escape key ONCE for ALT/Crop dialogs
              log('No dismiss button found, trying Escape key for blocking dialogs...');
              await page.keyboard.press('Escape');
              await humanPause('medium');

              // STRATEGIC SCREENSHOT #2.5: After Escape key, verify compose modal is still open
              const postEscapeScreenshot = `/tmp/post_escape_${Date.now()}.png`;
              await page.screenshot({ path: postEscapeScreenshot, fullPage: false });
              log(`[SCREENSHOT] After Escape key: ${postEscapeScreenshot}`);
            }
          } else {
            log(`No blocking dialogs detected (total dialogs: ${finalDialogCheck.totalDialogs}, but all are harmless compose/drafts)`);
          }

          // Humanized send button click sequence with adaptive selectors
          log(`[${BUILD_ID}] Starting humanized send button click sequence`);
          await humanPause('short');

          // Pre-click mouse wander to look natural
          await randomMouseWander(page);

          // Get the text content before clicking to compare later (use adaptive selector)
          const textBefore = await page.$eval(usedInputSelector, el => el.textContent || '').catch(() => '');
          log(`Text before send: "${textBefore.substring(0, 30)}..."`);

          // STRATEGIC SCREENSHOT #2: Capture state before send button check
          // This verifies that the reply text is still present in the compose box
          const preSendScreenshot = `/tmp/pre_send_check_${Date.now()}.png`;
          await page.screenshot({ path: preSendScreenshot, fullPage: false });
          log(`[SCREENSHOT] Before send button check (text length: ${textBefore.length}): ${preSendScreenshot}`);

          // PRE-SEND STATE CHECK: Verify send button exists and is enabled
          // FIX #1: Increased timeout from 5s to 15s for media upload processing
          const sendButtonCheck = await findElementWithState(page, SELECTORS.sendButton, {
            mustBeVisible: true,
            mustBeEnabled: true,
            timeout: 15000  // Increased from 5000ms to handle media processing delays
          });

          if (!sendButtonCheck.found) {
            // Button might be disabled because text wasn't entered - capture diagnostics
            log('Send button not found or disabled - capturing diagnostics', 'WARN');
            await captureDiagnostics(page, 'send_button_not_ready');

            // Try waiting longer for button to become enabled
            await humanPause('long');
            const retryCheck = await findElementWithState(page, SELECTORS.sendButton, {
              mustBeVisible: true,
              mustBeEnabled: true,
              timeout: 5000
            });

            if (!retryCheck.found) {
              throw new Error('Send button not available or disabled');
            }
          }

          log(`Send button ready: ${sendButtonCheck.selector} (enabled=${sendButtonCheck.state.enabled})`);

          // Check if image is attached
          const hasImage = !!params.mediaUrl;

          let textAfter = '';
          let success = false;

          // NETWORK INTERCEPTION: Capture the new tweet ID from GraphQL response
          let capturedTweetId: string | undefined;
          let responseListener: ((response: any) => void) | undefined;

          const setupNetworkInterception = () => {
            // Also listen to requests to see if CreateTweet is being sent
            const requestListener = async (request: any) => {
              try {
                const url = request.url();
                if (url.includes('/graphql/') && url.includes('CreateTweet')) {
                  log(`[NetworkIntercept] CreateTweet REQUEST detected! Method: ${request.method()}`);
                  const postData = request.postData();
                  if (postData) {
                    log(`[NetworkIntercept] Request payload (first 500 chars): ${postData.substring(0, 500)}`);
                  }
                }
              } catch (err: any) {
                log(`[NetworkIntercept] Error processing request: ${err.message}`, 'ERROR');
              }
            };

            responseListener = async (response: any) => {
              try {
                const url = response.url();
                const status = response.status();

                // Log ALL GraphQL requests to see what's happening
                if (url.includes('/graphql/')) {
                  const operation = url.split('/graphql/').pop()?.split('?')[0] || 'unknown';
                  log(`[NetworkIntercept] GraphQL ${operation}: status=${status}`);
                }

                // Only process successful GraphQL CreateTweet responses
                // Match specific endpoint pattern: /graphql/{queryId}/CreateTweet
                if (status === 200 && url.includes('/graphql/') && url.includes('CreateTweet')) {
                  log(`[NetworkIntercept] Found CreateTweet response! Parsing...`);
                  // Use buffer() instead of text() to avoid consuming the response body
                  // Puppeteer captures at protocol level, so this should be safe
                  const buffer = await response.buffer().catch(() => null);
                  if (buffer) {
                    try {
                      const json = JSON.parse(buffer.toString());
                      log(`[NetworkIntercept] CreateTweet response parsed: ${JSON.stringify(json).substring(0, 500)}...`);

                      // Only extract ID if the response contains create_tweet data
                      if (json?.data?.create_tweet?.tweet_results?.result) {
                        const result = json.data.create_tweet.tweet_results.result;
                        const tweetId = result.rest_id || result.tweet?.rest_id;

                        if (tweetId && !capturedTweetId) {
                          capturedTweetId = tweetId;
                          log(`[NetworkIntercept] Captured new tweet ID: ${tweetId}`);
                        }
                      } else if (json?.errors) {
                        log(`[NetworkIntercept] CreateTweet returned errors: ${JSON.stringify(json.errors)}`, 'ERROR');
                      } else {
                        log(`[NetworkIntercept] CreateTweet response missing expected data structure`, 'WARN');
                      }
                    } catch (parseErr: any) {
                      log(`[NetworkIntercept] Failed to parse CreateTweet response: ${parseErr.message}`, 'ERROR');
                    }
                  }
                }
              } catch (err: any) {
                log(`[NetworkIntercept] Error processing response: ${err.message}`, 'ERROR');
              }
            };

            page.on('request', requestListener);
            page.on('response', responseListener);
            log('[NetworkIntercept] Listening for CreateTweet requests and responses...');
          };

          const cleanupNetworkInterception = () => {
            if (responseListener) {
              page.off('response', responseListener);
              log(`[NetworkIntercept] Cleanup complete. Captured ID: ${capturedTweetId || 'none'}`);
            }
          };

          // Start listening before any send attempts
          setupNetworkInterception();

          try {
          // Helper function to check if send was successful
          const checkSendSuccess = async (): Promise<boolean> => {
            // Check if composer is gone or empty
            const textNow = await page.$eval(usedInputSelector, el => el.textContent || '').catch(() => 'GONE');

            // Also check if modal/overlay closed
            const composerGone = await page.evaluate(() => {
              const layers = document.querySelectorAll('[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]');
              return layers.length === 0;
            }).catch(() => true);

            return textNow === '' || textNow === 'GONE' || composerGone || textNow !== textBefore;
          };

          // NEW: Wait for send button to be truly ready before clicking
          log('Waiting for send button to be ready...');
          const buttonReady = await waitForSendButtonReady(page);
          if (!buttonReady) {
            throw new Error('Send button never became ready after 15 seconds');
          }
          log('Send button is ready! Proceeding to click...');

          // Use REAL mouse click instead of JavaScript click to avoid detection
          // Twitter's anti-bot can detect element.click() but not real mouse events
          let clicked = { clicked: false, selector: null as string | null };
          for (const selector of SELECTORS.sendButton) {
            try {
              const button = await page.$(selector);
              if (button) {
                // Use Puppeteer's real click (simulates actual mouse movement and click)
                await button.click();
                clicked = { clicked: true, selector };
                log(`Send button clicked with REAL mouse: ${selector}`);
                break;
              }
            } catch (e: any) {
              log(`Could not click ${selector}: ${e.message}`, 'WARN');
            }
          }

          if (!clicked.clicked) {
            throw new Error('Could not click send button with any selector');
          }

          log(`Send button clicked: ${JSON.stringify(clicked)}`);

          // Wait for UI confirmation (composer closes) - increased wait time
          log('Waiting 5 seconds for Twitter to process...');
          await sleep(5000);
          success = await checkSendSuccess();
          textAfter = await page.$eval(usedInputSelector, el => el.textContent || '').catch(() => 'GONE');
          log(`After click: text="${textAfter.substring(0, 20)}", success=${success}`);

          // Check for Twitter error messages in the UI
          const errorMessage = await page.evaluate(() => {
            // Common error message selectors - but NOT the Drafts sidebar
            const errorSelectors = [
              '[data-testid="toast"]',
              '[data-testid="error-detail"]',
              '.r-1oszu61', // Twitter's error toast class
            ];

            for (const selector of errorSelectors) {
              const errorEl = document.querySelector(selector);
              if (errorEl?.textContent) {
                const text = errorEl.textContent.trim();
                // Ignore Drafts sidebar (it has role="alert" but isn't an error)
                if (text.includes('Drafts') && text.length > 100) {
                  continue;
                }
                return text;
              }
            }
            return null;
          }).catch(() => null);

          if (errorMessage) {
            log(`[UI ERROR DETECTED] Twitter showed error: "${errorMessage}"`, 'ERROR');

            // If it's the media crop/ALT error, check if tweet actually posted despite the warning
            if (errorMessage.includes('Crop') || errorMessage.includes('media') || errorMessage.includes('ALT')) {
              log('Media warning detected - but checking if tweet actually posted...', 'WARN');

              // Try to click any close/dismiss buttons
              const dismissed = await page.evaluate(() => {
                // Look for close buttons
                const closeButtons = Array.from(document.querySelectorAll('button'));
                for (const btn of closeButtons) {
                  const ariaLabel = btn.getAttribute('aria-label');
                  const text = btn.textContent?.trim();
                  if (ariaLabel?.includes('Close') || text === 'Close' || text === 'Cancel' || ariaLabel?.includes('Dismiss')) {
                    (btn as HTMLButtonElement).click();
                    return true;
                  }
                }
                return false;
              }).catch(() => false);

              if (dismissed) {
                log('Dismissed media warning toast', 'WARN');
              }

              // CRITICAL FIX: Don't throw error if composer closed (success=true)
              // The "Crop mediaSaveALT" is often just a transient warning, not a true failure
              // If text was cleared, the tweet likely posted successfully
              if (success) {
                log('Composer closed (text cleared) - treating as successful despite warning toast', 'WARN');
                // Don't throw - let the function continue to verify the tweet posted
              } else {
                // Composer still open - this is a real failure
                throw new Error(`Twitter media error: ${errorMessage}`);
              }
            }
          }

          // Take screenshot
          const fs = await import('fs/promises');
          const screenshotPath = `/tmp/after_send_${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath, fullPage: false });
          log(`Screenshot saved: ${screenshotPath}`);

          if (!success) {
            log('All methods tried - checking if reply posted anyway...', 'WARN');
          }

          await sleep(1000);

          } finally {
            // Cleanup network interception on all exit paths
            cleanupNetworkInterception();
          }

          // After posting, determine the new reply ID
          // Priority: Network interception > URL change > Snapshot comparison > Profile check

          let newReplyId: string | undefined;
          let newReplyUrl: string | undefined;

          // PRIMARY METHOD: Use network-intercepted tweet ID (most reliable)
          if (capturedTweetId) {
            // NEW: Verify the captured tweet ID actually exists via TwitterAPI.io
            const verified = await verifyTweetExists(capturedTweetId);
            if (verified) {
              newReplyId = capturedTweetId;
              newReplyUrl = `https://x.com/i/status/${capturedTweetId}`;
              log(`[NetworkIntercept] Using VERIFIED captured tweet ID: ${newReplyUrl}`);
              postedRepliesCache.add(duplicateKey);
            } else {
              log(`[NetworkIntercept] Captured tweet ID ${capturedTweetId} does NOT exist - discarding`, 'WARN');
              // Will fall through to snapshot method
            }
          }

          // FALLBACK METHODS: Only run if network interception didn't capture the ID
          const currentUrl = page.url();
          const currentIdMatch = currentUrl.match(/status\/(\d+)/);

          if (!newReplyId) {
            // FALLBACK 1: Check if URL changed (sometimes Twitter navigates to the reply)
            if (currentIdMatch && !currentUrl.includes('/compose/')) {
              const originalTweetId = params.tweetUrl?.match(/status\/(\d+)/)?.[1] || params.tweetId;
              if (currentIdMatch[1] !== originalTweetId) {
                newReplyId = currentIdMatch[1];
                newReplyUrl = `https://x.com/i/status/${newReplyId}`;
                log(`Found reply via URL change: ${newReplyUrl}`);
                postedRepliesCache.add(duplicateKey);
              }
            }
          }

          if (!newReplyId) {
            // FALLBACK 2: SNAPSHOT COMPARISON - Find truly NEW reply by comparing to pre-send snapshot
            try {
              // Wait a bit for the reply to appear in the UI
              await sleep(2000);

              // Capture current reply IDs
              const currentReplyIds = await page.$$eval('article[data-testid="tweet"] a[href*="/status/"]', links => {
                const ids = new Set<string>();
                links.forEach(link => {
                  const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
                  if (match) ids.add(match[1]);
                });
                return Array.from(ids);
              }).catch(() => [] as string[]);

              log(`Post-send check: ${currentReplyIds.length} tweets visible (was ${existingReplyIds.length})`);

              // Find NEW IDs that weren't in the snapshot
              const originalTweetId = params.tweetUrl?.match(/status\/(\d+)/)?.[1] || params.tweetId;
              const newIds = currentReplyIds.filter(id =>
                !existingReplyIds.includes(id) && id !== originalTweetId
              );

              if (newIds.length > 0) {
                // Found a genuinely new tweet - this is our reply!
                newReplyId = newIds[0];
                newReplyUrl = `https://x.com/i/status/${newReplyId}`;
                log(`Found NEW reply via snapshot diff: ${newReplyUrl}`);

                // Add to duplicate cache to prevent future duplicates
                postedRepliesCache.add(duplicateKey);
              } else {
                // No new tweets found yet - wait and try again (Twitter may be slow to update)
                log('No new tweet IDs found on first check - waiting and retrying...');

                // Wait for compose modal to close and page to update
                await sleep(2000);

                // If still on compose page, go back to the original tweet
                const checkUrl = page.url();
                if (checkUrl.includes('/compose/')) {
                  log('Still on compose page, navigating back to tweet...');
                  const tweetUrl = params.tweetUrl || `https://x.com/i/status/${params.tweetId}`;
                  await page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                  await sleep(2000);
                }

                // Try snapshot comparison again
                const retryReplyIds = await page.$$eval('article[data-testid="tweet"] a[href*="/status/"]', links => {
                  const ids = new Set<string>();
                  links.forEach(link => {
                    const match = link.getAttribute('href')?.match(/\/status\/(\d+)/);
                    if (match) ids.add(match[1]);
                  });
                  return Array.from(ids);
                }).catch(() => [] as string[]);

                const retryNewIds = retryReplyIds.filter(id =>
                  !existingReplyIds.includes(id) && id !== originalTweetId
                );

                if (retryNewIds.length > 0) {
                  newReplyId = retryNewIds[0];
                  newReplyUrl = `https://x.com/i/status/${newReplyId}`;
                  log(`Found NEW reply on retry: ${newReplyUrl}`);
                  postedRepliesCache.add(duplicateKey);
                } else {
                  // Last resort: check user's profile for their most recent tweet
                  log('Still no new tweets in thread - checking user profile for recent activity...');

                  const username = params.username?.replace('@', '') || '';
                  if (username) {
                    try {
                      await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
                      await sleep(2000);

                      // Get tweets from user's profile that are REPLIES (have "Replying to" text)
                      const profileReplyInfo = await page.$$eval('article[data-testid="tweet"]', articles => {
                        const replies: { id: string; timestamp: number }[] = [];
                        articles.forEach(article => {
                          // Check if this tweet has "Replying to" indicator
                          const replyingTo = article.querySelector('[dir="ltr"] span');
                          const isReply = replyingTo?.textContent?.includes('Replying to');
                          if (isReply) {
                            // Extract tweet ID from link
                            const link = article.querySelector('a[href*="/status/"]');
                            const match = link?.getAttribute('href')?.match(/\/status\/(\d+)/);
                            // Get timestamp for sorting
                            const timeEl = article.querySelector('time');
                            const timestamp = timeEl ? new Date(timeEl.getAttribute('datetime') || '').getTime() : 0;
                            if (match) {
                              replies.push({ id: match[1], timestamp });
                            }
                          }
                        });
                        return replies;
                      }).catch(() => [] as { id: string; timestamp: number }[]);

                      // Filter to only NEW replies (not in original snapshot)
                      const profileNewReplies = profileReplyInfo
                        .filter(r => !existingReplyIds.includes(r.id) && r.id !== originalTweetId)
                        .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

                      if (profileNewReplies.length > 0) {
                        newReplyId = profileNewReplies[0].id;
                        newReplyUrl = `https://x.com/i/status/${newReplyId}`;
                        log(`Found NEW reply from user profile: ${newReplyUrl} (timestamp: ${new Date(profileNewReplies[0].timestamp).toISOString()})`);
                        postedRepliesCache.add(duplicateKey);
                      } else {
                        log('No new REPLIES found on user profile - tweet may not have posted', 'WARN');
                      }
                    } catch (profileError: any) {
                      log(`Could not check user profile: ${profileError.message}`, 'WARN');
                    }
                  }
                }
              }

              // If compose box still had text, it's a true failure
              if (!newReplyId && textAfter && textAfter !== '' && textAfter !== 'GONE') {
                log('Compose box still has text - reply NOT sent (likely duplicate content blocked)', 'WARN');
              }
            } catch (e: any) {
              log(`Could not extract new reply ID: ${e.message}`, 'WARN');
            }
          }

          // CRITICAL: Only return success if we have PROOF the reply was posted
          // We MUST have a new reply ID - don't accept fallback URLs
          if (!newReplyId) {
            log(`Reply FAILED - no new reply ID found (text cleared: ${success})`, 'ERROR');

            // Capture comprehensive diagnostics on failure
            await captureDiagnostics(page, 'send_failed');

            throw new Error('Reply not posted - no new reply ID captured despite send');
          }

          // We have a verified new reply ID
          const finalReplyUrl = newReplyUrl || `https://x.com/i/status/${newReplyId}`;
          const finalReplyId = newReplyId;

          log(`Reply posted successfully: ${finalReplyUrl}`);

          result.replySuccess = true;
          result.replyUrl = finalReplyUrl;
          result.replyId = finalReplyId;

        } catch (replyError: any) {
          log(`Reply failed: ${replyError.message}`, 'ERROR');
          result.replyError = replyError.message;
          
          // If reply fails with network error, bubble it up
          const isNetworkError = replyError.message?.includes('ERR_TUNNEL') ||
                                 replyError.message?.includes('ERR_PROXY') ||
                                 replyError.message?.includes('net::') ||
                                 replyError.message?.includes('Navigation timeout');
          if (isNetworkError) {
            throw replyError;
          }
          
          // Reply failed but not network error - still try the like
        }

        // === STEP 2: LIKE THE TWEET (same session, tunnel stays warm) ===
        log(`=== LIKE STEP STARTING ===`);
        try {
          // ALWAYS navigate to the target tweet to ensure we're on the right page
          // After posting a reply, the DOM might be focused on the new reply even if URL looks right
          const targetTweetUrl = `https://x.com/i/status/${params.tweetId}`;
          log(`Like step - navigating to target tweet: ${targetTweetUrl}`);
          await page.goto(targetTweetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(2000);
          log(`Like step - now on: ${page.url()}`);

          // If like needs different user, swap cookies
          if (params.likeCookie && params.likeCookie !== params.twitterCookie) {
            log(`Switching to @${params.likeUsername} for like...`);
            await browserManager.setCookies(page, params.likeCookie);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await sleep(2000);
          }

          log('Looking for like button...');
          const likeButton = await page.$('button[data-testid="like"]');
          if (!likeButton) {
            log('Like button not found, checking for unlike button (already liked)...');
            const unlikeButton = await page.$('button[data-testid="unlike"]');
            if (unlikeButton) {
              log('Tweet already liked');
              result.likeSuccess = true;
            } else {
              log('Neither like nor unlike button found!', 'ERROR');
              throw new Error('Could not find like button');
            }
          } else {
            log('Found like button, clicking...');
            await likeButton.click();
            await sleep(1000);
            result.likeSuccess = true;
            log('Tweet liked successfully');
          }

        } catch (likeError: any) {
          log(`Like failed: ${likeError.message}`, 'ERROR');
          result.likeError = likeError.message;
        }
        log(`=== LIKE STEP COMPLETE: success=${result.likeSuccess} ===`);

        return result;

      } catch (error: any) {
        log(`Error in postReplyAndLike: ${error.message}`, 'ERROR');
        
        // Let network errors bubble up for retry
        const isNetworkError = error.message?.includes('ERR_TUNNEL') ||
                               error.message?.includes('ERR_PROXY') ||
                               error.message?.includes('net::') ||
                               error.message?.includes('Navigation timeout');
        
        if (isNetworkError) {
          throw error;
        }
        
        return result;
      }
    }, params.username, 3);
  }

  async sendDm(params: DmParams): Promise<DmResult> {
    const groupChatId = params.groupChatId || '1969047827406831927';
    log(`Sending DM to group ${groupChatId}`);

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = params.message.match(urlRegex) || [];
    const messages = urls.length > 0 ? urls : [params.message];

    return browserManager.executeTask(async (page: Page) => {
      const sentMessages: string[] = [];
      
      try {
        await browserManager.setCookies(page, params.twitterCookie);
        
        await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        const isLoggedIn = await page.$('a[data-testid="AppTabBar_Home_Link"]') || 
                          await page.$('a[aria-label="Home"]');
        if (!isLoggedIn) {
          throw new Error('Cookie authentication failed - not logged in');
        }
        log('Successfully authenticated for DM');

        await page.goto(`https://x.com/messages/${groupChatId}`, { waitUntil: 'domcontentloaded' });
        await sleep(2000);

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          log(`Sending DM ${i + 1}/${messages.length}: "${msg.substring(0, 50)}..."`);

          const inputSelectors = [
            'div[data-testid="dmComposerTextInput"]',
            'div[contenteditable="true"][role="textbox"]'
          ];

          let found = false;
          for (const sel of inputSelectors) {
            try {
              await page.waitForSelector(sel, { visible: true, timeout: 5000 });
              await humanTypeText(page, sel, msg, 50, 150);
              found = true;
              break;
            } catch (e) { continue; }
          }

          if (!found) {
            throw new Error('Could not find message input field');
          }

          await sleep(randomDelay(1000, 3000));

          const sendButton = await page.$('button[data-testid="dmComposerSendButton"]');
          if (!sendButton) {
            throw new Error('Could not find send button');
          }

          await sendButton.click();
          await sleep(2000);

          sentMessages.push(msg);
          log(`Message ${i + 1} sent successfully`);

          if (i < messages.length - 1) {
            await sleep(randomDelay(2000, 4000));
          }
        }

        log(`All ${sentMessages.length} DMs sent successfully`);

        return {
          success: true,
          totalSent: sentMessages.length,
          messages: sentMessages
        };

      } catch (error: any) {
        log(`Error sending DM: ${error.message}`, 'ERROR');
        return {
          success: false,
          totalSent: sentMessages.length,
          messages: sentMessages,
          error: error.message
        };
      }
    }, params.username);
  }

  async testConnection(): Promise<{ success: boolean; proxyIp?: string; error?: string }> {
    log('Testing browser and proxy connection...');
    
    return browserManager.executeTask(async (page: Page) => {
      try {
        await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 15000 });
        const content = await page.content();
        const ipMatch = content.match(/"ip"\s*:\s*"([^"]+)"/);
        const proxyIp = ipMatch?.[1] || 'unknown';
        
        log(`Connection test successful. IP: ${proxyIp}`);
        
        return {
          success: true,
          proxyIp
        };
      } catch (error: any) {
        log(`Connection test failed: ${error.message}`, 'ERROR');
        return {
          success: false,
          error: error.message
        };
      }
    });
  }

  async retweet(params: RetweetParams): Promise<RetweetResult> {
    log(`Retweeting: ${params.tweetUrl}`);
    
    return browserManager.executeTask(async (page: Page) => {
      try {
        await browserManager.setCookies(page, params.twitterCookie);
        
        await page.goto('https://x.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        const isLoggedIn = await page.$('a[data-testid="AppTabBar_Home_Link"]') || 
                          await page.$('a[aria-label="Home"]');
        if (!isLoggedIn) {
          throw new Error('Cookie authentication failed - not logged in');
        }

        await page.goto(params.tweetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);

        const retweetButton = await page.$('button[data-testid="retweet"]');
        if (!retweetButton) {
          const unretweetButton = await page.$('button[data-testid="unretweet"]');
          if (unretweetButton) {
            log('Tweet already retweeted');
            return { success: true };
          }
          throw new Error('Could not find retweet button');
        }

        await retweetButton.click();
        await sleep(1000);

        const confirmRetweet = await page.$('div[data-testid="retweetConfirm"]');
        if (confirmRetweet) {
          await confirmRetweet.click();
          await sleep(1000);
        }

        log('Tweet retweeted successfully');
        return { success: true };

      } catch (error: any) {
        log(`Error retweeting: ${error.message}`, 'ERROR');
        return {
          success: false,
          error: error.message
        };
      }
    }, params.username);
  }

  async getRecentTweetFromFollowing(params: { twitterCookie: string; username?: string }): Promise<GetFollowingTweetsResult> {
    log(`Getting recent tweets from following for @${params.username || 'unknown'}`);
    
    return browserManager.executeTask(async (page: Page) => {
      try {
        await browserManager.setCookies(page, params.twitterCookie);
        
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);

        const isLoggedIn = await page.$('a[data-testid="AppTabBar_Home_Link"]') || 
                          await page.$('a[aria-label="Home"]');
        if (!isLoggedIn) {
          throw new Error('Cookie authentication failed - not logged in');
        }

        // Click on "Following" tab to ensure we only see tweets from followed accounts
        // The Following tab is typically the second tab on the home timeline
        const followingTab = await page.$('a[href="/home"][role="tab"]:nth-of-type(2)') ||
                            await page.$('div[role="tablist"] a:nth-child(2)');
        if (followingTab) {
          await followingTab.click();
          await sleep(2000);
          log('Switched to Following tab');
        } else {
          // Alternative: try clicking text that says "Following"
          const tabs = await page.$$('a[role="tab"]');
          for (const tab of tabs) {
            const text = await tab.evaluate((el: Element) => el.textContent);
            if (text && text.toLowerCase().includes('following')) {
              await tab.click();
              await sleep(2000);
              log('Switched to Following tab via text match');
              break;
            }
          }
        }

        await sleep(2000);

        const tweets: FollowingTweet[] = [];
        
        const tweetArticles = await page.$$('article[data-testid="tweet"]');
        
        for (let i = 0; i < Math.min(tweetArticles.length, 10); i++) {
          try {
            const article = tweetArticles[i];
            
            const linkElements = await article.$$('a[href*="/status/"]');
            let tweetUrl = '';
            for (const link of linkElements) {
              const href = await link.evaluate((el: Element) => el.getAttribute('href'));
              if (href && href.includes('/status/') && !href.includes('/analytics')) {
                tweetUrl = `https://x.com${href}`;
                break;
              }
            }
            
            const userLink = await article.$('a[href^="/"][role="link"]');
            let authorHandle = '';
            if (userLink) {
              const href = await userLink.evaluate((el: Element) => el.getAttribute('href'));
              if (href && href.startsWith('/') && !href.includes('/status/')) {
                authorHandle = href.replace('/', '');
              }
            }
            
            const tweetTextEl = await article.$('div[data-testid="tweetText"]');
            let content = '';
            if (tweetTextEl) {
              content = await tweetTextEl.evaluate((el: Element) => el.textContent || '');
            }
            
            if (tweetUrl && authorHandle) {
              tweets.push({ tweetUrl, authorHandle, content: content.substring(0, 200) });
            }
          } catch (e) {
            continue;
          }
        }

        log(`Found ${tweets.length} tweets from timeline`);
        return { success: true, tweets };

      } catch (error: any) {
        log(`Error getting timeline tweets: ${error.message}`, 'ERROR');
        return {
          success: false,
          tweets: [],
          error: error.message
        };
      }
    }, params.username);
  }

  getStats() {
    return browserManager.getStats();
  }
}

export const twitterAutomation = new TwitterAutomationService();
// Force reload Tue Dec 23 09:24:45 AM UTC 2025
