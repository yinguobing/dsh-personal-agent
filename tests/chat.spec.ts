import { describe, expect, it, vi } from 'vitest'
import { chatKind, chatTrigger, isOwnerMessage, messageText, OWNER, SOURCE, threadFor } from '../src/sources/chat.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { Engine, MemoryRepositories, key, type Assessor, type Executor } from '../src/core/index.ts'

describe('the conversation Source', () => {
  it('turns one message into an explicit request of the owner, on the conversation\'s own thread', () => {
    const trigger = chatTrigger({ sessionId: 'orchestrator-abc', threadId: 'thread-1', messageId: 'm1', text: '帮我起个稿', at: '2026-11-07T02:00:00.000Z' })
    expect(trigger).toMatchObject({ id: key(SOURCE, 'm1'), source: SOURCE, actor: { source: SOURCE, id: OWNER }, human: true,
      addressed: 'direct', at: '2026-11-07T02:00:00.000Z', text: '帮我起个稿' })
    expect(trigger.threads).toEqual([{ source: SOURCE, id: 'thread-1' }])
    expect(trigger.meta).toMatchObject({ sessionId: 'orchestrator-abc', messageId: 'm1' })
  })
  it('keeps the message identity stable, so the same message is never two Triggers', () => {
    const once = chatTrigger({ sessionId: 's', threadId: 't1', messageId: 'm1', text: 'a', at: 't' })
    const twice = chatTrigger({ sessionId: 's', threadId: 't1', messageId: 'm1', text: 'a', at: 't' })
    expect(twice.id).toBe(once.id)
  })
  it('reads text blocks and marks a part it cannot read', () => {
    expect(messageText({ content: [{ type: 'text', text: '你好' }, { type: 'text', text: '世界' }] } as never)).toBe('你好\n世界')
    expect(messageText({ content: [{ type: 'image', url: 'x' }] } as never)).toBe('[image]')
    expect(messageText({ content: [] } as never)).toBe('')
  })
  it('lets the owner in without a Policy edit', () => {
    expect(chatKind.defaultPolicy?.allowed).toEqual([{ id: OWNER, name: '我' }])
    expect(chatKind.scope?.({ meta: {} }, {})).toEqual({ listened: true, observed: false })
  })
})

describe('the owner\'s messages', () => {
  const trigger = chatTrigger({ sessionId: 'orchestrator-abc', threadId: 'thread-1', messageId: 'm1', text: '帮我起个稿', at: '2026-11-07T02:00:00.000Z' })
  const gate = (allowed: { id: string; name?: string }[]) => {
    const settings = SettingsSchema.parse({ policy: { sources: { chat: { allowed } } } })
    const sources = new SourceRegistry(() => settings)
    sources.register(chatKind)
    return settingsPolicy(settings, sources).gate(trigger, undefined as never, [])
  }
  it('are explicit requests once the owner is on the list', () => {
    expect(gate([{ id: OWNER, name: '我' }])).toMatchObject({ admissible: true, strength: 'explicit' })
  })
  it('are ignored until then, which is why the default list is seeded', () => {
    expect(gate([])).toMatchObject({ admissible: false })
  })
  it('are only the person typing in this installation\'s main Session', () => {
    const typed = { source: { kind: 'user' } } as never
    const relayed = { source: { kind: 'dsh-superagent' } } as never
    expect(isOwnerMessage('orchestrator-abc', 'orchestrator-abc', typed)).toBe(true)
    expect(isOwnerMessage('orchestrator-abc', 'orchestrator-abc', relayed)).toBe(false)
    expect(isOwnerMessage('orchestrator-abc', 'worker-t1', typed)).toBe(false)
  })
})

describe('the conversation entry, end to end', () => {
  const build = () => {
    const settings = SettingsSchema.parse({ policy: { sources: { chat: { allowed: [{ id: OWNER, name: '我' }] } } } })
    const sources = new SourceRegistry(() => settings)
    sources.register(chatKind)
    const assessor: Assessor = { request: vi.fn(async () => {}) }
    const executor: Executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
    const outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
    const engine = new Engine({ repo: new MemoryRepositories(), scope: sources, policy: () => settingsPolicy(settings, sources), assessor, executor, outbox })
    return { engine, assessor }
  }
  it('turns one message into one explicit evaluation, never two', () => {
    const { engine, assessor } = build()
    const trigger = chatTrigger({ sessionId: 'orchestrator-abc', threadId: 'thread-1', messageId: 'm1', text: '帮我起个稿', at: '2026-11-07T02:00:00.000Z' })
    engine.receive(trigger)
    engine.receive(trigger)
    engine.evaluateDue()
    expect(assessor.request).toHaveBeenCalledTimes(1)
    expect(assessor.request).toHaveBeenCalledWith(expect.objectContaining({ strength: 'explicit', triggers: [expect.objectContaining({ id: key(SOURCE, 'm1'), source: SOURCE })] }))
  })
})

describe('threads for a conversation', () => {
  const source = (waiting: boolean) => ({
    tickets: { open: () => waiting ? [{ attention: { id: 'a' }, origin: { triggerId: 'trig' } }] : [] },
    triggers: { get: () => ({ threads: [{ source: SOURCE, id: 'chat-thread-7' }] }) },
  }) as never
  it('joins the thread of the ticket waiting for an answer', () => {
    expect(threadFor(source(true), 's1', 'm1')).toBe('chat-thread-7')
  })
  it('starts a thread of its own when nothing waits, so no finished ticket swallows it', () => {
    expect(threadFor(source(false), 's1', 'm1')).toBe('s1:m1')
    expect(threadFor(source(false), 's1', 'm2')).toBe('s1:m2')
  })
})
