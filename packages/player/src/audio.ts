//! Audio playback support for the Player.
//!
//! Non-visual `<Audio>` nodes ride in the scene graph; the player finds them here
//! and plays them via plain `<audio>` elements, synced to play/pause + scrub at
//! the player's volume. (Export muxes the same nodes via the native pipeline.)

/** The minimal scene-node shape this walker touches. */
interface AudioSceneNode {
  kind?: {
    type?: string
    src?: string
    start?: number
    start_at?: number
    volume?: number
  }
  children?: AudioSceneNode[]
}

/** An audio clip to play for preview. */
export interface AudioClip {
  src: string
  /** Composition time (seconds) the clip begins at. */
  start: number
  /** Seconds into the source to begin from (trim the head). */
  startAt: number
  /** Linear gain, 0..1. */
  volume: number
}

/** Collect every `<Audio>` clip in a scene (non-visual; the player plays them). */
export function collectAudioClips(root: AudioSceneNode | undefined): AudioClip[] {
  const out: AudioClip[] = []
  const walk = (node: AudioSceneNode | undefined) => {
    if (!node) return
    const k = node.kind
    if (k?.type === 'audio' && typeof k.src === 'string' && k.src.length > 0) {
      out.push({
        src: k.src,
        start: k.start ?? 0,
        startAt: k.start_at ?? 0,
        volume: k.volume ?? 1,
      })
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return out
}
