/**
 * A watched folder as a Source: what the person drops there is noticed, and the agent decides whether it needs anything.
 * Nothing is addressed to the agent, so each item becomes an inferred candidate: it acts only under a rule, and in
 * observe mode it only records what it would have done.
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import { health, sourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'

export const SOURCE = 'inbox'
export const OWNER = 'owner'
/** Files whose beginning is short enough to read and small enough to quote into a candidate. */
const PREVIEW_BYTES = 2_000
const PREVIEW_CHARS = 600
const TEXT = /\.(md|markdown|txt|json|ya?ml|csv|tsv|log)$/i

const InboxConfigSchema = z.object({
  directory: z.string().trim().default(''),
  pollSeconds: z.number().int().min(5).max(3600).default(30),
}).strict()
export type InboxConfig = z.infer<typeof InboxConfigSchema>

/** One file the folder holds; `fingerprint` changes when the file is written again. */
export interface InboxEntry { name: string; path: string; size: number; mtime: string; fingerprint: string }

/** The folder's files, oldest first, without hidden files and directories. */
export function inboxEntries(directory: string): InboxEntry[] {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && !entry.name.startsWith('.'))
    .flatMap(entry => {
      const path = join(directory, entry.name)
      try {
        const stat = statSync(path)
        return [{ name: entry.name, path, size: stat.size, mtime: stat.mtime.toISOString(), fingerprint: `${entry.name}:${stat.size}:${stat.mtimeMs}` }]
      } catch { return [] /* the file vanished between listing and stating */ }
    })
}

/** The first lines of a text file, or nothing for a file whose kind this Source cannot read as text. */
export function inboxPreview(entry: InboxEntry): string {
  if (!TEXT.test(entry.name)) return ''
  try {
    const text = readFileSync(entry.path, { encoding: 'utf8' }).slice(0, PREVIEW_BYTES).trim()
    return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text
  } catch { return '' }
}

/** The Trigger for a file the person put in the watched folder: unaddressed, so it can only become an inferred candidate. */
export function inboxTrigger(entry: InboxEntry, preview: string): Trigger {
  const size = entry.size < 1024 ? `${entry.size} B` : `${(entry.size / 1024).toFixed(1)} KB`
  return {
    id: key(SOURCE, entry.fingerprint), source: SOURCE, threads: [{ source: SOURCE, id: 'inbox' }],
    actor: { source: SOURCE, id: OWNER }, human: true, at: entry.mtime,
    text: [`新素材：${entry.name}（${size}，${entry.mtime}）`, preview ? `开头是：\n${preview}` : '（不是文本文件，没有预览）'].join('\n'),
    meta: { name: entry.name, path: entry.path, size: entry.size },
  }
}

export const inboxKind: SourceKind<InboxConfig> = {
  kind: SOURCE,
  title: { zh: '素材夹', en: 'Inbox folder' },
  description: { zh: '你放东西进去的文件夹。放进去不等于交办：它先判断要不要动手，observe 模式下只记录它会做什么。',
    en: 'A folder you drop things into. Dropping is not asking: the agent decides whether it needs anything, and in observe mode only records what it would do.' },
  schema: InboxConfigSchema,
  fields: [
    { key: 'directory', type: 'text', label: { zh: '文件夹', en: 'Folder' },
      hint: { zh: '留空用 <stateDir>/inbox。', en: 'Empty uses <stateDir>/inbox.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 5, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
  ],
  health: ['inbox'],
  defaultPolicy: { allowed: [{ id: OWNER, name: '我' }] },
  scope: () => ({ listened: true, observed: true }),
}

/** One pass over the folder: hand every file not seen before to the Engine, and remember what is there. */
export function pollInbox(source: ReturnType<typeof sourceContext>, directory: string): number {
  const entries = inboxEntries(directory)
  const seen = new Set(source.state.get(KV.inbox.seen) ?? [])
  for (const entry of entries) {
    if (seen.has(entry.fingerprint)) continue
    // A dropped file is the person saying "look at this" without typing: say so in their conversation.
    void source.converse(`素材夹里多了一份 ${entry.name}。`)
    seen.add(entry.fingerprint)
  }
  source.state.set(KV.inbox.seen, entries.map(entry => entry.fingerprint))
  return entries.length
}

/** Polls the folder until `signal` aborts, handing each new or rewritten file to the Engine once. */
export async function runInbox(source: ReturnType<typeof sourceContext>, signal: AbortSignal): Promise<void> {
  const config = source.config<InboxConfig>(SOURCE)
  if (!config) { source.report('inbox', health('paused', 'sourceOff')); return }
  const directory = config.directory || join(source.deployment.stateDir, 'inbox')
  mkdirSync(directory, { recursive: true })
  while (!signal.aborted) {
    try {
      const count = pollInbox(source, directory)
      source.report('inbox', { state: 'ready', detail: `Watching ${basename(resolve(directory))} (${count} files)` })
    } catch (error) {
      source.report('inbox', { state: 'error', detail: `Reading the folder failed: ${String(error).slice(0, 200)}` })
    }
    await new Promise<void>(done => { const timer = setTimeout(done, config.pollSeconds * 1000)
      signal.addEventListener('abort', () => { clearTimeout(timer); done() }, { once: true }) })
  }
}

export const name = 'dsh-superagent-inbox'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(inboxKind), 'inbox: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = runInbox(sourceContext(ctx.orchestrator, inboxKind), controller.signal)
    return async () => { controller.abort(); await running }
  })
}
