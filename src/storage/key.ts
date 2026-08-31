// Keys are assembled from episode ids and fixed file names, so a key that could
// escape the bucket root is an upstream bug: fail loudly, never rewrite it.
// Lives apart from index.ts so the drivers can share it without an import cycle.
export function assertSafeKey(key: string): void {
  if (key.length === 0) throw new Error('Storage key must not be empty')
  if (key.startsWith('/')) throw new Error(`Storage key must be relative: ${key}`)
  if (key.includes('..')) throw new Error(`Storage key must not contain "..": ${key}`)
}

// Slashes in a key are real separators in the object name and must survive as
// slashes; everything else is escaped.
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}
