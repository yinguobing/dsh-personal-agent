/** The files a ticket produced, read from its own directory: what the person can open, not where it was written. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface Artifact { path: string; size: number; text?: string }
const TEXT = /\.(md|markdown|txt|json|ya?ml|csv)$/i

/** Lists up to `limit` files under a ticket's directory, with the text of small text files for preview. */
export function artifactList(directory: string | undefined, limit = 50): Artifact[] {
  if (!directory) return []
  const files: Artifact[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || files.length >= limit) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (files.length >= limit) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      let size = 0
      try { size = statSync(full).size } catch { continue }
      if (size > 2_000_000) continue
      const path = relative(directory, full)
      const text = TEXT.test(entry.name) && size <= 20_000 ? readFileSync(full, 'utf8').slice(0, 12_000) : undefined
      files.push({ path, size, ...(text !== undefined ? { text } : {}) })
    }
  }
  walk(directory, 0)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}
