# Overview

This is a full-stack web application designed for analyzing Twitter/X cashtag tweets. Its primary purpose is to identify and filter out tweets likely posted by bot accounts using AI-driven analysis. The application enables users to search for cashtags (e.g., $TSLA, $AAPL) with flexible filtering, provides real-time processing updates, and displays filtered results, effectively excluding suspected bot activity. The business vision is to provide a cleaner, more human-centric view of cashtag-related discussions on Twitter/X, enhancing data integrity and user experience for market analysis and community engagement.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript (SPA).
- **Styling**: Tailwind CSS with shadcn/ui for consistent and accessible UI.
- **State Management**: TanStack Query for server state management and caching.
- **Routing**: Wouter for lightweight client-side routing.
- **Forms**: React Hook Form with Zod validation.
- **Build Tool**: Vite for fast development and optimized builds.

## Backend Architecture
- **Runtime**: Node.js with Express.js REST API.
- **Language**: TypeScript with ES modules.
- **Database**: PostgreSQL with Drizzle ORM.
- **Session Storage**: PostgreSQL-backed sessions using `connect-pg-simple`.
- **Development**: Hot module replacement and Vite integration.

## Data Storage Solutions
- **Primary Database**: PostgreSQL on Neon serverless platform.
- **Schema Management**: Drizzle Kit for migrations.
- **ORM**: Drizzle ORM for type-safe queries.
- **Image Storage**: Images stored as base64 in PostgreSQL.

## Authentication and Authorization
- Basic session management is implemented, supporting session-based authentication via PostgreSQL.

## Backend Services Architecture
- **Centralized Job Management**: `jobManager.ts` handles job lifecycles (search, reply, DM) with an EventEmitter pattern for state tracking.
- **Real-time Updates**: `sseManager.ts` broadcasts job state changes to clients via Server-Sent Events.
- **Queues**: `searchQueue.ts` manages search execution, and `replyQueue.ts` handles scheduled replies and DM follow-ups.
- **Caching**: `cache.ts` provides server-side caching for API responses (e.g., trending tokens).
- **Rate Limiting**: `rateLimiter.ts` implements token bucket limiting for external APIs (OpenRouter, Twitter, DexScreener).
- **Twitter Automation**: Local Puppeteer automation (`browserManager.ts`, `twitterAutomation.ts`) for browser actions, replacing Apify. Features include proxy session rotation with auto-recovery, per-username city-based sticky sessions, and organic activity simulation (liking, retweeting) to mimic human behavior.
- **Reply Detection**: Snapshot-based reply detection prevents false positives by comparing tweet IDs before and after posting.

# External Dependencies

## Third-Party APIs
- **Twitter/X API**: For fetching tweets and user data.
- **OpenRouter API**: AI service for bot detection and reply generation.
- **Decodo Residential Proxy**: Proxy service for undetectable browser automation.

## UI and Styling Libraries
- **Radix UI**: Headless component primitives.
- **Tailwind CSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.
- **Class Variance Authority**: Type-safe component variant management.

## Development and Build Tools
- **Vite**: Build tool and development server.
- **TypeScript**: Static type checking.
- **PostCSS**: CSS processing.

## Database and ORM
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.
- **Drizzle Kit**: Migration and schema management.

## Utility Libraries
- **Zod**: Runtime type validation.
- **Date-fns**: Date manipulation.
- **clsx/cn**: Conditional class name utilities.
- **proxy-chain**: For local proxy handling and Decodo authentication.

# Production Readiness Checklist

## Environment Variables Required
- `OPENROUTER_API_KEY` - For AI reply generation
- `TWITTER_API_KEY` - TwitterAPI.io key for tweet searches
- `DECODO_USERNAME` - Decodo proxy username
- `DECODO_PASSWORD` - Decodo proxy password
- `DATABASE_URL` - PostgreSQL connection string

## Optional Environment Variables
- `SCHEDULER_ENABLED` - Set to `false` in development to prevent duplicate scheduled runs when sharing database with production (default: `true`)
- `USE_LOCAL_AUTOMATION` - No longer used (Puppeteer is now the only automation method)

## Pre-Production Checks
1. **Twitter Cookies**: Ensure all accounts have valid cookies in Settings
2. **Account Availability**: Mark accounts as "available for random selection" for scheduler
3. **Reply Images**: Upload images to the Reply Images section
4. **AI Config**: Configure system prompt for reply generation
5. **Cashtags**: Add recommended cashtags and pin priority ones
6. **Schedules**: Set up scheduled run times (EST timezone)

## Testing Endpoints
- `POST /api/schedules/test-trigger` - Manually trigger a scheduled run
- `POST /api/test-direct-like` - Test like functionality
- `POST /api/test-reply-snapshot` - Test reply posting with snapshot detection

## Key Architecture Decisions
- **Puppeteer-only automation**: Apify has been completely removed
- **Snapshot-based reply detection**: Captures tweet IDs before/after posting to accurately detect success
- **Session rotation**: Proxy sessions rotate hourly with auto-recovery on errors
- **Organic activity simulation**: Human-like delays and behaviors built into automation
- **Adaptive selector system** (BUILD_20231225): Multiple fallback selectors (data-testid, ARIA, structural) for each UI element to handle Twitter A/B testing. Pre-click state verification ensures elements are visible/enabled before interaction. Composer recovery automatically re-clicks reply button if modal closes prematurely.