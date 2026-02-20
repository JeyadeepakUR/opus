# 🚀 Deployment Guide

This guide walks you through deploying Libra to production using **Render** (backend + ingestion service) and **Vercel** (frontend).

---

## 📋 Pre-Deployment Checklist

Before deploying, ensure you have:

- [ ] GitHub repository with your code pushed
- [ ] Render account (free tier available): https://render.com
- [ ] Vercel account (free tier available): https://vercel.com
- [ ] API keys ready:
  - OpenAI/OpenRouter API key
  - Serper API key (optional)
  - Google OAuth credentials (optional)

---

## 🖥️ Part 1: Deploy Backend + Ingestion Service (Render)

### Architecture Decision: Monorepo vs. Separate Services

**Option A: Monorepo (Recommended for Starter)**
- Single Render Web Service running both Node.js backend + Python sidecar
- Simpler setup, lower cost (1 service instead of 2)
- Startup script launches both processes

**Option B: Separate Services (Recommended for Scale)**
- Backend: Render Web Service (Node.js)
- Ingestion: Render Background Worker (Python)
- Better isolation, independent scaling
- More complex setup

**This guide covers Option A (Monorepo)**. See "Scaling to Separate Services" section for Option B.

---

### Step 1: Create New Web Service

1. **Go to Render Dashboard**: https://dashboard.render.com/
2. **Click "New +"** → **"Web Service"**
3. **Connect GitHub Repository**:
   - Click "Connect GitHub"
   - Authorize Render to access your repositories
   - Select your `libra` repository

### Step 2: Configure Service Settings

| Field | Value |
|-------|-------|
| **Name** | `libra-backend` (or your preferred name) |
| **Region** | Choose closest to your users (e.g., Oregon, Frankfurt) |
| **Branch** | `main` |
| **Root Directory** | `backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && cd ingestion-service && pip install -r requirements.txt` |
| **Start Command** | `node start-all.js` *(see below)* |
| **Plan** | Free (or paid for production) |

### Step 3: Create Startup Script

Before deploying, create a startup script that runs both services:

**File: `backend/start-all.js`**
```javascript
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Opus backend + ingestion service...');

// Start Python ingestion service
const pythonProcess = spawn('python', [
  '-m', 'uvicorn', 'main:app',
  '--host', '0.0.0.0',
  '--port', process.env.INGESTION_PORT || '8001'
], {
  cwd: path.join(__dirname, 'ingestion-service'),
  stdio: 'inherit'
});

pythonProcess.on('error', (err) => {
  console.error('❌ Failed to start ingestion service:', err);
  process.exit(1);
});

// Wait 2 seconds for Python service to start
setTimeout(() => {
  // Start Node.js backend
  const nodeProcess = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      INGESTION_SIDECAR_URL: `http://localhost:${process.env.INGESTION_PORT || '8001'}`
    }
  });

  nodeProcess.on('error', (err) => {
    console.error('❌ Failed to start backend:', err);
    pythonProcess.kill();
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📴 Shutting down...');
    pythonProcess.kill();
    nodeProcess.kill();
    process.exit(0);
  });
}, 2000);
```

**Commit and push this file** before continuing:
```bash
git add backend/start-all.js
git commit -m "Add monorepo startup script for Render"
git push origin main
```

### Step 4: Set Environment Variables

In the Render dashboard, scroll down to **"Environment Variables"** and add:

#### Required Variables

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `10000` | Render assigns this automatically |
| `FRONTEND_URL` | `https://your-app.vercel.app` | Update after deploying frontend |
| `LLM_API_KEY` | `sk-your-api-key` | OpenAI or OpenRouter key |
| `LLM_MODEL` | `gpt-4o-mini` | Or your preferred model |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | If using OpenRouter |
| `INGESTION_SIDECAR_URL` | `http://localhost:8001` | Internal communication |
| `INGESTION_PORT` | `8001` | Port for Python service |

#### Optional Variables

| Key | Value | Notes |
|-----|-------|-------|
| `SERPER_API_KEY` | `your-serper-key` | For web search |
| `GOOGLE_CLIENT_ID` | `your-client-id` | For Drive integration |
| `GOOGLE_CLIENT_SECRET` | `your-client-secret` | For Drive integration |
| `GOOGLE_REDIRECT_URI` | `https://opus-backend.onrender.com/auth/google/callback` | Update with your Render URL |

**Important**: After deployment, update `GOOGLE_REDIRECT_URI` with your actual Render URL.

### Step 5: Deploy

1. Click **"Create Web Service"**
2. Render will:
   - Install Node.js dependencies
   - Install Python dependencies
   - Build TypeScript
   - Start both services
3. **Monitor logs** for any errors
4. Once deployed, note your service URL: `https://libra-backend.onrender.com`

### Step 6: Verify Backend is Running

Visit these endpoints:
- Health check: `https://your-backend.onrender.com/api/health`
- Ingestion health: `https://your-backend.onrender.com/api/ingestion/health`

Expected responses:
```json
{"status":"ok","timestamp":"..."}
```

---

## 🌐 Part 2: Deploy Frontend (Vercel)

### Step 1: Go to Vercel Dashboard

1. **Visit**: https://vercel.com/new
2. **Import Git Repository**:
   - Click "Add New..." → "Project"
   - Connect GitHub if not already connected
   - Select your `libra` repository

### Step 2: Configure Project Settings

| Field | Value |
|-------|-------|
| **Framework Preset** | Vite |
| **Root Directory** | `frontend` |
| **Build Command** | `npm run build` *(auto-detected)* |
| **Output Directory** | `dist` *(auto-detected)* |
| **Install Command** | `npm install` *(auto-detected)* |

### Step 3: Set Environment Variables

Click **"Environment Variables"** and add:

| Key | Value | Notes |
|-----|-------|-------|
| `VITE_API_URL` | `https://opus-backend.onrender.com` | Your Render backend URL |

**Important**: Vite requires `VITE_` prefix for environment variables.

### Step 4: Deploy

1. Click **"Deploy"**
2. Vercel will:
   - Install dependencies
   - Build React app
   - Deploy to CDN
3. **Wait for deployment** (~2-3 minutes)
4. Note your deployment URL: `https://your-app.vercel.app`

### Step 5: Update Backend CORS

**Go back to Render dashboard**:
1. Open your backend service
2. Go to **"Environment"** tab
3. Update `FRONTEND_URL` to your Vercel URL:
   ```
   FRONTEND_URL=https://your-app.vercel.app
   ```
4. Click **"Save Changes"** (triggers automatic redeploy)

---

## 🔐 Part 3: Configure Google OAuth (If Using Drive)

### Step 1: Update Google Cloud Console

1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your OAuth 2.0 Client ID
3. **Add Authorized Redirect URIs**:
   ```
   https://opus-backend.onrender.com/auth/google/callback
   ```
4. **Add Authorized JavaScript Origins**:
   ```
   https://your-app.vercel.app
   ```
5. Click **"Save"**

### Step 2: Update Backend Environment

In Render dashboard, update:
```
GOOGLE_REDIRECT_URI=https://opus-backend.onrender.com/auth/google/callback
```

---

## ✅ Part 4: Post-Deployment Verification

### Frontend Checks
- [ ] Visit `https://your-app.vercel.app`
- [ ] UI loads without errors
- [ ] Check browser console for CORS errors
- [ ] Test navigation (Agent, Run, Settings pages)

### Backend Checks
- [ ] Health endpoint responds: `/api/health`
- [ ] Ingestion health responds: `/api/ingestion/health`
- [ ] Check Render logs for startup errors
- [ ] Test API call from frontend

### Integration Checks
- [ ] Submit a test query (without tools to avoid API usage)
- [ ] Check if response completes successfully
- [ ] If using Drive: Test OAuth flow (Settings → Connect Drive)
- [ ] If using web search: Test a query that requires external search

---

## 🔧 Troubleshooting

### Backend Won't Start

**Symptom**: Render logs show "Service exited" or "Crashed"

**Solutions**:
1. Check `start-all.js` exists and is executable
2. Verify Python dependencies installed (check build logs)
3. Ensure `dist/index.js` exists (TypeScript compiled)
4. Check for missing environment variables (`LLM_API_KEY`)

**Debug command** (add to Render startup):
```bash
ls -la && node --version && python --version && npm run build
```

### Frontend Can't Connect to Backend

**Symptom**: Network errors in browser console

**Solutions**:
1. Verify `VITE_API_URL` is set correctly in Vercel
2. Check backend `FRONTEND_URL` matches Vercel deployment
3. Ensure backend health endpoint is accessible publicly
4. Check CORS settings in `backend/src/index.ts`

### Ingestion Service Not Working

**Symptom**: File uploads fail or timeout

**Solutions**:
1. Verify Python service started (check Render logs for `Starting ingestion sidecar`)
2. Check `INGESTION_SIDECAR_URL=http://localhost:8001` (not external URL)
3. Ensure pip dependencies installed correctly
4. Test ingestion health endpoint: `/api/ingestion/health`

### Google OAuth Fails

**Symptom**: "Redirect URI mismatch" error

**Solutions**:
1. Verify Google Cloud Console redirect URIs match exactly (no trailing slashes)
2. Update `GOOGLE_REDIRECT_URI` in Render to production URL
3. Ensure OAuth consent screen is configured
4. Add test users if app is not published

### High Latency or Timeouts

**Symptom**: Requests take >30 seconds or timeout

**Solutions**:
1. Render free tier spins down after inactivity (~15 min cold start)
2. Upgrade to paid tier for always-on service
3. Check LLM API rate limits (OpenRouter/OpenAI)
4. Reduce `maxSteps` in agent config (default: 8 → try 4)

---

## 📈 Scaling to Separate Services (Option B)

Once you outgrow the monorepo setup:

### 1. Deploy Backend as Web Service

**Render Settings**:
- Root Directory: `backend`
- Build Command: `npm install && npm run build`
- Start Command: `node dist/index.js`
- Environment: Add all variables except `INGESTION_SIDECAR_URL`

### 2. Deploy Ingestion as Background Worker

**Render Settings**:
- Root Directory: `backend/ingestion-service`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Plan: Background Worker (or Web Service if you need public access)

### 3. Connect Services

**Update Backend Environment**:
```
INGESTION_SIDECAR_URL=https://libra-ingestion.onrender.com
```

**Benefits**:
- Independent scaling (scale ingestion separately from API)
- Isolated failures (ingestion crash doesn't affect API)
- Better resource allocation

**Drawbacks**:
- Costs ~2x (two services instead of one)
- More complex networking (external HTTP calls)
- Potential latency (inter-service communication)

---

## 🎯 Production Recommendations

### Performance
- [ ] Enable Render's **Persistent Storage** for `vector-store.json`
- [ ] Use **Redis** for caching duplicate queries (requires separate service)
- [ ] Upgrade to **Starter plan** to avoid cold starts (~$7/month)
- [ ] Consider **PostgreSQL** for run storage (Render has free tier)

### Security
- [ ] Add rate limiting middleware (e.g., `express-rate-limit`)
- [ ] Use **Render Secret Files** for sensitive keys (not env vars)
- [ ] Enable HTTPS only (Render does this by default)
- [ ] Rotate API keys regularly
- [ ] Add request validation middleware

### Monitoring
- [ ] Set up **Render alerts** for service crashes
- [ ] Monitor **LLM token usage** (OpenAI/OpenRouter dashboards)
- [ ] Track **Serper API quota** (2500/month on free tier)
- [ ] Log errors to external service (Sentry, LogRocket)

### Cost Optimization
- [ ] Use **gpt-4o-mini** instead of gpt-4 (10x cheaper, similar quality)
- [ ] Cache frequent queries to reduce LLM calls
- [ ] Limit `maxSteps` in production (4-6 instead of 8)
- [ ] Use Render's free tier for staging/testing

---

## 💰 Estimated Monthly Costs

### Free Tier (Testing/Hobby)
- Render: $0 (750 hrs/month free)
- Vercel: $0 (100GB bandwidth free)
- OpenAI: ~$5 (depends on usage)
- Serper: $0 (2500 searches free)
- **Total**: ~$5/month

### Production (Low Traffic)
- Render Starter: $7/month (no cold starts)
- Vercel: $0 (within free limits)
- OpenAI: ~$20-50/month (depends on usage)
- Serper Pro: $50/month (10K searches)
- **Total**: ~$77-107/month

### Production (High Traffic)
- Render Standard: $25/month
- Vercel Pro: $20/month
- OpenAI: ~$200+/month
- Serper Scale: $200/month (100K searches)
- PostgreSQL: $7/month (Render)
- Redis: $10/month (Render)
- **Total**: ~$462+/month

---

## 📞 Getting Help

**Render Issues**: https://render.com/docs/troubleshooting
**Vercel Issues**: https://vercel.com/docs/troubleshooting

**Common Resources**:
- Render Build Logs: Dashboard → Service → "Logs" tab
- Vercel Build Logs: Dashboard → Deployment → "Function Logs"
- Google OAuth Debug: https://console.cloud.google.com/apis/credentials

---

**🎉 Congratulations!** Your Libra agent is now live in production.

Test it thoroughly and monitor the logs for the first few days to catch any edge cases.
