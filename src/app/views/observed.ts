/** Proposals observe mode recorded without acting: what the agent would have done, for the person to approve or drop. */
import type { Decision } from '../../core/index.ts'
import type { ViewHost } from './records.ts'
import { KV } from '../../kv.ts'

/** One recorded proposal, as the panel offers it. */
export interface ObservedItem {
  decisionId: string
  triggerId: string
  at: string
  /** What the person put where the agent noticed it, shortened. */
  preview: string
  title: string
  scope: string
  name?: string
  rules: { id: string; matched: boolean; reason: string }[]
}

interface Proposal { title?: unknown; scope?: unknown; worktree_name?: unknown }
interface Audit { would_accept?: unknown; proposal?: Proposal; matches?: { rule_id: string; reason: string }[]
  rule_assessments?: { rule_id: string; matched: boolean; reason: string }[] }

const text = (value: unknown): string => typeof value === 'string' ? value : ''

/** The newest observed proposals whose Trigger still exists and that no ticket has taken up. */
export function observedList(host: ViewHost, limit = 20): { items: ObservedItem[] } {
  const taken = new Set(host.store.tickets.list().map(ticket => ticket.origin.triggerId))
  // A proposal the person already approved is done with, whichever trigger the resulting ticket started from.
  const acted = new Set(host.store.get(KV.observed.acted) ?? [])
  const rows = host.store.read.decisions({ kinds: ['ignore'], since: '' }, 0, 200).items
  const items: ObservedItem[] = []
  for (const decision of rows) {
    if (items.length >= limit) break
    const audit = (decision.audit ?? {}) as Audit
    if (audit.would_accept !== true) continue
    const triggerId = decision.triggerIds[0]
    const trigger = triggerId ? host.store.triggers.get(triggerId) : undefined
    if (!trigger || !triggerId || taken.has(triggerId) || acted.has(decision.id)) continue
    const proposal = audit.proposal ?? {}
    const judged = audit.rule_assessments ?? audit.matches?.map(match => ({ ...match, matched: true })) ?? []
    items.push({ decisionId: decision.id, triggerId, at: decision.at,
      preview: trigger.text.replace(/\s+/g, ' ').slice(0, 240), title: text(proposal.title), scope: text(proposal.scope),
      ...(text(proposal.worktree_name) ? { name: text(proposal.worktree_name) } : {}),
      rules: judged.map(rule => ({ id: rule.rule_id, matched: rule.matched, reason: rule.reason })) })
  }
  return { items }
}
export type ObservedListView = ReturnType<typeof observedList>
export type { Decision }
