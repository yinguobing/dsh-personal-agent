/** What observe mode would have done: one line per proposal, with a button to let it happen or drop it. */
import { usePoll } from './api.ts'
import { Button } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Hint, Section } from './widgets.tsx'

export function ObservedProposals() {
  const { t, call } = usePanel()
  const poll = usePoll(() => call('GET observed', { query: { limit: 10 } }), [], 8000)
  const act = useAction(async (id: string) => { await call('POST observed/:id/act', { id }) }, { reload: poll.reload })
  const drop = useAction(async (id: string) => { await call('POST decisions/:id/dismiss', { id }) }, { reload: poll.reload })
  const items = poll.data?.items ?? []
  if (!items.length) return null
  return <Section title={t('observedTitle')} count={items.length} hint={t('observedHint')}>
    <ul className="dt-list dt-cards">{items.map(item => <li key={item.decisionId} className="dt-row dt-att">
      <div className="dt-row-main">
        <div className="dt-att-what">{item.title || t('observedUntitled')}</div>
        <p className="dt-hint dt-clamp">{item.preview}</p>
        <div className="dt-row-meta dt-row-buttons">
          <Button variant="primary" size="sm" disabled={act.busy || drop.busy}
            onClick={() => void act.run(item.decisionId)}>{t('observedAct')}</Button>
          <Button variant="outline" size="sm" disabled={act.busy || drop.busy}
            onClick={() => void drop.run(item.decisionId)}>{t('observedDrop')}</Button>
        </div>
      </div>
    </li>)}</ul>
    {poll.error && <Hint>{String(poll.error)}</Hint>}
  </Section>
}
