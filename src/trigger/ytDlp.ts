import type { BuildExtension } from '@trigger.dev/build'

// yt-dlp is what gets a video's own subtitles, and its audio when there are
// none. The standalone build is used rather than the npm package: that one
// ships yt-dlp as a Python script and needs Python 3.10+ on the image, while
// this single file carries its own interpreter and needs nothing.
//
// Pinned on purpose. A floating "latest" would change the pipeline's behaviour
// without a commit, and yt-dlp is exactly the dependency that goes stale --
// YouTube changes, yt-dlp catches up. When shared videos start failing with
// "Please update yt-dlp", bump this line; that is the whole maintenance story
// and it shows up in the diff.
const YTDLP_VERSION = '2026.08.19'

// Deno solves YouTube's player challenge, which a SIGNED-IN request always
// triggers. Without it the cookie jar makes things worse rather than better:
// every video fails on "The page needs to be reloaded" where an anonymous
// request would at least have read the subtitles. Pinned for the same reason
// as yt-dlp, and installed rather than reusing the image's Node because yt-dlp
// reports Node 20 as an unsupported runtime.
const DENO_VERSION = '2.9.6'

export function ytDlp(): BuildExtension {
  return {
    name: 'YtDlpExtension',
    async onBuildComplete(context) {
      if (context.target === 'dev') return
      context.addLayer({
        id: 'yt-dlp',
        image: {
          instructions: [
            `ADD https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux /usr/local/bin/yt-dlp`,
            'RUN chmod a+rx /usr/local/bin/yt-dlp',
            // Deno ships as a zip only, so it cannot ride on ADD's own
            // extraction; the architecture is read at build time rather than
            // assumed, because a wrong guess yields a binary that installs
            // cleanly and cannot execute.
            'RUN apt-get update && apt-get install -y --no-install-recommends curl unzip && rm -rf /var/lib/apt/lists/*',
            `RUN set -eu; case "$(uname -m)" in aarch64|arm64) T=aarch64-unknown-linux-gnu;; *) T=x86_64-unknown-linux-gnu;; esac; ` +
              `curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-$T.zip"; ` +
              'unzip -q /tmp/deno.zip -d /usr/local/bin; chmod a+rx /usr/local/bin/deno; rm /tmp/deno.zip; deno --version',
          ],
        },
      })
    },
  }
}
