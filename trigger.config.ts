import { ffmpeg } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'

export default defineConfig({
  // The podcapp project on Louis's Trigger.dev account.
  project: 'proj_ppdrrnrfsnmtqphobkec',
  dirs: ['./src/trigger'],
  // Compute-time budget per run. A 15-min episode is minutes of TTS plus ffmpeg
  // assembly, and generation on top when the writer is slow: 900s leaves room
  // without letting a hung run burn an hour.
  maxDuration: 900,
  retries: {
    enabledInDev: false,
    // Applies to tasks that do not set their own retry. generate-episode opts
    // out (see src/trigger/tasks.ts): a retry there would re-pay writer + TTS.
    default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10_000, factor: 2, randomize: true },
  },
  build: {
    // Apt-installs ffmpeg onto PATH in the deployed image; assemble() probes
    // ffmpeg-static first and falls back to the bare 'ffmpeg' on PATH.
    extensions: [ffmpeg()],
    // ffmpeg-static resolves its binary from its own package directory at
    // require time; bundling it would bake a path into the bundle that does not
    // exist. Kept external it is installed on the image and resolves to a Linux
    // binary, with the apt ffmpeg above as the fallback either way.
    external: ['ffmpeg-static'],
  },
})
