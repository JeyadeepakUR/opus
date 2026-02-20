# Opus

**Opus** is an autonomous AI reasoning agent with a phase-based exploration engine. It takes natural-language questions, intelligently decides which tools to use, gathers evidence from multiple sources (vector store, web, Google Drive), and delivers grounded answers with citations.

## 🎯 Key Features

- **Phase-Based Reasoning**: Separates understanding → evidence gathering → structuring → reasoning phases
- **Universal Exploration Playbook**: Dynamically classifies queries and adapts tool usage (no hard-coded flows)
- **Stateful Replanning**: Re-evaluates search strategy mid-execution based on gathered evidence
- **Multi-Source Knowledge**: Semantic search over Drive docs, web search, web scraping, and LLM reasoning
- **Stateless Follow-Up Chat**: Fast context-aware follow-ups without re-running the full pipeline
- **Deep Search**: Automatically follows hub-page links when detecting navigation structures
- **Flexible Drive Queries**: Semantic keyword matching (e.g., "sih document by jeyasurya" → "jeyasurya-sih.pdf")

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER QUERY                                     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   Drive Query Planner (LLM)  │ ◄─── Detects Drive intent
                    └──────────────┬───────────────┘      (list/fetch/compare)
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
         Drive Query?│                           │ No
                 Yes │                           │
                     ▼                           ▼
        ┌────────────────────────┐    ┌──────────────────────────┐
        │  Drive Retrieval Tool  │    │  Understanding Phase     │
        │  - List files          │    │  - Classify task type    │
        │  - Fetch content       │    │  - Generate queries      │
        │  - Semantic search     │    │  - Decide tool needs     │
        └────────────┬───────────┘    └──────────┬───────────────┘
                     │                           │
                     └──────────┬────────────────┘
                                │
                                ▼
                   ┌─────────────────────────────────┐
                   │ Internal Knowledge Phase        │
                   │ - Vector search (Drive docs)    │
                   │ - Inject chat context (followup)│
                   └──────────────┬──────────────────┘
                                  │
                                  ▼
                   ┌─────────────────────────────────┐
                   │ Structuring Phase               │
                   │ - Organize gathered evidence    │
                   │ - Identify gaps                 │
                   └──────────────┬──────────────────┘
                                  │
                                  ▼
                   ┌─────────────────────────────────┐
                   │ Replanning Phase (Stateful)     │
                   │ - Re-evaluate queries           │
                   │ - Decide: finish or continue    │
                   └──────────────┬──────────────────┘
                                  │
                     ┌────────────┴─────────────┐
                     │                          │
              Needs  │                          │ Finish
             external│                          │
                     ▼                          │
        ┌────────────────────────┐              │
        │ External Knowledge     │              │
        │ - Web search (Serper)  │              │
        │ - Web scrape           │              │
        │ - Hub-page link follow │              │
        └────────────┬───────────┘              │
                     │                          │
                     └──────────┬───────────────┘
                                │
                                ▼
                   ┌─────────────────────────────────┐
                   │ Final Reasoning Phase           │
                   │ - Synthesize answer from all    │
                   │   evidence sources              │
                   │ - Generate citations            │
                   └──────────────┬──────────────────┘
                                  │
                                  ▼
                          ┌─────────────────┐
                          │ Structured      │
                          │ Answer +        │
                          │ Citations       │
                          └─────────────────┘
```

---

## 📁 Project Structure

```
opus/
├── backend/              # Node.js + TypeScript + Express
│   ├── ingestion-service/    # Python FastAPI sidecar for binary file extraction
│   │   ├── main.py
│   │   ├── extractors/
│   │   │   ├── pdf.py
│   │   │   ├── office.py
│   │   │   └── notebook.py
│   │   └── requirements.txt
│   └── src/
│       ├── agent/
│       │   ├── runner.ts          # Phase-based execution orchestrator
│       │   └── store.ts           # In-memory run storage
│       ├── auth/
│       │   ├── google.ts          # OAuth2 flow
│       │   └── tokenStore.ts
│       ├── ingestion/
│       │   └── pipeline.ts        # Drive ingestion coordinator
│       ├── llm/
│       │   ├── client.ts          # LLM wrapper (understanding, structuring, replanning)
│       │   └── prompts.ts         # Universal exploration playbook prompts
│       ├── routes/
│       │   ├── agent.ts           # /api/agent/run, /api/agent/followup
│       │   ├── auth.ts
│       │   └── ingestion.ts
│       ├── tools/
│       │   ├── vectorSearch.ts    # Semantic search over ingested docs
│       │   ├── webSearch.ts       # Serper API integration
│       │   ├── webScrape.ts       # HTML extraction + link following
│       │   ├── driveRetrieval.ts  # Google Drive API with semantic search
│       │   └── reasoning.ts       # LLM-based reasoning/synthesis
│       ├── types/
│       │   └── index.ts           # AgentState, AgentPhase, ToolInput/Result
│       └── vectordb/
│           ├── store.ts           # In-memory vector store (cosine similarity)
│           └── chunker.ts         # Document chunking (500 tokens, 50 overlap)
├── frontend/             # React + TypeScript + Vite + Tailwind
│   └── src/
│       ├── api/
│       │   └── client.ts          # Typed API client
│       ├── components/
│       │   ├── layout/
│       │   └── ui/
│       └── pages/
│           ├── AgentPage.tsx      # Main agent interface
│           ├── RunPage.tsx        # Run details + follow-up chat
│           ├── KnowledgePage.tsx  # Ingestion status
│           └── SettingsPage.tsx   # Google Drive connection
└── vector-store.json     # Persisted vector embeddings (gitignored)
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm/yarn
- **Python** 3.8+ (for ingestion service)
- API keys for:
  - **LLM** (OpenAI or OpenRouter)
  - **Web Search** (Serper - optional)
  - **Google Drive** (OAuth credentials - optional)

### 1. Install Dependencies

**Backend (Node.js):**
```bash
cd backend
npm install
```

**Frontend (React):**
```bash
cd frontend
npm install
```

**Ingestion Service (Python):**
```bash
cd backend/ingestion-service
pip install -r requirements.txt
# Or with virtual environment:
python -m venv venv
venv\Scripts\activate  # Windows
source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
```

### 2. Configure Environment

Copy the example and fill in your API keys:

```bash
cp .env.example backend/.env
```

Edit `backend/.env`:

```env
# ===== Required =====
LLM_API_KEY=sk-your-openai-api-key       # OpenAI or OpenRouter API key

# ===== LLM Configuration =====
LLM_MODEL=gpt-4o-mini                     # Model name (gpt-4o-mini, gpt-4, qwen/qwen3-235b-a22b-thinking-2507)
LLM_BASE_URL=https://api.openai.com/v1   # Override for OpenRouter/Azure (optional)
LLM_EMBEDDING_MODEL=text-embedding-3-small  # Embedding model for vector search

# ===== Optional: Web Search =====
SERPER_API_KEY=your-serper-key            # Serper.dev API key for web_search tool

# ===== Optional: Google Drive =====
GOOGLE_CLIENT_ID=your-client-id           # OAuth 2.0 Client ID
GOOGLE_CLIENT_SECRET=your-client-secret   # OAuth 2.0 Client Secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

# ===== Server Configuration =====
PORT=3001                                  # Backend API port (default: 3001)
```

**Environment Variable Reference:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | ✅ Yes | - | OpenAI/OpenRouter API key |
| `LLM_MODEL` | No | `gpt-4o-mini` | Model for reasoning phases |
| `LLM_BASE_URL` | No | OpenAI API | Override for OpenRouter (`https://openrouter.ai/api/v1`) |
| `LLM_EMBEDDING_MODEL` | No | `text-embedding-3-small` | Model for document embeddings |
| `SERPER_API_KEY` | No | - | Enables `web_search` tool |
| `GOOGLE_CLIENT_ID` | No | - | Enables Google Drive integration |
| `GOOGLE_CLIENT_SECRET` | No | - | Required if `GOOGLE_CLIENT_ID` set |
| `GOOGLE_REDIRECT_URI` | No | `http://localhost:3001/auth/google/callback` | OAuth redirect |
| `PORT` | No | `3001` | Backend server port |

**Getting API Keys:**

| Service | URL | Notes |
|---------|-----|-------|
| OpenAI | https://platform.openai.com/api-keys | Free trial $5 credit |
| OpenRouter | https://openrouter.ai | Access 100+ models, pay-per-use |
| Serper | https://serper.dev | Free tier: 2500 searches/month |
| Google OAuth | https://console.cloud.google.com | Create OAuth 2.0 Client ID (Desktop app) |

### 3. Run Development Servers

**Option 1: Start All Services Concurrently**
```bash
# From root directory
npm run dev  # Runs backend + frontend
```

Then start the ingestion service separately:
```bash
cd backend/ingestion-service
python main.py  # Or: uvicorn main:app --reload --port 8765

# Windows: .\start.bat
# Linux/Mac: ./start.sh
```

**Option 2: Start Individually**
```bash
# Terminal 1: Backend API
cd backend
npm run dev  # http://localhost:3001

# Terminal 2: Frontend UI
cd frontend
npm run dev  # http://localhost:5173

# Terminal 3: Ingestion Service
cd backend/ingestion-service
python main.py  # http://localhost:8765
```

**First Run Checklist:**
- [ ] Backend running at `http://localhost:3001/api/health`
- [ ] Frontend running at `http://localhost:5173`
- [ ] Ingestion service running at `http://localhost:8765/health`
- [ ] All required API keys configured in `backend/.env`
- [ ] No CORS errors in browser console

### 4. Build for Production

```bash
npm run build

# Then start backend in production
cd backend && npm run start
```

### 5. Run Tests

```bash
cd backend && npm run test
```

### 6. Troubleshooting

**Backend won't start:**
- Check that port 3001 is not already in use
- Verify `.env` file exists in `backend/` directory
- Ensure `LLM_API_KEY` is set

**Frontend shows connection error:**
- Confirm backend is running at `http://localhost:3001`
- Check browser console for CORS errors
- Try clearing browser cache

**Ingestion service fails:**
- Verify Python 3.8+ is installed: `python --version`
- Check all dependencies installed: `pip list`
- Ensure port 8765 is available
- For Windows: Use `.\start.bat` instead of `python main.py`

**Google Drive not connecting:**
- Verify OAuth credentials in `.env`
- Check redirect URI matches exactly: `http://localhost:3001/auth/google/callback`
- Ensure "Google Drive API" is enabled in Google Cloud Console
- Add test users in OAuth consent screen if app is not published

**Vector search returns no results:**
- Run ingestion first: Settings → Connect Google Drive → Ingest
- Check `backend/vector-store.json` is not empty
- Verify `LLM_EMBEDDING_MODEL` is compatible with your LLM provider

---

## 🧰 Tools & Capabilities

| Tool | Description | API Key Required | Phase Used |
|------|-------------|-----------------|------------|
| `vector_search` | Semantic search over ingested Drive docs via embeddings | `LLM_API_KEY` | Internal Knowledge |
| `web_search` | Real-time web search via Serper API | `SERPER_API_KEY` | External Knowledge |
| `web_scrape` | HTML extraction with automatic link following for hub pages | None | External Knowledge |
| `drive_retrieval` | Google Drive file access with semantic keyword matching | Google OAuth | Pre-phase / On-demand |
| `reasoning` | LLM-based analysis, synthesis, and comparison | None | Final Reasoning |

**Tool Selection Logic:**
- **Understanding Phase**: LLM classifies task type (factual, how-to, comparison, creative, etc.) and decides which tools are needed
- **Replanning Phase**: After gathering initial evidence, agent re-evaluates and may add/remove tools from the plan
- **No Hard-Coded Flows**: The universal exploration playbook adapts tool usage per query (meta-prompts, not per-question heuristics)

---

## 📡 API Reference

### Agent Endpoints

#### `POST /api/agent/run`
Start a new agent run.

**Request:**
```json
{
  "query": "What are the key findings in the Q4 report?",
  "config": {
    "temperature": 0.3,
    "maxSteps": 8,
    "enabledTools": ["vector_search", "web_search", "reasoning"]
  }
}
```

**Response:**
```json
{
  "runId": "run_abc123",
  "status": "running",
  "phase": "understanding"
}
```

#### `POST /api/agent/followup`
Ask a follow-up question with chat context (fast path, skips Drive planning + vector search).

**Request:**
```json
{
  "query": "Can you explain the revenue section?",
  "context": "Previous answer about Q4 report...",
  "config": { "temperature": 0.3 }
}
```

**Response:**
```json
{
  "answer": "The revenue section shows...",
  "citations": [...]
}
```

#### `GET /api/agent/run/:id`
Get run status and results.

**Response:**
```json
{
  "id": "run_abc123",
  "query": "...",
  "status": "completed",
  "phase": "reasoning_answer",
  "finalAnswer": "...",
  "sources": [...],
  "planItems": [...]
}
```

#### `GET /api/agent/runs`
List all runs (most recent first).

### Ingestion Endpoints

#### `POST /api/ingestion/run`
Trigger Google Drive ingestion.

**Request:**
```json
{
  "selectedFolders": ["folder_id_1", "folder_id_2"],
  "includeSharedWithMe": true
}
```

**Response:**
```json
{
  "message": "Ingestion started",
  "status": { "totalFiles": 42, "processedFiles": 0, "failedFiles": 0 }
}
```

#### `GET /api/knowledge/sources`
Get list of ingested files.

**Response:**
```json
{
  "sources": [
    { "driveFileId": "...", "fileName": "Q4-Report.pdf", "status": "completed" }
  ]
}
```

#### `POST /api/ingestion/clear`
Clear all ingested data (vector store + status).

---

## ⚙️ Technical Details

### Phase-Based Reasoning Engine

The agent follows a stateful, iterative pipeline inspired by deliberate problem-solving:

1. **Understanding**: Classify query type (factual/procedural/creative), generate initial internal/external queries
2. **Internal Knowledge**: Search vector store for relevant Drive documents
3. **Structuring**: Organize evidence, identify gaps, decide if external sources needed
4. **Replanning**: Re-evaluate queries based on gathered evidence, decide to finish or continue
5. **External Knowledge** *(conditional)*: Web search + scraping if internal knowledge insufficient
6. **Final Reasoning**: Synthesize answer from all evidence sources, generate citations

**Key Innovation:** Separation of evidence gathering from reasoning prevents premature conclusions.

### Vector Store

- **Implementation**: In-memory cosine similarity search
- **Embedding Model**: Configurable via `LLM_EMBEDDING_MODEL` (default: `text-embedding-3-small`)
- **Chunking**: 500 tokens per chunk, 50-token overlap
- **Persistence**: JSON file (`vector-store.json`)
- **Indexing**: Real-time during ingestion (no rebuild required)

### LLM Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `LLM_MODEL` | `gpt-4o-mini` | Model for all phases |
| `LLM_BASE_URL` | OpenAI API | Override for OpenRouter, Azure, etc. |
| `LLM_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `temperature` | `0.2-0.3` | Low for consistency, varies by phase |

---

## ⚠️ Current Limitations

### Performance
- **Sequential LLM Calls**: Each phase waits for the previous (5-8 seconds per full run)
- **No Streaming**: Answers delivered only after full pipeline completes
- **In-Memory Storage**: All vectors/runs held in RAM, cleared on restart
- **Single-Threaded**: No parallel tool execution within a phase

### Scalability
- **Vector Store**: No clustering or approximate nearest neighbor (ANN) indexing
- **Max Documents**: ~1000 documents before memory/latency issues (~100MB vectors in RAM)
- **Max Run History**: No pagination or cleanup (grows indefinitely)
- **No Caching**: Duplicate queries re-execute full pipeline

### Functionality
- **Follow-Up Context**: Limited to previous answer only (no multi-turn memory)
- **File Type Support**: PDF, Office, Notebooks only (no images, videos, archives)
- **Web Scraping**: Basic HTML extraction (no JavaScript rendering)
- **Drive Permissions**: User-scoped only (no service account for shared drives)
- **Citation Granularity**: File-level only (no chunk-level line numbers)

### Security & Deployment
- **No Multi-Tenancy**: Single-user system (shared token store, vector DB)
- **No Rate Limiting**: API endpoints unprotected
- **Secrets in .env**: No secret manager integration
- **HTTP Only**: No HTTPS/TLS in dev mode