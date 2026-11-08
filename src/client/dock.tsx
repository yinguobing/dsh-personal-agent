/** A quiet line above the composer of the person's own Session: how much is waiting, and a way into the work list. */
import { useMemo } from 'react'
import { caller, usePoll } from './api.ts'
import type { T } from './text.ts'
import { messages } from './provider.tsx'

export function WorkDock({ sessionId, open, t }: { sessionId: string; open: () => void; t: T }) {
  const call = useMemo(() => caller(() => messages(t)), [t])
  const home = usePoll(() => call('GET home', { query: { limit: 1 } }), [sessionId], 5000)
  // The dock belongs to the person's own Session; a worker's conversation shows nothing.
  if (!home.data || home.data.masterId !== sessionId) return null
  const live = home.data.tickets.filter(row => row.stage !== 'ended')
  const waiting = live.filter(row => row.stage === 'person').length
  const doing = live.filter(row => row.stage === 'working').length
  const proposals = home.data.observed.length
  const parts = [
    waiting ? t('dockWaiting', { count: String(waiting) }) : '',
    doing ? t('dockDoing', { count: String(doing) }) : '',
    proposals ? t('dockProposals', { count: String(proposals) }) : '',
  ].filter(Boolean)
  if (!parts.length) return null
  return <div className="dt-dock">
    <button type="button" className="dt-dock-button" onClick={open}>{parts.join(' · ')}</button>
  </div>
}
