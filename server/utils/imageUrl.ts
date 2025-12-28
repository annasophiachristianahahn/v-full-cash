// Get the app base URL from environment, with validation
export function getAppBaseUrl(): string {
  // Priority: APP_URL > REPLIT_DEV_DOMAIN > constructed from REPL_SLUG/OWNER
  if (process.env.APP_URL) {
    let url = process.env.APP_URL;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    return url.replace(/\/+$/, '');  // Remove trailing slashes
  }
  
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  
  // Fallback to constructed URL (only if REPL_SLUG and REPL_OWNER are defined)
  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  }
  
  // Last resort: throw error if we can't determine the URL
  throw new Error('Cannot determine app base URL: APP_URL, REPLIT_DEV_DOMAIN, or REPL_SLUG/REPL_OWNER must be set');
}

// Helper to normalize image URLs - ensures all URLs have proper protocol
export function normalizeImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;

  // Get the current base URL
  const baseUrl = getAppBaseUrl();

  // Already a proper URL with protocol
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    // Check if this is an API image path that needs domain replacement
    // Match patterns like: https://any-domain.com/api/images/xxx or https://any-domain.com/public-objects/xxx
    const apiImageMatch = imageUrl.match(/^https?:\/\/[^/]+(\/api\/images\/[^/]+)$/);
    const publicObjectMatch = imageUrl.match(/^https?:\/\/[^/]+(\/public-objects\/.+)$/);

    if (apiImageMatch) {
      // Replace old domain with current baseUrl
      return `${baseUrl}${apiImageMatch[1]}`;
    }

    if (publicObjectMatch) {
      // Replace old domain with current baseUrl
      return `${baseUrl}${publicObjectMatch[1]}`;
    }

    // For other full URLs, return as-is
    return imageUrl;
  }

  // Hostname without protocol (e.g., "vaj-full-auto-cash.replit.app/...")
  // Supports .replit.app, .repl.co, and any other domain containing a dot
  if (imageUrl.includes('.') && !imageUrl.startsWith('/')) {
    // Looks like a hostname, add https://
    return `https://${imageUrl}`;
  }

  // Relative path (e.g., "/api/images/123" or "/public-objects/...")
  if (imageUrl.startsWith('/')) {
    return `${baseUrl}${imageUrl}`;
  }

  // Unknown format - try adding https://
  return `https://${imageUrl}`;
}

// Build full public URL for a given path (used at write-time)
// Properly URL-encodes the path to handle special characters like spaces
export function buildFullPublicUrl(relativePath: string): string {
  const baseUrl = getAppBaseUrl();  // Will throw if not configured
  
  // Split path into segments, encode each segment, and rejoin
  // This handles spaces and other special characters in filenames
  const encodedPath = relativePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
  
  return `${baseUrl}${encodedPath}`;
}
