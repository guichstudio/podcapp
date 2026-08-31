import { putJson, type Storage } from '../storage/index.js'
import type { EpisodeArtifacts } from './generateEpisode.js'

// ARCHITECTURE §9: quality failures happen upstream of the audio, so every
// intermediate artifact of a run stays readable after the fact.
//
// They are written ONLY to a private store. The R2 bucket that serves audio is
// public by necessity (a podcast client cannot authenticate) and an episode id
// is published in the feed, so an artifact written there is world readable by
// anyone holding the feed URL. `script` and `grounding` live on the episode row
// instead, and the debug trail stays local unless a private bucket exists.
export const RUN_ARTIFACTS = ['outline', 'drafts', 'grounding', 'script', 'metrics'] as const

// A driver whose public URLs are anonymously fetchable must not receive them.
export function storageIsPublic(): boolean {
  return Boolean(process.env.R2_PUBLIC_BASE_URL)
}

export function runArtifactKey(episodeId: string, name: (typeof RUN_ARTIFACTS)[number]): string {
  return `episodes/${episodeId}/run/${name}.json`
}

export async function persistRunArtifacts(
  storage: Storage,
  episodeId: string,
  artifacts: EpisodeArtifacts,
): Promise<void> {
  if (storageIsPublic()) return
  for (const name of RUN_ARTIFACTS) {
    await putJson(storage, runArtifactKey(episodeId, name), artifacts[name])
  }
}
