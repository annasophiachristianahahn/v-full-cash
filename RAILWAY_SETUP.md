# Railway Environment Variables Setup

## Required Environment Variable for DM Functionality

After deploying to Railway, you need to set this environment variable in your Railway project:

```
PUPPETEER_EXECUTABLE_PATH=/nix/store/.../bin/chromium
```

### How to Find the Correct Path

1. Go to your Railway project dashboard
2. Open the deployment logs
3. Look for a line that shows where Chromium is installed (it will be in `/nix/store/...`)
4. Add the environment variable with the full path to the Chromium executable

### Alternative: Auto-detect (Recommended)

Railway with nixpacks.toml should automatically make Chromium available. If DMs fail, check the logs for the Chromium path and set the variable manually.

## Other Environment Variables

Make sure these are also set in Railway (they should already be configured):

- `DATABASE_URL` - PostgreSQL connection string
- `DECODO_USERNAME` - Proxy username
- `DECODO_PASSWORD` - Proxy password
- `TWEXAPI_TOKEN` - TwexAPI bearer token
- `OPENROUTER_API_KEY` - OpenRouter API key
- `USE_PROXY` - Set to "true"
- `NODE_ENV` - Set to "production"
- `SCHEDULER_ENABLED` - Set to "true" if you want scheduled runs

## Testing DM Functionality

Once deployed:

1. Enable DM sending in the Auto Run UI (toggle the "Send DM" switch)
2. Run an Auto Run
3. Check the logs for messages like:
   - `📤 [PuppeteerDM] Sending DM from @username`
   - `📤 [PuppeteerDM] Using proxy: ...`
   - `✅ [PuppeteerDM] DM sent successfully via Puppeteer`

If you see errors about "Could not find Chrome", you need to set the `PUPPETEER_EXECUTABLE_PATH` variable.
