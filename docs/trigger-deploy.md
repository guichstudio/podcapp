# Trigger.dev deploy (one-time setup)

The two durable jobs live in `src/trigger/tasks.ts`: `process-source` (one saved
link: extract, analyze, embed, cluster) and `generate-episode` (script, TTS,
assembly, then feed + console republish). Config is `trigger.config.ts`. The
tasks refuse to run without `DATABASE_URL` and a fully configured R2 bucket:
a cloud worker falling back to its own disk would silently lose episodes.

## Steps

1. Create the account and project. Sign up at https://cloud.trigger.dev, create
   an organization and a project (v4 engine, the default).

2. Log the CLI in:

   ```
   npx trigger.dev@latest login
   ```

3. Get the project ref and paste it into `trigger.config.ts`, replacing
   `proj_ppdrrnrfsnmtqphobkec`. The ref is on the dashboard under Project settings
   (it looks like `proj_xxxxxxxxxxxx`). `npx trigger.dev@latest init` prints the
   same ref, but the config file and SDK already exist in this repo, so the
   dashboard copy-paste is all that is needed. Do not let init overwrite
   `trigger.config.ts`.

4. Set the environment variables in the dashboard (Project > Environment
   variables, on the `prod` environment):

   | Variable | What it is |
   |---|---|
   | `DATABASE_URL` | Neon Postgres connection string |
   | `DEEPSEEK_API_KEY` | analyze / adjudicate / ground / editorial stages |
   | `ANTHROPIC_API_KEY` | writer and edit stages (frontier writer, see below) |
   | `JINA_API_KEY` | embeddings + raises Jina Reader rate limits |
   | `ELEVENLABS_API_KEY` | TTS |
   | `ELEVENLABS_VOICE_ID` | fallback voice when `users.voice_id` is null |
   | `R2_ACCOUNT_ID` | Cloudflare R2 |
   | `R2_ACCESS_KEY_ID` | Cloudflare R2 |
   | `R2_SECRET_ACCESS_KEY` | Cloudflare R2 |
   | `R2_BUCKET` | the public bucket episodes and the feed are served from |
   | `R2_PUBLIC_BASE_URL` | public origin of that bucket, no trailing slash |
   | `FEED_LINK` | website URL podcast clients show for the feed (optional, falls back to the bucket root) |

   `ANTHROPIC_API_KEY` is required even though older notes omit it: the writer
   runs on Anthropic, and without the key every `generate-episode` run fails at
   the first written section.

5. Deploy:

   ```
   npx trigger.dev@latest deploy
   ```

   The `ffmpeg()` build extension in `trigger.config.ts` installs ffmpeg into
   the image and puts it on PATH; nothing to install by hand. `ffmpeg-static`
   is marked external so it resolves to a Linux binary at install time, and
   `src/audio/assemble.ts` falls back to the PATH ffmpeg if it does not.

6. Smoke-test from the dashboard (Test tab):

   ```json
   { "sourceId": "<uuid of a source row>" }
   ```

   for `process-source`, and

   ```json
   { "episodeId": "<uuid>", "userId": "<uuid>", "targetSec": 900, "language": "fr" }
   ```

   for `generate-episode` (insert the episode row first, status `queued`, the
   way `POST /episodes` does).

For local iteration, `npx trigger.dev@latest dev` runs the tasks on this
machine against the same dashboard.

## What runs where, and what an episode costs

Model routing (`src/config.ts`, changed there and only there):

| Stage | Model |
|---|---|
| analyze, adjudicate, ground | `deepseek-v4-flash` |
| editorial (select + outline) | `deepseek-v4-pro`, thinking on |
| write, edit | `claude-sonnet-5` (the writer stays frontier-class, per CLAUDE.md) |
| embeddings | `jina-embeddings-v5-text-small` |
| TTS | ElevenLabs `eleven_multilingual_v2` |

Cost per roughly 15-minute episode (order of magnitude, from ARCHITECTURE §6
and the ledger on `episodes.cost`): all LLM stages together stay under about
$0.15; TTS at $0.15 per 1,000 characters is about $2 to $4 and dominates. So
an episode costs roughly $2 to $4 end to end, plus a few minutes of small-1x
compute on Trigger.dev. Any future cost work goes at TTS, never at the writer.

## Failure behavior

- `process-source` failures land as a readable status + error on the source
  row; the task is idempotent and retries up to 3 times.
- `generate-episode` does not auto-retry: a retry after the audio was published
  would re-pay the writer and TTS for an episode that already shipped. A
  generation failure marks the episode row `failed` / `generate`; a TTS or
  assembly failure is recorded by `publishEpisode` itself. If only the feed or
  console publish fails, the episode stays `ready` (it is published and
  served); the run shows the error, and `pnpm feed:publish <email>` /
  `pnpm console:publish <email>` republish by hand.

Note: the project ref in trigger.config.ts is already the real one (fetched from
the account's management API on 2026-08-31). Do not run the dev API server
(pnpm dev) against the same database while the cloud path is live: its own
POST /episodes generates inline with no guard against cloud runs.
