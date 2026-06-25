# ShriHari Vani — Project Handoff

**Last updated:** 2026-06-18  
**Deployed at:** Vercel (check vercel.json for project name)  
**Runtime cost:** $0 — Gemini free tier only, no paid APIs in the hot path

---

## What this is

A mobile-first web app for exploring the Vachanamrut (278 discourses of Bhagwan Swaminarayan).  
Three language modes: English (`en`), Gujarati (`gu`), Hindi (`hi`).  
No database — all data is JSON files bundled with the server.

---

## File map

```
/
├── public/index.html          ← Entire frontend (single file, ~3000 lines)
├── api/server.js              ← Express backend (single file)
├── vachanamrut_corpus.json    ← 278 discourses, each with en + gu fields
├── discourses_hi.json         ← Hindi translations of all 278 discourses
├── summaries.json             ← Pre-generated discourse summaries (en/gu/hi)
├── mood_summaries.json        ← Pre-generated mood guidance (10 moods, en/gu/hi)
├── preset_answers.json        ← Pre-generated answers to 18 default questions (zero tokens at runtime)
├── .env                       ← GEMINI_API_KEY (gitignored — never commit)
├── scripts/
│   ├── generate_preset_answers.js   ← Run once to regenerate preset_answers.json
│   └── regenerate_rich.js           ← Run once to regenerate summaries + mood content
└── vercel.json                ← Serverless routing config
```

---

## Architecture

### Request flow for a custom question (`/api/ask`)

1. Check `preset_answers.json` for an exact match → serve free, no tokens
2. `expandQuery(question)` — append English corpus terms for known words (see QUERY_EXPANSIONS)
3. `topMatches(expandedQuery, searchLang, 5)` — keyword scoring to find top 5 discourses
4. Call Gemini `gemini-2.5-flash-lite` with those excerpts as context
5. Return `{ answer, citations }` to the frontend

### Language routing
- **English**: `searchLang = 'en'` → scores against `discourse.en.text`
- **Hindi**: `searchLang = 'en'` → also scores against English corpus (Hindi has no corpus field; relies entirely on query expansion to bridge the gap)
- **Gujarati**: `searchLang = 'gu'` → scores against `discourse.gu.text` + 0.6× `discourse.en.text`

### Key functions in `api/server.js`
| Function | Line | Purpose |
|---|---|---|
| `tokenise(text)` | ~101 | Splits query into tokens; preserves Devanagari + Gujarati Unicode |
| `scoreDiscoure(d, tokens, lang)` | ~111 | Keyword frequency score per discourse |
| `topMatches(query, lang, n)` | ~132 | Returns top N discourses by score |
| `expandQuery(q)` | ~538 | Augments query with corpus vocabulary |
| `QUERY_EXPANSIONS` | ~431 | Dictionary: ~30 English, ~26 Hindi, ~24 Gujarati topic clusters |

---

## Critical bug fixed in this session

**`tokenise()` was stripping all Indic characters.**  
JavaScript `\w` regex is ASCII-only. Before the fix, every Hindi/Gujarati character in a query was replaced by a space → tokens were empty → QUERY_EXPANSIONS never fired for Hindi/Gujarati → keyword search found nothing → Gemini got no context.

**The fix** (`api/server.js:106`):
```js
// Before
.replace(/[^\w\s]/g, ' ')

// After — preserves Devanagari (ऀ-ॿ) and Gujarati (઀-૿)
.replace(/[^\w\sऀ-ॿ઀-૿]/g, ' ')
```

---

## What works now
- ✅ Share cards — 1080×1080 canvas, full-bleed scene, bold quote, lang-aware attribution
- ✅ Mobile modal — A−/A+ buttons hidden on ≤500px screens (`.font-ctrl` class)
- ✅ Mood picker — bottom sheet with backdrop (not inline), body scroll locked while open
- ✅ Query expansion for English (always worked)
- ✅ Query expansion for Hindi and Gujarati (fixed this session)
- ✅ Bilingual scoring for Gujarati (gu corpus + 0.6× en corpus)
- ✅ Richer Gemini system prompt — interprets modern secular questions spiritually

---

## Known gaps / pending work

### 1. Hindi retrieval for topics NOT in QUERY_EXPANSIONS
Hindi searches the English corpus (`searchLang = 'en'`). Hindi tokens can't score against English text. Topics outside the ~26 expansion entries produce no keyword matches → Gemini gets empty context → generic fallback answer.

**Option A (quick):** Add more entries to `QUERY_EXPANSIONS` in `server.js` as users surface gaps.  
**Option B (proper):** Build a Hindi score path like Gujarati — score Hindi tokens against `discourses_hi.json` fields. Requires wiring `discourses_hi.json` into `scoreDiscoure`.

### 2. Rate limiting on `/api/ask`
No per-IP throttle. On the Gemini free tier, a burst of requests could exhaust the daily quota. Add simple in-memory rate limiting (e.g., `express-rate-limit`) or move to Gemini's paid tier.

### 3. Persistent data (Phase 2)
Streak counts and saved bookmarks live in `localStorage` — cleared on browser wipe. Supabase recommended for persistence without adding a heavy backend.

### 4. Home page typography / overall look
User mentioned wanting improvements to fonts and general aesthetics. Only the modal button clutter and mood UX were addressed in the last session.

### 5. Sarvam TTS (Phase 2)
Audio playback for discourses in Hindi/Gujarati via Sarvam AI TTS API. Not started.

### 6. Rich summaries not yet complete
`scripts/regenerate_rich.js summaries` needs to run to completion against the full 278-discourse corpus. It is resumable (`rich: true` flag per discourse). Needs `GEMINI_API_KEY` in `.env`.

---

## Environment variables

| Key | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `.env` (gitignored) + Vercel dashboard | Runtime Q&A via Gemini Flash-Lite |

**Security rule:** These keys must ONLY be set via `.env` (locally) or the Vercel environment variables UI. Never paste in chat, never commit to git.

---

## How to run locally

```bash
npm install
# Ensure .env has GEMINI_API_KEY=your_key_here
node api/server.js
# Opens on http://localhost:3000
```

## How to deploy

Push to main branch → Vercel auto-deploys.  
Vercel config in `vercel.json` routes `/api/*` to `api/server.js` and everything else to `public/`.

---

## Scripts (run once, offline)

```bash
# Regenerate preset answers for the 18 default example questions
node scripts/generate_preset_answers.js

# Regenerate rich mood summaries (10 moods × 3 languages)
node scripts/regenerate_rich.js moods

# Regenerate rich discourse summaries (278 × 3 languages — takes ~30 min)
node scripts/regenerate_rich.js summaries
```

All scripts are resumable — they skip already-completed entries.
