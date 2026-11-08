import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inboxEntries, inboxKind, inboxPreview, inboxTrigger, pollInbox } from '../src/sources/inbox.ts'
import { KV } from '../src/kv.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'inbox-')); mkdirSync(join(dir, 'inbox')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('the inbox Source', () => {
  it('lists the files the person put there, ignoring hidden files and subfolders', () => {
    writeFileSync(join(dir, 'inbox', 'idea.md'), '# idea\n')
    writeFileSync(join(dir, 'inbox', '.hidden'), 'x')
    mkdirSync(join(dir, 'inbox', 'sub'))
    const entries = inboxEntries(join(dir, 'inbox'))
    expect(entries.map(entry => entry.name)).toEqual(['idea.md'])
    expect(entries[0]!.size).toBeGreaterThan(0)
  })
  it('previews text files and says nothing about files it cannot read as text', () => {
    writeFileSync(join(dir, 'inbox', 'idea.md'), '一段素材\n')
    writeFileSync(join(dir, 'inbox', 'photo.jpg'), 'binary')
    const [idea] = inboxEntries(join(dir, 'inbox')).filter(entry => entry.name === 'idea.md')
    expect(inboxPreview(idea!)).toBe('一段素材')
    const photo = inboxEntries(join(dir, 'inbox')).find(entry => entry.name === 'photo.jpg')!
    expect(inboxPreview(photo)).toBe('')
  })
  it('turns a file into an unaddressed request of the owner', () => {
    writeFileSync(join(dir, 'inbox', 'idea.md'), '一段素材\n')
    const trigger = inboxTrigger(inboxEntries(join(dir, 'inbox'))[0]!, '一段素材')
    expect(trigger).toMatchObject({ source: 'inbox', actor: { source: 'inbox', id: 'owner' }, human: true })
    // Unaddressed is what makes it an inferred candidate rather than an explicit request.
    expect(trigger.addressed).toBeUndefined()
    expect(trigger.text).toContain('新素材：idea.md')
    expect(trigger.text).toContain('一段素材')
  })
  it('says each file into the conversation once, and never twice', () => {
    const state = new Map<string, unknown>()
    const converse = vi.fn()
    const source = { deployment: { stateDir: dir }, config: () => ({ directory: join(dir, 'inbox'), pollSeconds: 5 }),
      state: { get: (k: string) => state.get(k), set: (k: string, v: unknown) => { state.set(k, v) }, keys: () => [] },
      report: vi.fn(), converse }
    writeFileSync(join(dir, 'inbox', 'idea.md'), '一段素材\n')
    pollInbox(source as never, join(dir, 'inbox'))
    pollInbox(source as never, join(dir, 'inbox'))
    expect(converse).toHaveBeenCalledTimes(1)
    expect(converse.mock.calls[0]![0]).toContain('idea.md')
    expect(state.get(KV.inbox.seen)).toHaveLength(1)
  })
})

describe('the inbox kind', () => {
  it('observes everything and lets the owner in without a Policy edit', () => {
    expect(inboxKind.defaultPolicy?.allowed).toEqual([{ id: 'owner', name: '我' }])
    expect(inboxKind.scope?.({ meta: {} }, { directory: '', pollSeconds: 30 })).toEqual({ listened: true, observed: true })
  })
})
