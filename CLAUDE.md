# Podcast Engine — Project Memory

Working memory for build sessions (human + coding agent). **ARCHITECTURE.md is the source of truth** for scope, stack, schema, pipeline contracts and model routing — read it before any work. This file covers how we work, where we are, and what was decided.

## Priority hierarchy

Resolve every tradeoff with:
**editorial quality > accuracy/trust > low-friction capture > reliability > latency > cost > feature breadth.**
Never trade script quality for speed or cost.

---

## Current state — update at the end of EVERY session

- [x] **Phase 0 — Manual golden path** : DONE, validated by Louis 2026-08-29 (episode approved)
- [x] Phase 1 — Knowledge layer : DONE 2026-08-29 (53/54 sources, dup rate 0%, 0 wrong merges, clusters inspectable via `pnpm inspect stories`)
- [~] Phase 2 — Editorial : pipeline DONE 2026-08-29 (auto-metrics pass), rubric score PENDING
- [ ] Phase 3 — Audio + private RSS
- [ ] Phase 4 — Live capture (`/ingest`, email inbound, Apple Shortcut)

**Now:** Phase 2, waiting on the human rubric pass.
**Next action:** Louis reads (or listens to) the latest `eval/out/episode-*/script.md` and scores it with `eval/rubric.md` (gate: avg ≥ 3.5). Iterate on prompts in `src/prompts/` if below. Commands: `pnpm eval:run` (sources → stories), `pnpm eval:episode` (stories → script, ~$0.43, ~8 min).
**Known polish items (non-blocking):** extraction quality heuristic lets error pages and site landing pages through (AP 'Page Not Found', BBC/Le Monde home feeds became stories); Playwright fallback still unimplemented (not needed on this dataset).
**Blockers:** rubric score from Louis on the generated script.

**Phase 0 artifacts** (all in `phase0/`): sources (5 saved items: PDF dossier, 2 video transcripts via ElevenLabs Scribe, Species sources doc, 1 failed extraction), `analysis.md`, `outline.md`, `script_v1_draft.md`, `grounding_report.md` (4 fixes, 0 unsupported sentences shipped), `script_final.md`, `prompts.md` (seeds for `src/prompts/`), `episode_2026-08-28.mp3` (~10 min, voice `jGGIwkfv43kUFffPXEEO`). `ELEVENLABS_API_KEY` lives in `.env` (gitignored).

---

## Session ritual

1. Read ARCHITECTURE.md + this file. State which phase and which DoD this session targets.
2. Work in small verifiable increments — one pipeline stage at a time.
3. After any pipeline or prompt change: `pnpm eval:run`, compare metrics with the previous run before merging.
4. End of session: update **Current state**, append to **Decision log**, write the next action.

---

## Hard rules

- Phase gates are strict: never start N+1 with N's DoD unmet. **Phase 0 and Phase 2 are the go/no-go gates.**
- Nothing from the OUT list (ARCHITECTURE.md §1) gets built or scaffolded "for later".
- Every LLM output is zod-validated. Never trust model output shape.
- Prompts are versioned assets: never edit in place — copy to `*.vN+1.ts`, switch in `config.ts`, record `prompt_versions` on every episode.
- Provider-specific code never leaves `llm/`, `speech/`, `extract/`.
- **The writer model stays frontier-class.** Cost work happens on analyze/adjudicate/ground/editorial only, and is only revisited on eval rubric evidence.
- Pipeline stages are pure functions `(input) => output`; IO lives in the jobs layer.
- Every episode run persists ALL intermediate artifacts to R2 (`episodes/{id}/run/`). Debuggability is a feature.
- No silent failures: every failure sets a readable status + reason on the source/episode.
- Boring code. No abstractions beyond the interfaces named in ARCHITECTURE.md.

---

## Commands (keep current from Phase 1 scaffold onward)

```
pnpm dev            # api + jobs local
pnpm db:migrate
pnpm eval:run       # full pipeline from cached dataset → artifacts + auto-metrics
pnpm test
```

---

## Phase playbook

### Phase 0 — Manual golden path (no code, day 1–2)
1. Pick 5–8 real saved links (FR + EN mixed).
2. In a chat session, run the editorial stages by hand with draft prompts: analyze each source → select + airtime budget → outline → write per section (supplied evidence only) → grounding check against the sources → edit pass.
3. Paste the final script into ElevenLabs (any chat→audio pipe works — the script is what's being tested). Listen end-to-end. Score with `eval/rubric.md`.
**DoD:** a ~10-min episode worth listening to again (rubric ≥ 3.5). Keep the draft prompts — they seed `src/prompts/`. If the hand-made script isn't worth it, iterate on the editorial approach here, not on infrastructure.

### Phase 1 — Knowledge layer (week 1)
Session prompt: "Scaffold the repo per ARCHITECTURE.md §3–4 (Hono, Trigger.dev, Drizzle, config.ts). Implement `processSource` (extract → analyze → embed → dedupe/cluster) and run it on `eval/dataset`. Add a CLI/endpoint to inspect stories."
**DoD:** 50 sources → coherent clusters, dup rate < 10%, artifacts inspectable.

### Phase 2 — Editorial (week 2)
Session prompt: "Implement `generateEpisode` through the final script: select+outline → write → ground → edit, per ARCHITECTURE.md §5.4–5.7, prompts seeded from Phase 0."
**DoD:** 15-min script from the dataset, zero unsupported factual sentences, avg rubric ≥ 3.5. Iterate here — **this phase IS the product.**

### Phase 3 — Audio + delivery (week 3)
Session prompt: "Implement §5.8–5.10: chaptered ElevenLabs TTS with request stitching, FFmpeg assembly with loudnorm, private RSS feed."
**DoD:** episode plays in Apple Podcasts/Overcast, consistent loudness, chapters ordered.

### Phase 4 — Live capture (week 4)
Session prompt: "Wire `POST /ingest` + Postmark inbound + per-user auth tokens; publish the Apple Shortcut; optional daily cron."
**DoD:** save from phone → next briefing includes it; failures produce a readable status.

---

## Decision log (append-only)

| Date | Decision | Why |
|---|---|---|
| 2026-08 | Monolith TS/Hono + Trigger.dev + Neon/pgvector + R2 | Iteration speed, solo build, durable jobs without ops |
| 2026-08 | Model routing: DeepSeek V4 Flash/Pro on cheap+reasoning stages, frontier writer | Cost optimized on the small slice; quality is priority #1 |
| 2026-08 | ElevenLabs TTS, chapter-level generation with request stitching | Quality first; per-chapter retries and partial regeneration |
| 2026-08 | Private RSS feed instead of any player/app | Episodes land in the user's own podcast app; zero UI to build |
| 2026-08 | Apple Shortcut instead of iOS share extension | 90% of the value, 0 days of dev, no App Store |
| 2026-08 | Cut from V1: YouTube, PDF, X/Twitter, Deep Dive, interest scores, contradictions, agentic orchestration | Prove editorial quality first; pipeline > agent |
| 2026-08 | Phase 0 manual golden path added before any code | Validate the listening experience before building infra |
| 2026-08-28 | ElevenLabs Scribe (STT) added to the toolbox for video sources | Video transcripts unlock X/Facebook videos; same provider as TTS, one API key |
| 2026-08-28 | Sources without clean extraction are named and discarded in the outro | Trust is a feature; never summarize from memory (FLock X article case) |
| 2026-08-28 | A no-transcript video may ship on its official sources doc, hedged on air | Species video: claims doc = usable evidence if the script says so (accuracy > breadth) |
| 2026-08-29 | Brain = DeepSeek v4 (`deepseek-v4-flash`/`-pro`, ids verified via /models), embeddings = `jina-embeddings-v5-text-small` 1024 dims | Louis provided DeepSeek key ($50); Jina free tier + same key raises Reader limits |
| 2026-08-29 | `thinking: disabled` on analyze/adjudicate/ground calls | v4 models are hybrid reasoners: thinking burned the whole token budget and returned empty content on long sources |
| 2026-08-29 | SIMILARITY_MERGE raised 0.86 → 0.93 for jina-v5 embeddings; adjudicator decides 0.70-0.93 | Eval: true dups sit at 0.90-0.97 but a meta-source absorbed stories at 0.909 |
| 2026-08-29 | Editorial prompt must hard-discard reference/encyclopedia/listing pages; chapter titles written by the editor, never the source headline | First run aired Wikipedia background as news and used "BBC News - Breaking news..." as a chapter title |
| 2026-08-29 | Outro names publications (publisher, else domain), never article headlines; no moral-of-the-story editorializing | First run closed on "toutes les sources citées" plus a vigilance homily |
| 2026-08-29 | `temperature` dropped from Anthropic calls (deprecated on claude-sonnet-5); DeepSeek json_object needs the word "json" in the user prompt | Both were hard 400s on the first Phase 2 run |
| 2026-08-29 | adjudicate.v2: compare PRIMARY subjects, roundup-cites-event ≠ same story, unsure → false | v1 merged a specific article into a sources-roundup doc whose claims quoted it |
| 2026-08-29 | LLM stage cache committed in `eval/dataset/llm-cache/` (key: source hash + model + prompt version) | Eval re-runs cost ~0; only changed sources/prompts hit APIs |
| 2026-08-29 | Local/eval DB = embedded PGlite with pgvector; `DATABASE_URL` switches to Neon | Zero infrastructure for Phase 1; same schema and operators |
| 2026-08-28 | Phase 0 voice: `Louis – French Documentary Narrator` (`jGGIwkfv43kUFffPXEEO`), single TTS request when script < 10k chars | Stitching only needed beyond one request; keep the pipe simple until Phase 3 |

---

## Open questions (resolve on eval evidence, not defaults)

- Writer model: `claude-sonnet-5` vs `claude-opus-5`
- TTS voice: replace Phase 0 voice with a smoother, Jarvis-like one (Louis's feedback 2026-08-29); browse ElevenLabs library, pick on listening test
- TTS tier: `eleven_multilingual_v2` vs Flash
- Similarity thresholds (0.86 merge / 0.70 review) tuning
- First beta: daily cron vs on-demand only

---

## Practical notes

- Repo lives at `~/Code/podcapp` since 2026-08-29 (macOS TCC blocks the app's access to `~/Desktop`; the Desktop copy is stale).
- `.env` (gitignored) holds ELEVENLABS_API_KEY; add the other keys there.

## Reference material (`docs/reference/`, not V1 scope)

- `podcast-appearances-skill.md` (from Alexandre): transcript source ladder → YouTubeExtractor spec for V1.1; "follow a person" protocol → candidate V2 discovery ingestion mode. Same evidence discipline as this project's grounding — hold scripts to that standard. Do not let it pull V1 toward agentic browsing.
