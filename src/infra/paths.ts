/** Resolves packaged asset paths from either the source tree or the compiled lib/ output. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let cached: string | undefined
export function packageRoot(): string {
  if (cached) return cached
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth++) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      try {
        // The fork's own name, and the prototype's for code run from an upstream checkout.
        const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name
        if (name === 'dsh-personal-agent' || name === 'dsh-superagent') return cached = directory
      } catch { /* A foreign package.json on the way up is not this package. */ }
    }
    directory = dirname(directory)
  }
  throw new Error('dsh-personal-agent package root not found')
}
export const packagePath = (...parts: string[]): string => join(packageRoot(), ...parts)
