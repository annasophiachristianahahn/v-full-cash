import { Page, ElementHandle } from 'puppeteer';

const log = (message: string, level: string = 'INFO') => {
  console.log(`[${new Date().toISOString()}] [HumanBehavior] [${level}] ${message}`);
};

export const randomDelay = (min: number, max: number): number => 
  Math.floor(Math.random() * (max - min + 1)) + min;

export const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

export async function typeLikeHuman(
  page: Page, 
  selector: string, 
  text: string,
  options: { minDelay?: number; maxDelay?: number; typoChance?: number } = {}
): Promise<void> {
  const { minDelay = 30, maxDelay = 150, typoChance = 0.02 } = options;
  
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.click(selector);
  await sleep(randomDelay(100, 300));
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (Math.random() < typoChance && i < text.length - 1) {
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + randomDelay(-2, 2));
      await page.keyboard.type(wrongChar);
      await sleep(randomDelay(50, 150));
      await page.keyboard.press('Backspace');
      await sleep(randomDelay(30, 100));
    }
    
    await page.keyboard.type(char);
    
    if (char === ' ') {
      await sleep(randomDelay(minDelay * 1.5, maxDelay * 1.5));
    } else if (char === '.' || char === ',' || char === '!' || char === '?') {
      await sleep(randomDelay(minDelay * 2, maxDelay * 2));
    } else {
      await sleep(randomDelay(minDelay, maxDelay));
    }
  }
  
  log(`Typed ${text.length} chars with human-like delays (${minDelay}-${maxDelay}ms)`);
}

export async function typeDirectlyLikeHuman(
  page: Page,
  text: string,
  options: { minDelay?: number; maxDelay?: number } = {}
): Promise<void> {
  const { minDelay = 30, maxDelay = 150 } = options;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await page.keyboard.type(char);
    
    if (char === ' ') {
      await sleep(randomDelay(minDelay * 1.5, maxDelay * 1.5));
    } else if (char === '.' || char === ',' || char === '!' || char === '?') {
      await sleep(randomDelay(minDelay * 2, maxDelay * 2));
    } else {
      await sleep(randomDelay(minDelay, maxDelay));
    }
  }
}

export async function moveMouseLikeHuman(
  page: Page,
  targetX: number,
  targetY: number,
  options: { steps?: number; jitter?: number } = {}
): Promise<void> {
  const { steps = 10, jitter = 5 } = options;
  
  const viewport = page.viewport();
  if (!viewport) return;
  
  let currentX = Math.random() * viewport.width;
  let currentY = Math.random() * viewport.height;
  
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    
    const nextX = currentX + (targetX - currentX) * easeProgress + randomDelay(-jitter, jitter);
    const nextY = currentY + (targetY - currentY) * easeProgress + randomDelay(-jitter, jitter);
    
    await page.mouse.move(nextX, nextY);
    await sleep(randomDelay(5, 20));
    
    currentX = nextX;
    currentY = nextY;
  }
  
  await page.mouse.move(targetX, targetY);
}

export async function humanizedClick(
  page: Page,
  selector: string,
  options: { moveFirst?: boolean; scrollFirst?: boolean } = {}
): Promise<boolean> {
  const { moveFirst = true, scrollFirst = false } = options;
  
  try {
    const element = await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    if (!element) {
      log(`Element not found: ${selector}`, 'WARN');
      return false;
    }
    
    // Always scroll element into view to ensure valid click coordinates
    await element.evaluate((el) => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    await sleep(randomDelay(150, 350)); // Wait for scroll to complete
    
    const box = await element.boundingBox();
    if (!box) {
      log(`Could not get bounding box for: ${selector}`, 'WARN');
      return false;
    }
    
    // Validate coordinates are within viewport - use fallback if not
    const viewport = page.viewport();
    if (viewport && (box.y < 0 || box.y > viewport.height)) {
      log(`Element ${selector} outside viewport (y=${Math.round(box.y)}), using focus+click fallback`);
      await element.focus();
      await element.click();
      return true;
    }
    
    if (scrollFirst) {
      await smoothScroll(page, randomDelay(-100, 100));
      await sleep(randomDelay(200, 500));
    }
    
    const targetX = box.x + box.width / 2 + randomDelay(-3, 3);
    const targetY = box.y + box.height / 2 + randomDelay(-3, 3);
    
    if (moveFirst) {
      await moveMouseLikeHuman(page, targetX, targetY);
      await sleep(randomDelay(50, 150));
    }
    
    await page.mouse.click(targetX, targetY);
    log(`Clicked ${selector} at (${Math.round(targetX)}, ${Math.round(targetY)})`);
    return true;
  } catch (error: any) {
    log(`Failed to click ${selector}: ${error.message}`, 'ERROR');
    return false;
  }
}

export async function humanizedClickElement(
  page: Page,
  element: ElementHandle,
  options: { moveFirst?: boolean } = {}
): Promise<boolean> {
  const { moveFirst = true } = options;
  
  try {
    // Scroll element into view first
    await element.evaluate((el) => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    await sleep(randomDelay(150, 350));
    
    const box = await element.boundingBox();
    if (!box) {
      log(`Could not get bounding box for element`, 'WARN');
      return false;
    }
    
    // Validate coordinates are within viewport
    const viewport = page.viewport();
    if (viewport && (box.y < 0 || box.y > viewport.height)) {
      log(`Element outside viewport (y=${Math.round(box.y)}), using focus+click fallback`);
      await element.focus();
      await element.click();
      return true;
    }
    
    const targetX = box.x + box.width / 2 + randomDelay(-3, 3);
    const targetY = box.y + box.height / 2 + randomDelay(-3, 3);
    
    if (moveFirst) {
      await moveMouseLikeHuman(page, targetX, targetY);
      await sleep(randomDelay(50, 150));
    }
    
    await page.mouse.click(targetX, targetY);
    return true;
  } catch (error: any) {
    log(`Failed to click element: ${error.message}`, 'ERROR');
    return false;
  }
}

export async function smoothScroll(
  page: Page,
  distance: number,
  options: { steps?: number } = {}
): Promise<void> {
  const { steps = 5 } = options;
  
  const stepDistance = distance / steps;
  
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => {
      window.scrollBy({ top: d, behavior: 'smooth' });
    }, stepDistance + randomDelay(-10, 10));
    await sleep(randomDelay(30, 80));
  }
  
  log(`Scrolled ${distance}px in ${steps} steps`);
}

export async function preInteractionRoutine(
  page: Page,
  targetSelector?: string
): Promise<void> {
  const scrollAmount = randomDelay(-50, 150);
  if (Math.abs(scrollAmount) > 20) {
    await smoothScroll(page, scrollAmount, { steps: 3 });
    await sleep(randomDelay(100, 300));
  }
  
  const viewport = page.viewport();
  if (viewport && Math.random() > 0.5) {
    const wanderX = randomDelay(100, viewport.width - 100);
    const wanderY = randomDelay(100, viewport.height - 100);
    await page.mouse.move(wanderX, wanderY);
    await sleep(randomDelay(50, 200));
  }
  
  if (targetSelector) {
    try {
      const element = await page.$(targetSelector);
      if (element) {
        const box = await element.boundingBox();
        if (box) {
          await moveMouseLikeHuman(page, box.x + box.width / 2, box.y + box.height / 2);
        }
      }
    } catch (e) {
    }
  }
}

export async function randomMouseWander(page: Page): Promise<void> {
  const viewport = page.viewport();
  if (!viewport) return;
  
  const wanderX = randomDelay(50, viewport.width - 50);
  const wanderY = randomDelay(50, viewport.height - 50);
  
  await moveMouseLikeHuman(page, wanderX, wanderY, { steps: 5, jitter: 10 });
  await sleep(randomDelay(100, 400));
}

export async function humanPause(
  type: 'micro' | 'short' | 'medium' | 'long' = 'short'
): Promise<void> {
  const ranges = {
    micro: [50, 200],
    short: [200, 600],
    medium: [500, 1500],
    long: [1000, 3000]
  };
  const [min, max] = ranges[type];
  await sleep(randomDelay(min, max));
}
