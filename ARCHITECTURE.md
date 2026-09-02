# Podcast Engine — V1 Architecture (MVP)

> Working spec for Claude Code sessions. When a tradeoff appears, resolve it with this hierarchy:
> **editorial quality > accuracy/trust > low-friction capture > reliability > latency > cost > feature breadth.**
> Never sacrifice script quality to ship faster or cheaper.

## 0. Product in one line

Saved content (URLs, forwarded newsletters) → one editorial audio briefing, claim-grounded, source-traceable, delivered to the user's own podcast app via a private RSS feed.

The experiment is NOT "text → audio". It is: can the system select, organize and explain the user's saved information better than the user would themselves.

---

## 1. V1 scope — locked

**IN**
- Generic URL ingestion (`POST /ingest`) + email forwarding (inbound webhook)
- Extraction (Jina Reader → Playwright/Readability fallback) with quality scoring
- Structured source analysis (claims, entities, topics) — cheap model
- Embedding + exact/semantic dedup + story clustering
- LLM editorial pass: story selection + airtime budget + outline (one strong-model call)
- Sectioned script writing (frontier writer) → targeted grounding check → single edit pass
- Chaptered TTS (ElevenLabs, request stitching) → FFmpeg assembly (loudnorm)
- Private RSS feed per user (this replaces any player/app in V1)
- Golden dataset + eval runner + human rubric — **built first, drives everything**
- Minimal debug endpoint exposing every intermediate artifact per episode

**OUT (V1.1+, do not build, do not scaffold "for later")**
- YouTube, PDF, X/Twitter (beyond graceful failure), Gmail OAuth
- Deep Dive mode, multi-speaker, music
- iOS app / share extension → replaced by an **Apple Shortcut** that POSTs to `/ingest`
- Interest-score profile, knowledge graph, contradiction detection
- Self-hosted models, fine-tuning
- Web UI beyond what auth/debug strictly requires

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 22 + TypeScript (strict) | Single deployable monolith |
| HTTP | Hono | Tiny, fast, deploys anywhere |
| Jobs | Trigger.dev (v4) | Durable runs, retries, concurrency, dashboard. No Temporal. |
| DB | Postgres (Neon) + pgvector | Drizzle ORM + migrations |
| Object storage | Cloudflare R2 | Audio + raw payloads + run artifacts. Zero egress fees (we serve audio). |
| LLM | Thin provider abstraction, per-stage routing | DeepSeek for cheap/reasoning stages, frontier model for writing. See §6. |
| Embeddings | `text-embedding-3-small` (1536 dims) | Behind interface; dims live in one config constant |
| TTS | ElevenLabs behind `SpeechProvider` | `eleven_multilingual_v2` default; benchmark Flash on eval for cost |
| Audio | FFmpeg | concat + loudnorm |
| Email in | Postmark inbound webhook | Alternative: Cloudflare Email Workers |
| Extraction | Jina Reader (`https://r.jina.ai/{url}`) → fallback Playwright + `@mozilla/readability` | |
| Logs | pino structured logs | Plus persisted per-run artifacts (§9) |

No STT in V1 (no YouTube).

---

## 3. Repo layout

Single package. No monorepo, no premature splitting.

```
src/
  api/            # Hono routes: ingest, episodes, rss, admin
  jobs/           # Trigger.dev tasks: processSource, generateEpisode
  core/           # domain types + zod schemas (Source, Story, Outline, Script, Episode)
  db/             # drizzle schema, migrations, queries
  llm/            # LLMProvider impls (deepseek, anthropic, openai-embeddings), routing, callStructured()
  prompts/        # versioned prompt assets: analyzer.v1.ts, editorial.v1.ts, writer.v1.ts, grounding.v1.ts, edit.v1.ts
  extract/        # extractors: web.ts, email.ts, text.ts + quality scoring
  speech/         # SpeechProvider: elevenlabs.ts
  audio/          # assemble.ts (ffmpeg)
  rss/            # feed.ts (podcast RSS 2.0 + itunes tags)
  config.ts       # all tunable constants (thresholds, models, durations)
eval/
  dataset/        # 50 fixed sources: urls.json + cached extractions (committed)
  run.ts          # full pipeline from cached sources → artifacts + auto-metrics
  rubric.md       # human 1–5 scoring sheet
```

**Rules for this repo**
- zod-validate every LLM output. Never trust model output shape.
- Pipeline stages are pure functions `(input) => output`; IO (db, R2, APIs) at the edges, in the jobs layer.
- Never edit a prompt in place: copy to `*.vN+1.ts`, switch in config. `prompt_versions` recorded on every episode.
- Provider-specific code never leaks outside `llm/`, `speech/`, `extract/`.
- After any pipeline/prompt change: `pnpm eval:run` and compare metrics before merging.

---

## 4. Data model (SQL — implement via Drizzle)

Six tables. JSONB over micro-tables. Claims live inside `sources.analysis` and `stories.claims` — no separate claims/entities/topics tables in V1.

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  api_token text unique not null,        -- bearer for /ingest + /episodes
  rss_token text unique not null,        -- unguessable, in the feed URL
  output_language text not null default 'fr',
  voice_id text,                          -- ElevenLabs voice
  target_minutes int not null default 15,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  type text not null check (type in ('web','email','text')),
  url text,
  canonical_url text,
  source_hash text not null,             -- sha256(canonical_url || clean_text head)
  title text, author text, publisher text,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  lang text,
  raw jsonb,                             -- original extraction payload, never destroyed
  clean_text text,
  analysis jsonb,                        -- SourceAnalysis (see §5)
  embedding vector(1536),
  extraction_quality real,               -- 0..1 heuristic
  status text not null default 'received',
    -- received|extracting|analyzed|ready|extraction_failed|low_quality|unsupported|duplicate
  error text,
  unique (user_id, source_hash)
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  headline text not null,
  topic text,
  source_ids uuid[] not null,
  claims jsonb not null default '[]',    -- merged claims with source_id + evidence_quote + confidence
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  status text not null default 'open'    -- open|aired
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  type text not null default 'briefing',
  title text,
  status text not null default 'queued',
    -- queued|selecting|outlining|writing|grounding|editing|tts|assembling|ready|failed
  target_sec int not null,
  actual_sec int,
  story_ids uuid[] not null default '{}',
  outline jsonb,
  script jsonb,                          -- see Script shape §5
  audio_url text,
  cost jsonb,                            -- {llm:{stage:{in,out,usd}}, tts_chars, tts_usd, total_usd}
  prompt_versions jsonb,                 -- {analyzer:'v1', writer:'v2', ...}
  failed_stage text,
  created_at timestamptz not null default now()
);

create table explained_concepts (
  user_id uuid not null references users(id),
  concept text not null,
  last_explained_at timestamptz not null,
  episode_id uuid,
  primary key (user_id, concept)
);

create table events (
  id bigserial primary key,
  user_id uuid,
  name text not null,                    -- source_submitted, source_failed, episode_ready, ...
  payload jsonb,
  created_at timestamptz not null default now()
);
```

No custom jobs table — Trigger.dev owns run state; `sources.status` / `episodes.status` are the domain view.

---

## 5. Pipeline

```
processSource:   ingest → extract → analyze → embed → dedupe/cluster → ready
generateEpisode: select+outline → write (per section) → ground → edit → tts (per chapter) → assemble → publish RSS
```

Two Trigger.dev tasks. Every step: idempotent, independently retryable, advances a status column, persists its artifact.

### 5.1 extract
- Try Jina Reader; compute `extraction_quality` from clean length, link density, boilerplate ratio.
- If quality < `MIN_EXTRACTION_QUALITY` → fallback Playwright + Readability on rendered DOM.
- Still bad → status `low_quality` or `extraction_failed` with a human-readable `error` (paywall, unavailable, unsupported). **Never fail silently.**
- Email path: run Readability directly on the forwarded HTML body.
- Idempotency: upsert on `(user_id, source_hash)`; a hit short-circuits the whole task (status `duplicate` on the new submission, reuse the existing Source).

### 5.2 analyze — cheap model, structured output
```ts
SourceAnalysis = {
  summary: string,               // ≤ 3 sentences
  topics: string[],
  entities: string[],
  claims: {
    text: string,                // atomic, self-contained
    type: 'fact'|'number'|'quote'|'interpretation',
    evidence_quote: string,      // verbatim span from clean_text
    confidence: number
  }[],
  importance: number, novelty: number
}
```

### 5.3 dedupe / cluster
1. Exact: canonical_url / source_hash match → attach to existing source/story.
2. pgvector cosine against `open` stories of this user:
   - `>= SIMILARITY_MERGE (0.86)` → merge into story (append source_id, merge claims, bump last_seen_at).
   - `SIMILARITY_REVIEW (0.70) .. 0.86` → cheap-model adjudication call: same story or not.
   - `< 0.70` → new story.
3. Story embedding = centroid of member source embeddings.

### 5.4 select + outline — ONE strong-model call
Input: compact digests of all `open` stories, `target_sec`, last N episode titles+summaries, the user's `explained_concepts` list.
Output (zod):
```ts
Outline = {
  intro: string,                                   // guidance, not prose
  sections: { story_id: string, airtime_sec: number, angle: string,
              why_it_matters: string, new_information: string[],
              transition_hint: string }[],
  discarded: { story_id: string, reason: string }[],
  outro: string
}
```
Airtime is budgeted **before** any prose exists. Sum of sections + 60s intro/outro ≈ target_sec.

### 5.5 write — frontier model, per section
Each call receives ONLY: the outline section, the story's claims + evidence_quotes, user language, style preset NEWS.
System prompt hard rules: facts only from supplied evidence; distinguish fact from interpretation; if confidence is low, hedge or omit; no re-explaining concepts in `explained_concepts`; density over filler.
Sentences are the unit — writer outputs plain prose per section, ~150 wpm budgeted to `airtime_sec`.

### 5.6 ground — cheap model, targeted
Only sentences containing digits, a known entity, or a quote. Per section, one call:
`{ sentence, supported: boolean, claim_refs: string[], fix?: string }[]`
Unsupported → apply `fix` (rewrite) or drop the sentence. **No script reaches TTS with an unsupported factual sentence.** Persist the grounding report.

### 5.7 edit — one full-script pass (style + tightening merged; no separate "anti-AI" stage)
- First, deterministic regex blocklist (free, in code), EN + FR:
  `let's dive in`, `it's important to note`, `in today's fast-paced world`, `here's the thing`, `game-changer`, `fascinating`, `plongeons`, `il est important de noter`, `dans un monde en constante évolution`, `force est de constater`, `véritable révolution`…
- Then one frontier-model pass: rhythm, transitions, kill repetition/rhetorical-question spam, keep facts byte-identical (instruct: do not alter numbers, names, quotes).
- Output = final `Script`:
```ts
Script = { chapters: { story_id: string|null, title: string, text: string,
                       source_ids: string[] }[] }   // intro/outro = chapters with story_id null
```
- After `ready`: upsert this episode's newly explained entities into `explained_concepts`.

### 5.8 tts — per chapter, parallel
- One ElevenLabs request per chapter with `previous_text` / `next_text` (request stitching) to keep prosody continuous across chunks.
- Store per-chapter mp3 in R2 (`episodes/{id}/chapters/{n}.mp3`) → retries and partial regeneration are per-chapter.
- Record chars + settings + voice + model on the episode.

### 5.9 assemble
FFmpeg: concat demuxer → 300 ms silence between chapters → `loudnorm=I=-16:TP=-1.5:LRA=11` → final mp3 → R2 → `audio_url`, `actual_sec`.

### 5.10 publish
Regenerate `/rss/{rss_token}.xml` (podcast RSS 2.0 + itunes tags, enclosure → R2 URL). The user subscribes once in Apple Podcasts/Overcast; episodes just appear.

---

## 6. Model routing — config, not architecture

```ts
// src/config.ts — swapping a stage's model must never require code changes
export const MODELS = {
  analyze:    { provider: 'deepseek',  model: 'deepseek-v4-flash' },
  adjudicate: { provider: 'deepseek',  model: 'deepseek-v4-flash' },
  editorial:  { provider: 'deepseek',  model: 'deepseek-v4-pro'  }, // reasoning: selection + outline
  ground:     { provider: 'deepseek',  model: 'deepseek-v4-flash' },
  write:      { provider: 'anthropic', model: 'claude-sonnet-5'   }, // benchmark claude-opus-5 on eval
  edit:       { provider: 'anthropic', model: 'claude-sonnet-5'   },
  embed:      { provider: 'openai',    model: 'text-embedding-3-small' },
} as const
```

- ⚠️ Verify model IDs against provider docs at implementation time (Anthropic: https://docs.claude.com/en/docs_site_map.md ; DeepSeek: platform docs). IDs move.
- All calls go through `llm.callStructured(stage, zodSchema, input)` → validates, logs tokens + USD into `episodes.cost`.
- Keep stable prompt content as the **prefix** of every request (system + few-shots first, variable input last): DeepSeek context caching then bills repeated input at the cache-hit rate automatically.
- The writer stays frontier-class. Cost is optimized on analyze/adjudicate/ground/editorial — never on the writer. That decision is only revisited via eval rubric scores, not via a price sheet.

Cost guardrails (order of magnitude): LLM ≤ ~$0.15/episode, TTS ~$2–4/episode (multilingual_v2) — TTS dominates; that's where any future cost work goes.

---

## 7. API

```
POST /ingest                Bearer api_token   { url } | { text } | { html, subject }  → 202 { source_id }
POST /ingest/email          Postmark inbound webhook (token-verified)
POST /episodes              Bearer             { target_min? }                        → 202 { episode_id }
GET  /episodes/:id          Bearer             status, script, sources, cost
GET  /rss/:rss_token.xml    public-by-token    podcast feed
GET  /admin/runs/:episodeId Bearer (owner)     links to every persisted artifact
```

Auth V1 = Sign in with Apple → an opaque per-device session token
(`sessions.token`), revocable from Réglages. The server also verifies Google
identity tokens (`POST /auth/google`) and rejects every request while
`GOOGLE_CLIENT_ID` is unset — that route is ready, but no button in the iOS
app calls it yet, so Google sign-in is not something the shipped app does.
`users.api_token` subsists as a service key for the CLI and eval, and for the
Apple Shortcut capture path (§8); the app never uses it.

---

## 8. Capture (no iOS app)

- **Apple Shortcut** in the share sheet → `POST /ingest` with the shared URL/text + the user's token. 0 days of dev, 90% of the share-extension value. Publish the shortcut as an install link.
- Email: user forwards newsletters to their inbound address.
- Later (V1.1+): real share extension — its actual edge is capturing the rendered DOM in Safari, which handles paywalls the user legitimately has access to.

---

## 9. Observability

Persist to R2 under `episodes/{id}/run/`: selected stories, outline, per-section drafts, grounding report, final script, per-chapter audio, cost breakdown. `GET /admin/runs/:id` links them. This debug trail is a feature, not a nice-to-have — quality failures happen upstream and must be inspectable.

Log per stage: latency, tokens, cost, retry count, failure stage.

---

## 10. Eval — built FIRST (it drives every other decision)

- `eval/dataset/`: 50 fixed sources (FR + EN mixed) across AI / markets / crypto / photography / culture / general news. **Extractions cached and committed** → runs are reproducible and free of network flakiness.
- `pnpm eval:run` → full pipeline from cached sources → episode artifacts + auto-metrics:
  - duplicate-story rate (target < 10%)
  - unsupported-claim rate post-grounding (target ~0)
  - blocklist hits in final script (target 0)
  - duration accuracy vs target (±15%)
  - tokens + USD per stage
- `eval/rubric.md`: human 1–5 on density, accuracy, interest, repetition, naturalness, trust, pacing, "would I listen again". Plus: what should have been cut / what was missing / what felt AI-generated.
- Any prompt or model change = one eval run + rubric pass before merge.

---

## 11. Implementation phases (each has a Definition of Done)

**Phase 0 — Manual golden path (day 1–2, no code)**
Pick 5–8 real saved links (FR + EN mixed). In a chat session, run the editorial stages by hand with draft prompts: analyze each source → select + airtime budget → outline → write per section (supplied evidence only) → grounding check against the sources → edit pass. Paste the final script into ElevenLabs (any chat→audio tool works — the pipe is not what's being tested). Listen end-to-end, score with `eval/rubric.md`.
DoD: a ~10-min episode worth listening to again (rubric ≥ 3.5). Keep the draft prompts — they seed `src/prompts/`. If the hand-made script isn't worth listening to, iterate on the editorial approach here, not on infrastructure.

**Phase 1 — Knowledge layer (week 1)**
Scaffold, DB, `processSource` on the golden dataset (extract → analyze → embed → cluster). CLI/endpoint to inspect stories.
DoD: 50 sources → coherent story clusters, dup rate < 10%, artifacts inspectable.

**Phase 2 — Editorial (week 2)**
`generateEpisode` through the final script: select+outline → write → ground → edit.
DoD: a 15-min script from the dataset with zero unsupported factual sentences and avg rubric ≥ 3.5. Iterate on prompts here — this phase is the product.

**Phase 3 — Audio + delivery (week 3)**
TTS, assembly, private RSS.
DoD: episode plays in Apple Podcasts/Overcast, consistent loudness, chapters in order.

**Phase 4 — Live capture (week 4)**
`/ingest` live, Postmark inbound, Apple Shortcut, daily cron (optional) + on-demand generation.
DoD: save from phone → next briefing includes it, failures produce a readable status.

Do not start phase N+1 with phase N's DoD unmet. Phase 0 and Phase 2 are the quality gates for the whole product.

---

## 12. Env vars

```
DATABASE_URL
DEEPSEEK_API_KEY
ANTHROPIC_API_KEY
OPENAI_API_KEY            # embeddings only
ELEVENLABS_API_KEY
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_BASE_URL
TRIGGER_SECRET_KEY
POSTMARK_INBOUND_TOKEN
JINA_API_KEY              # optional (higher rate limits)
```

---

## 13. Open decisions (resolve during build, on evidence)

- Writer model final choice (`claude-sonnet-5` vs `claude-opus-5`) → decided by eval rubric, not by default.
- ElevenLabs `multilingual_v2` vs Flash tier → same.
- Neon vs Supabase (Neon default; switch only if a reason appears).
- Merge/review similarity thresholds → tune on the dataset.
- Daily cron generation vs on-demand only for the first beta.

---

## 14. Reference material (`docs/reference/`, NOT V1 scope)

- `podcast-appearances-skill.md` (from Alexandre): a rigorous person→podcast-appearances research protocol. Two reusable pieces, later:
  - the **transcript source ladder** (official transcript → channel captions → platform captions → reputable third-party → local STT from legally accessible audio) = the spec for the YouTubeExtractor in **V1.1**;
  - the "follow a person" discovery protocol = candidate **V2** pull-ingestion mode (feeds the discovery/surprise budget with a real corpus).
- Its evidence discipline (honest gap > plausible reconstruction, provenance per claim, dedup by original publication date) matches this project's grounding philosophy — hold scripts to the same standard.
- Do not let it pull V1 toward agentic browsing: this product is an orchestrated pipeline, not a research agent.
