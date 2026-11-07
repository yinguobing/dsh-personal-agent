/**
 * The once-a-day summary the person reads without opening a panel: what waits for them, what runs, and what finished.
 * It is silent when there is nothing to say, and sends at most one message a day, in the configured hour.
 */
import { ticketStage, type Ticket } from '../core/index.ts'

/** The counts a digest reports. */
export interface DigestSummary { waiting: number; working: number; finished: number }

/** Counts for `tickets`: open ones by stage, and those finished since `since` (an ISO instant). */
export function digestSummary(tickets: readonly Ticket[], since: string): DigestSummary {
  let waiting = 0, working = 0, finished = 0
  for (const ticket of tickets) {
    if (ticket.ended) {
      if (ticket.ended.at >= since) finished++
      continue
    }
    if (ticketStage(ticket).stage === 'person') waiting++
    else working++
  }
  return { waiting, working, finished }
}

/** Whether a digest is worth sending: silence is the default. */
export const worthSending = (summary: DigestSummary): boolean => summary.waiting + summary.working + summary.finished > 0

/** The message the router forwards; it states the counts and forbids turning the digest into work. */
export function digestText(summary: DigestSummary, when: string): string {
  const parts = [`等你处理 ${summary.waiting} 件`, `进行中 ${summary.working} 件`, `昨天以来完成 ${summary.finished} 件`]
  return `每日摘要（${when}）：${parts.join('，')}。用一两句话转达给用户，不要开票，不要调用其他工具。`
}

/** Local calendar day, `YYYY-MM-DD`, for the once-a-day check. */
export const dayKey = (at: Date): string => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

export interface DigestHost {
  /** Every ticket, open and ended. */
  tickets(): Ticket[]
  /** Delivers one message to the main Session, waking it so the person hears it. */
  speak(id: string, text: string): Promise<void>
  /** The day of the last digest that went out, so a restart does not repeat it. */
  lastSent(): string | undefined
  markSent(day: string): void
  /** The local hour the digest is due, 0–23. */
  hour(): number
  now(): Date
  closing(): boolean
}

/** Sends the digest at most once a day, in the configured hour, and only when there is something to report. */
export class Digest {
  constructor(private readonly host: DigestHost) {}
  /** Called by each pass; cheap when the hour does not match or the digest already went out. */
  tick(): void {
    if (this.host.closing()) return
    const at = this.host.now()
    const day = dayKey(at)
    if (this.host.lastSent() === day || at.getHours() !== this.host.hour()) return
    const since = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const summary = digestSummary(this.host.tickets(), since)
    if (!worthSending(summary)) return
    this.host.markSent(day)
    void this.host.speak(`digest:${day}`, digestText(summary, at.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }))).catch(() => {
      // A failed delivery is retried on the next pass: forget the day so the check runs again.
      if (this.host.lastSent() === day) this.host.markSent('')
    })
  }
}
