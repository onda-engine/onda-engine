//! In-browser image resolution.
//!
//! The wasm engine decodes `data:` URIs but can't fetch URL/path image sources
//! (there's no filesystem or fetch inside the render call). So the Player resolves
//! image `src` URLs to `data:` URIs in JS — the browser fetches + the engine's
//! existing `data:` decode path handles them. Resolved URIs are cached and shared
//! across players, so each image is fetched once.

// Resolved `url -> data: URI`. Module-level so multiple <Player>s share it.
const cache = new Map<string, string>()
const inflight = new Map<string, Promise<void>>()

/** Fetch `url` and convert it to a `data:` URI, caching the result. Failures are
 *  swallowed — the image stays unresolved and the renderer simply skips it. */
export function resolveImageUrl(url: string): Promise<void> {
  if (cache.has(url) || typeof fetch === 'undefined') return Promise.resolve()
  const existing = inflight.get(url)
  if (existing) return existing
  const p = (async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) return
      const blob = await res.blob()
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      cache.set(url, dataUri)
    } catch {
      // Leave unresolved; the renderer draws nothing for an undecoded image.
    } finally {
      inflight.delete(url)
    }
  })()
  inflight.set(url, p)
  return p
}

/** The minimal scene-node shape these walkers touch (a subset of `Scene`). */
interface ImageNode {
  kind?: { type?: string; src?: string }
  children?: ImageNode[]
}

/** Collect every non-`data:` image `src` URL in a scene tree. */
export function collectImageUrls(node: ImageNode | undefined, out: Set<string>): void {
  if (!node) return
  const src = node.kind?.type === 'image' ? node.kind.src : undefined
  if (typeof src === 'string' && src.length > 0 && !src.startsWith('data:')) out.add(src)
  for (const child of node.children ?? []) collectImageUrls(child, out)
}

/** Rewrite each resolved image `src` URL to its cached `data:` URI, in place. */
export function applyResolvedImages(node: ImageNode | undefined): void {
  if (!node) return
  if (node.kind?.type === 'image' && typeof node.kind.src === 'string') {
    const dataUri = cache.get(node.kind.src)
    if (dataUri) node.kind.src = dataUri
  }
  for (const child of node.children ?? []) applyResolvedImages(child)
}
