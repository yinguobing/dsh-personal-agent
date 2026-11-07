import { describe, expect, it, vi } from 'vitest'
import { Digest, digestSummary, digestText, worthSending } from '../src/app/digest.ts'
import type { Ticket } from '../src/core/index.ts'

const at = (iso: string): Ticket => ({ ended: { at: iso, by: 'executor', outcome: 'completed' } } as unknown as Ticket)
const open = (attention = false): Ticket => ({ attention: attention ? { id: 'a', question: '?' } : undefined, assignments: [], inputs: [], undelivered: [] } as unknown as Ticket)

describe('the daily digest', () => {
  it('counts what waits, what runs, and what finished since yesterday', () => {
    const summary = digestSummary([open(true), open(false), at('2026-11-07T09:00:00Z'), at('2026-11-01T09:00:00Z')], '2026-11-06T23:00:00Z')
    expect(summary).toEqual({ waiting: 1, working: 1, finished: 1 })
  })
  it('says nothing when there is nothing to say', () => {
    expect(worthSending({ waiting: 0, working: 0, finished: 0 })).toBe(false)
    expect(worthSending({ waiting: 1, working: 0, finished: 0 })).toBe(true)
  })
  it('states the counts and forbids turning the digest into work', () => {
    const text = digestText({ waiting: 2, working: 1, finished: 3 }, '08:30')
    expect(text).toContain('等你处理 2 件')
    expect(text).toContain('不要开票')
  })
  const host = (tickets: Ticket[], hour = 8, now = new Date(2026, 10, 7, 8, 30), failing = false) => {
    const speak = vi.fn(failing ? async (_id: string, _text: string) => { throw new Error('offline') } : async (_id: string, _text: string) => {})
    let sent: string | undefined
    const digest = new Digest({ tickets: () => tickets, speak, hour: () => hour, now: () => now, closing: () => false,
      lastSent: () => sent, markSent: day => { sent = day || undefined } })
    return { speak, digest }
  }
  it('sends once in the configured hour, and not outside it', () => {
    const quiet = host([], 8, new Date(2026, 10, 7, 9, 0))
    quiet.digest.tick()
    expect(quiet.speak).not.toHaveBeenCalled()
    const { speak, digest } = host([open(true)])
    digest.tick(); digest.tick()
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0]?.[0]).toBe('digest:2026-11-07')
    expect(speak.mock.calls[0]?.[1]).toContain('等你处理 1 件')
  })
  it('sends nothing when every count is zero', () => {
    const { speak, digest } = host([])
    digest.tick()
    expect(speak).not.toHaveBeenCalled()
  })
  it('tries again on the next pass when delivery fails', async () => {
    const { speak, digest } = host([open(true)], 8, new Date(2026, 10, 7, 8, 30), true)
    digest.tick()
    await Promise.resolve(); await Promise.resolve()
    digest.tick()
    expect(speak).toHaveBeenCalledTimes(2)
  })
})
