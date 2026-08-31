import { putJson, type Storage } from '../storage/index.js'
import type { EpisodeArtifacts } from './generateEpisode.js'

// ARCHITECTURE §9: quality failures happen upstream of the audio, so every
// intermediate artifact of a run stays readable after the fact.
export const RUN_ARTIFACTS = ['outline', 'drafts', 'grounding', 'script', 'metrics'] as const

export function runArtifactKey(episodeId: string, name: (typeof RUN_ARTIFACTS)[number]): string {
  return `episodes/${episodeId}/run/${name}.json`
}

export async function persistRunArtifacts(
  storage: Storage,
  episodeId: string,
  artifacts: EpisodeArtifacts,
): Promise<void> {
  for (const name of RUN_ARTIFACTS) {
    await putJson(storage, runArtifactKey(episodeId, name), artifacts[name])
  }
}
