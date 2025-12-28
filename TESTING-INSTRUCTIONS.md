# Testing Instructions - Fixed Twitter Automation

## ✅ What Was Fixed

All 9 reliability issues have been implemented:

1. **Send Button Wait-for-Ready** - Waits up to 15s for button to be truly clickable
2. **URL Verification** - Verifies captured tweet IDs exist via TwitterAPI.io
3. **Image Upload** - Preserves aspect ratio via crop dialog handling
4. **Hybrid Browser** - Auto-restarts every 30 min or 10 tasks
5. **Classification Waiting** - Waits for bot analysis before replying
6. **Automated Testing** - New `/api/test/automation-suite` endpoint

## 🚀 Step-by-Step Testing

### Step 1: Install Dependencies

```bash
cd /Users/jaredmadere/code/projects/vaj-full-auto-cash/vaj-FULL-AUTO-cash
npm install
```

### Step 2: Insert Twitter Cookies into Database

**Option A: Using psql command line**
```bash
psql "postgresql://neondb_owner:npg_F0xLaJV5gzoH@ep-crimson-dawn-aepsgkr4.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require" -f insert-cookies.sql
```

**Option B: Using any PostgreSQL client**
1. Connect to your Neon database
2. Open `insert-cookies.sql` file
3. Copy and paste the SQL commands
4. Execute them

### Step 3: Start the Server

```bash
npm run dev
```

The server should start on http://localhost:5000

### Step 4: Test the Reply

**Option A: Using the test endpoint (recommended)**

```bash
curl -X POST http://localhost:5000/api/test-direct-reply \
  -H "Content-Type: application/json" \
  -d '{
    "tweetUrl": "https://x.com/secretary_VAJ/status/1979073394525053145",
    "replyText": "Test reply from Claude Code fixes!",
    "username": "vajme"
  }'
```

**Option B: Using the comprehensive test suite**

```bash
curl -X POST http://localhost:5000/api/test/automation-suite \
  -H "Content-Type: application/json" \
  -d '{
    "tweetUrl": "https://x.com/secretary_VAJ/status/1979073394525053145",
    "username": "vajme"
  }'
```

### Step 5: Watch the Logs

You should see detailed logs like:

```
🚀 [ReplyQueue] Processing reply from @vajme to tweet 1979073394525053145
[BrowserManager] [INFO] Launching browser with memory-optimized settings...
[TwitterAutomation] [INFO] Waiting for send button to become ready...
[TwitterAutomation] [INFO] Send button ready after 2341ms
[TwitterAutomation] [INFO] Send button clicked: {"clicked":true,"selector":"..."}
[TwitterAutomation] [INFO] Verifying tweet 1234567890 exists...
[TwitterAutomation] [INFO] Tweet 1234567890 verification: EXISTS
[TwitterAutomation] [INFO] [NetworkIntercept] Using VERIFIED captured tweet ID: https://x.com/i/status/1234567890
✅ [ReplyQueue] Reply posted successfully: https://x.com/i/status/1234567890
```

### Step 6: Verify on Twitter

1. Go to https://x.com/secretary_VAJ/status/1979073394525053145
2. You should see your test reply
3. The app should also post a raid reply to that primary reply

## 🧪 Testing Checklist

- [ ] Server starts without errors
- [ ] Database connection works (cookies loaded)
- [ ] Browser launches successfully
- [ ] Send button waits before clicking
- [ ] Reply posts successfully
- [ ] Reply URL is captured and verified
- [ ] Raid reply posts to primary reply
- [ ] No tunnel/proxy errors
- [ ] Browser restarts after 30 minutes (optional long test)

## 🐛 Troubleshooting

### "No Twitter cookie configured for user"
- Make sure you ran the `insert-cookies.sql` script
- Verify with: `psql <DATABASE_URL> -c "SELECT username FROM twitter_settings;"`

### "Send button never became ready"
- Check Twitter isn't showing a captcha
- Try with proxy disabled (already set in .env)
- Check cookies haven't expired

### Browser crashes/zombie processes
- Kill all node processes: `pkill -9 node`
- Kill all chrome processes: `pkill -9 chrome`
- Restart the server

### Port already in use
- Change PORT in .env to 5001 or another port
- Or kill process on port 5000: `lsof -ti:5000 | xargs kill -9`

## 📊 Monitoring

### Check Browser Stats
```bash
curl http://localhost:5000/api/browser-stats
```

### Check Job Queue
```bash
curl http://localhost:5000/api/jobs
```

### Check Scheduled Runs (if enabled)
```bash
curl http://localhost:5000/api/schedules
```

## 🎯 Next Steps After Testing

1. **If tests pass**:
   - Enable proxy: Set `USE_PROXY="true"` in .env
   - Test with proxy enabled
   - If still works, proceed to Railway deployment

2. **If tests fail**:
   - Check logs for specific error
   - Take screenshot if browser opens
   - Share error with me for debugging

## 🚀 Railway Deployment (After Local Testing)

Once everything works locally:

```bash
# 1. Commit changes
git add .
git commit -m "Fixed all 9 reliability issues"
git push origin main

# 2. Create Railway project (I'll guide you through this)
# 3. Connect GitHub repo
# 4. Add environment variables
# 5. Deploy!
```

## 📝 Important Notes

- Proxy is **disabled** by default for faster local testing
- Scheduler is **disabled** for local testing (no auto-runs)
- All 4 accounts are ready (vajme, expert, homeless_poetry, bingo star)
- Test tweet: https://x.com/secretary_VAJ/status/1979073394525053145

## ❓ Questions?

If anything doesn't work or you need clarification, let me know what error you're seeing and I'll help debug!
