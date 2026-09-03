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
          ],
        },
      })
    },
  }
}
