/**
 * Proxy Manager - Manages sticky proxy assignments for Twitter accounts
 * Each account is assigned a consistent city to maintain IP consistency
 */

interface ProxyConfig {
  city: string;
  timezone: string;
  coordinates: { lat: number; lng: number };
}

// City configurations for proxy rotation
const PROXY_CITIES: Record<string, ProxyConfig> = {
  NEW_YORK: {
    city: 'new_york',
    timezone: 'America/New_York',
    coordinates: { lat: 40.7128, lng: -74.0060 }
  },
  LOS_ANGELES: {
    city: 'los_angeles',
    timezone: 'America/Los_Angeles',
    coordinates: { lat: 34.0522, lng: -118.2437 }
  },
  CHICAGO: {
    city: 'chicago',
    timezone: 'America/Chicago',
    coordinates: { lat: 41.8781, lng: -87.6298 }
  },
  HOUSTON: {
    city: 'houston',
    timezone: 'America/Chicago',
    coordinates: { lat: 29.7604, lng: -95.3698 }
  },
  PHOENIX: {
    city: 'phoenix',
    timezone: 'America/Phoenix',
    coordinates: { lat: 33.4484, lng: -112.0740 }
  },
  MIAMI: {
    city: 'miami',
    timezone: 'America/New_York',
    coordinates: { lat: 25.7617, lng: -80.1918 }
  }
};

// Sticky account-to-city assignments
const ACCOUNT_CITY_MAP: Record<string, keyof typeof PROXY_CITIES> = {
  'vajme': 'NEW_YORK',
  'expert': 'NEW_YORK',
  'bingo star': 'HOUSTON',
  'homeless_poetry': 'LOS_ANGELES',
  'dozer': 'LOS_ANGELES'
};

export class ProxyManager {
  private decodoCreds: {
    username: string;
    password: string;
    host: string;
    port: number;
  };

  constructor() {
    // Get Decodo credentials from environment
    this.decodoCreds = {
      username: process.env.DECODO_USERNAME || '',
      password: process.env.DECODO_PASSWORD || '',
      host: 'gate.decodo.com',
      port: 7000
    };

    if (!this.decodoCreds.username || !this.decodoCreds.password) {
      console.warn('[ProxyManager] DECODO_USERNAME or DECODO_PASSWORD not set');
    }
  }

  /**
   * Get sticky proxy URL for a given username
   * Returns the same city proxy every time for consistency
   */
  getProxyForUser(username: string): string | null {
    if (!this.decodoCreds.username || !this.decodoCreds.password) {
      console.warn('[ProxyManager] Decodo credentials not configured');
      return null;
    }

    // Normalize username (lowercase, no spaces)
    const normalizedUsername = username.toLowerCase().replace(/\s+/g, '');

    // Get assigned city for this user (or default to NEW_YORK)
    const cityKey = ACCOUNT_CITY_MAP[username] || 'NEW_YORK';
    const cityConfig = PROXY_CITIES[cityKey];

    // Create sticky session ID based on username
    // This ensures same IP for same user across requests
    const sessionId = `session_${normalizedUsername}_sticky`;

    // Build Decodo proxy URL with sticky session
    const proxyUrl = `http://user-${this.decodoCreds.username}-country-us-city-${cityConfig.city}-session-${sessionId}:${this.decodoCreds.password}@${this.decodoCreds.host}:${this.decodoCreds.port}`;

    console.log(`[ProxyManager] Assigned ${cityKey} proxy to @${username} (sticky session: ${sessionId})`);

    return proxyUrl;
  }

  /**
   * Get city name for a username (for logging/debugging)
   */
  getCityForUser(username: string): string {
    const cityKey = ACCOUNT_CITY_MAP[username] || 'NEW_YORK';
    return PROXY_CITIES[cityKey].city;
  }

  /**
   * Check if proxy is enabled
   */
  isProxyEnabled(): boolean {
    const useProxy = process.env.USE_PROXY !== 'false';
    const hasCredentials = !!(this.decodoCreds.username && this.decodoCreds.password);
    return useProxy && hasCredentials;
  }
}

export const proxyManager = new ProxyManager();
