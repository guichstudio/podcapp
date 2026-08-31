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
- [x] Phase 2 — Editorial : DONE. Rubric passed 2026-08-31, Louis scored 4/5 average on `phase2_script_2026-08-29-audio/episode.mp3` (gate was 3.5). **Both quality gates of the project are now cleared.**
- [~] Phase 3 — Audio + private RSS : LIVE on Cloudflare R2 since 2026-08-31. Feed + audio publicly reachable, valid RSS 2.0, range requests OK. Remaining: Louis confirms it plays in his podcast app, and no cover art yet.
- [x] iOS app v2 (`ios/`, out of the original V1 scope, Louis asked for it 2026-08-31): the Claude Design app implemented in SwiftUI. Four tabs (Aujourd'hui, Lire, Sources, Réglages), AVPlayer streaming from R2 with chapter ticks, sources sheet, mini player that survives tab changes. Verified in the simulator against production data. Earlier single-screen version: builds clean against the iOS 17.5 SDK, runs in the simulator, verified end to end in the simulator on 2026-08-31: Briefing appears in Safari's share sheet, and sharing blog.samaltman.com/the-merge landed the source in Neon.
- [x] Phase 4 — Live capture AND cloud generation : DONE 2026-08-31. `/ingest` live; Trigger.dev v4 runs `process-source` and `generate-episode` (generate, publish, feed, console) in the cloud. First cloud episode: 4 min 35 of compute, 0.93 cents of Trigger.dev compute, episode ready with 23 sentences checked, 2 rewritten, 1 cut. The app's Generate button is real, guarded by a 409 while a run is active and a 30 min stale-run reaper. Email inbound and the daily cron remain unbuilt (open question: on-demand only for the beta).

**Now:** the whole loop runs with ZERO laptop involvement: save from the phone, the cloud processes and generates, the feed updates. The laptop commands remain as a manual fallback.
**Next action:** Louis reads (or listens to) the latest `eval/out/episode-*/script.md` and scores it with `eval/rubric.md` (gate: avg ≥ 3.5). Iterate on prompts in `src/prompts/` if below. Commands: `pnpm eval:run` (sources → stories), `pnpm eval:episode` (stories → script, ~$0.43, ~8 min).
**Known polish items (non-blocking):** the extraction heuristic now weighs prose density (2026-08-31) and rejects the AP 'Page Not Found' case at 0.20 with no regression on the 49 cached web sources (all real articles land >= 0.42). Two section indexes still pass: Le Monde /pixels (0.71) and bbc.com/news (0.72), because Jina extracts their cookie-consent modal as long prose (118 KB of it for Le Monde). Next idea, cheap and precise: compare the requested URL path with the final URL Jina returns, since a dead article link redirecting UP to its section is exactly the failure that matters once capture is live. Playwright fallback still unimplemented (not needed on this dataset).

**Deferred to Phase 4 on purpose (do not hack around them earlier):** the synchronous ffmpeg assembly runs inside the API process and blocks the event loop for the whole encode; an episode stranded in a non-terminal status (queued/editing/tts/assembling) by a restart has no recovery sweep. Both are what the Trigger.dev job runner exists to solve.
**Blockers:** rubric score from Louis on `phase2_script_2026-08-29-audio/episode.mp3` (14m03s).
ffmpeg ships with the repo via the `ffmpeg-static` dev dependency: no Homebrew, no system install. `pnpm reassemble <chapters-dir>` rebuilds episode.mp3 from existing chapters without spending TTS credits.

**Capture loop verified on Louis's own iPhone (2026-08-31 19:06 UTC):** app installed via `xcrun devicectl`, token accepted, and an article shared from Safari reached Neon. Two device prerequisites, both one-time: Developer Mode (Settings > Privacy & Security, only appears after a first install attempt) and trusting the certificate (Settings > General > VPN & Device Management). A free Apple ID signature expires after 7 days; reinstalling from Xcode renews it.

**Known capture limitation:** a Facebook share wrapper (`facebook.com/share/r/...`) is an interstitial redirect with no article text, so it lands `low_quality` at 0.2 with a readable reason rather than becoming a fabricated story. Share the underlying article URL instead. The same will hold for any consent-walled or JS-rendered page until the Playwright fallback exists.

**Capture loop (2026-08-31):** `POST https://podcapp.vercel.app/ingest` with `Authorization: Bearer <api_token>` and `{url}` | `{text}` | `{html,subject}` records a source in about 200 ms and returns 202. It does NOT process: `pnpm process:pending [email]` drains the queue on the laptop (extract, analyse, embed, cluster), about a minute and $0.0015 per source. Deploy with `vercel deploy --prod --yes`; Vercel builds from the linked GitHub repo, so commit and push BEFORE deploying or you ship the previous code (this cost one debugging cycle).

**Three production-only failures worth remembering** (none reproduce locally): the node-postgres pool exhausts its connections in a serverless invocation; under the Node adapter every request that reads its body hangs to the gateway timeout because Vercel has already consumed the raw stream, so the function runs on the edge runtime; and `@neondatabase/serverless` v1 removed the call form drizzle 0.38's neon-http session uses, so it is pinned to 0.10.

**iOS app v2 (2026-08-31):** design decoded from a bundled `.dc.html` (base64 + zlib resources on one line; the decoder is in the git history of this session). Sources kept at `ios/design/` and Inter Tight extracted to `ios/Podcapp/Resources/`. The three ttf files are MISNAMED relative to their PostScript names (Regular contains InterTight-Medium, SemiBold contains InterTight-Bold), which `Typo` handles. The app needs read endpoints that did not exist: `GET /episodes`, `GET /episodes/:id`, `GET /sources` were added to the edge function. `R2_PUBLIC_BASE_URL` must be set in Vercel or /episodes 500s with a readable reason (it did, once).

**Onboarding + identity (2026-08-31):** 6-screen onboarding from the second Claude Design bundle (`ios/design/onboarding-*`), app renamed Podcapp with the logo as AppIcon. The design's sixth screen offers Apple/Google sign-in, which does not exist: it asks for the API token instead. TRAP FIXED: `UserDefaults(suiteName:)` returns nil in a build without the App Group entitlement (any unsigned simulator build) and every Config write silently vanished, so the token "saved" and then authenticated empty. Config now falls back to .standard; `Config.sharesStorageWithExtension` says whether the extension can see the token.

**SCOPE CHANGE (Louis, 2026-08-31): the product is for a group of beta testers, not one person.** The schema and API were multi-user from day one (per-user tokens, per-user feeds), so the architecture holds. What it actually requires: (1) an account/auth endpoint, since Sign in with Apple needs the paid developer program and a token exchange endpoint; (2) generation off the laptop, i.e. Trigger.dev (Phase 4 as designed); (3) TestFlight for distribution (same paid program); (4) a cost model: about $2.36 per episode per user on Louis's keys.

**Deliberately inert in the app, do not "fix" by faking:** the Générer button and the source actions (Exclure, Relancer) have no endpoints, because generation takes about ten minutes of LLM, TTS and ffmpeg and cannot run in a serverless function. The sources sheet shows each chapter's sources but says plainly that the per-sentence grounding detail is not exposed yet: it lives in `episodes/<id>/run/grounding.json` on R2, and surfacing it is the clear next improvement, since claim-by-claim provenance is the product's whole point.

**iOS app v1 (2026-08-31):** `ios/` holds a SwiftUI app plus a share extension, generated from `ios/project.yml` by XcodeGen (edit the yaml, regenerate; do not reshape targets by hand). `xcodebuild -scheme Podcapp -sdk iphonesimulator` succeeds. Verified in the simulator: the UI renders, and the extension's whole premise works, since the app reads back a token written externally into the `group.com.louisguichard.podcapp` suite. The full round trip is verified: the in-app connection test wrote a source, and the share extension recorded a URL shared from Safari. The simulator panel needs `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (done 2026-08-31): `xcode-select -p` can resolve to Xcode while the system symlink still points at CommandLineTools, which is what the tooling checks. TestFlight needs the 99 USD/year program; running on his own iPhone does not.

**Test console (2026-08-31):** `pnpm console:publish <email>` writes a static page at `console/<rss_token>.html` (plus a webmanifest, so it installs to the home screen). It renders each episode with a player, the accuracy panel from the run metrics, and every chapter with its sources: the debug trail of ARCHITECTURE section 9, readable from a phone with no server. Same rss_token as the feed, since the bucket is public.

**Live delivery (2026-08-31):** R2 bucket `podcapp`, public base `https://pub-be13f3d993e94bdaab8e37c5a4e16d35.r2.dev`. `pnpm storage:check` proves a round trip and that the public URL is anonymously fetchable. `pnpm feed:publish <email>` writes the feed as a STATIC object at `feeds/<rss_token>.xml`, so a podcast client can subscribe with no server running: generation stays on the laptop, delivery is hosted. The API's own `/rss/:token` route still exists for when it is deployed. Neon IS the app database since 2026-08-31 (DATABASE_URL in .env, quoted: the URL contains an & that breaks shell sourcing otherwise). Migrations applied there, user and episode carried over with their original tokens so the feed URL stayed valid, and the 17 sources the episode cites were copied from the eval DB so the console can show them.

**Phase 3 surface** (all local, no external account yet): `pnpm inspect create-user <email>` mints api/rss tokens and prints the feed URL; `pnpm inspect cover <file.jpg>` sets the podcast artwork; `pnpm dev` serves `POST /ingest`, `POST /episodes`, `GET /episodes/:id`, `GET /admin/runs/:episodeId[/:name]`, `GET /rss/:token[.xml]` (public by token) and `GET /media/episodes/<uuid>/episode.mp3` (public, Range-capable, allowlisted to that one key shape plus the cover). Audio and run artifacts live in `.data/storage` behind the `Storage` interface in `src/storage/`; the R2 driver is the only thing that changes when credentials arrive.

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
| 2026-08-31 | TTS stays on `eleven_multilingual_v2`, Louis chose it after hearing the same chapter on all three models | Resolves ARCHITECTURE §13 on evidence rather than on a price sheet. Measured cost per episode: $1.93 of TTS (12,861 chars) plus $0.43 of LLM, not the $2-4 the guardrail assumed. Flash would cost $0.64 and turbo $0.96; quality outranks cost in the hierarchy |
| 2026-08-31 | Phase 2 rubric passed at 4/5 (gate 3.5), on the 14 min episode of 2026-08-29 | The editorial approach is validated: from here, prompt changes must beat 4/5, not merely produce something |
| 2026-08-31 | Test console as a static page on R2, not a PWA player or a capture surface | iOS Safari does not implement the Web Share Target API, so a PWA cannot receive a shared link: the Apple Shortcut stays the capture path. As a player it would only lose to Overcast. As an inspection surface it adds what RSS cannot carry: sources per chapter and the accuracy panel |
| 2026-08-31 | Feed published as a static object on R2, not only served by the API | A public bucket plus a static feed.xml means Louis can subscribe from his phone today, with zero server deployed; the API route stays for later |
| 2026-08-31 | Storage = Cloudflare R2 (Louis's call over reusing his existing Supabase) | Both free; R2 has zero egress fees, which matters when a podcast client downloads every episode |
| 2026-08-31 | Public `/media/*` allowlisted to `episodes/<uuid>/episode.mp3` plus the cover key | It served the whole storage namespace: the episode uuid is published in the feed, so anyone with a feed URL could read run artifacts (script, grounding, costs) and chapters. Verified closed against 33 evasion shapes |
| 2026-08-31 | Grounding treats a missing verdict as unsupported (retry once, then drop and report) | The grounder could return fewer verdicts than sentences sent; those shipped unverified, were absent from the report, and still counted as checked |
| 2026-08-31 | `isCheckable` sends any capitalized entity to the grounder, whether or not the evidence mentions it | It was inverted: a name absent from the evidence (the most dangerous hallucination) counted as nothing to check. Measured cost: 2 of 8 sentences of ordinary FR prose are now checked |
| 2026-08-31 | Deterministic `editDrift` guard: an edited chapter is rejected when the edit adds a number, quote or name, or drops a hedge | Grounding ran before the edit pass and the editor's output shipped unverified: "environ 100 millions" could become "100 millions". Cheaper and more predictable than re-grounding edited prose |
| 2026-08-31 | Intro and outro are grounded against the aired stories' claims | They were written after the grounding loop and shipped unchecked, which is exactly where a framing number gets invented |
| 2026-08-31 | `publishEpisode` alone writes 'ready', actualSec, audioBytes and flips stories to 'aired' | Stories were aired by generateEpisode before any audio existed, so a TTS failure permanently consumed saved content |
| 2026-08-31 | Enclosure size read from `episodes.audio_bytes`, never by re-reading the mp3 | A feed poll pulled the whole catalogue into memory: measured 105 MB per poll at 21 episodes, 1.43 GB RSS under 30 concurrent polls |
| 2026-08-30 | ffmpeg via the `ffmpeg-static` npm package, not a system install | Louis has neither Homebrew nor ffmpeg; the binary now travels with the repo and any machine running `pnpm install` gets it |
| 2026-08-30 | `assemble()` probes the chapters' sample rate + channel layout and generates matching silence, then asserts output duration >= sum of chapters | The concat demuxer SILENTLY dropped 31s when stereo silence met mono chapters; silent audio loss must fail loudly |
| 2026-08-30 | Phase 3 TTS started early to hear the Phase 2 script: `src/speech/elevenlabs.ts` (per-chapter + request stitching), `src/audio/assemble.ts`, `pnpm tts <script> --voice <id>` | Louis asked for audio of the generated script; the provider was needed anyway |
| 2026-08-30 | Voice for this render: `MAZdzkb78f8SA7DNBT41` "Nico - French Ads" (parisian male). Public library voice ids work directly in TTS without adding them to the account | The key lacks `add_voice_from_voice_library`, but the synthesis endpoint accepts the id as-is |
| 2026-08-30 | WORDS_PER_MINUTE 150 → 140, measured (1973 words / 842.8s of real French TTS) | Duration targeting was systematically short; now calibrated on real audio |
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
- Similarity thresholds (0.86 merge / 0.70 review) tuning
- First beta: daily cron vs on-demand only

---

## Practical notes

- Repo lives at `~/Code/podcapp` since 2026-08-29 (macOS TCC blocks the app's access to `~/Desktop`; the Desktop copy is stale).
- `.env` (gitignored) holds ELEVENLABS_API_KEY; add the other keys there.

## Reference material (`docs/reference/`, not V1 scope)

- `podcast-appearances-skill.md` (from Alexandre): transcript source ladder → YouTubeExtractor spec for V1.1; "follow a person" protocol → candidate V2 discovery ingestion mode. Same evidence discipline as this project's grounding — hold scripts to that standard. Do not let it pull V1 toward agentic browsing.
