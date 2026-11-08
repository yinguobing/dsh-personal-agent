/** The default surface for the person: what it is doing, what waits on them, and what it would like to do. */
import { usePoll } from './api.ts'
import type { TicketListView } from '../app/views/tickets.ts'
import { Button, Icon } from './controls.tsx'
import { ChatEntry } from './chat.tsx'
import { errorText } from './text.ts'
import { ObservedProposals } from './observed.tsx'
import { usePanel, usePanelData } from './provider.tsx'
import { Hint, Section } from './widgets.tsx'

type Row = TicketListView['items'][number]

/** A ticket's state in everyday words, with no domain vocabulary. */
function stateWord(t: ReturnType<typeof usePanel>['t'], row: Row): string {
  if (row.stage === 'working') return t('homeDoing')
  if (row.stage === 'idle') return t('homeIdle')
  if (row.stage === 'person') {
    if (row.action === 'review') return t('homeReview')
    if (row.action === 'blocked' || row.action === 'failed' || row.action === 'delivery') return t('homeBlocked')
    return t('homeAnswer')
  }
  return t('homeIdle')
}

/** One line under a ticket's title: the question it asks, or the last thing it said. */
function detail(row: Row): string {
  const question = row.attention?.question
  if (question) return question.replace(/\s+/g, ' ').slice(0, 160)
  return (row.summary || '').replace(/\s+/g, ' ').slice(0, 160)
}

export function HomePage({ onAdvanced }: { onAdvanced: () => void }) {
  const { t, call, navigate, openSession, notify } = usePanel()
  const { state } = usePanelData()
  const masterId = state?.masterId
  const tickets = usePoll(() => call('GET tickets', { query: { limit: 30 } }), [], 5000)
  const items = tickets.data?.items ?? []
  const waiting = items.filter(row => row.stage === 'person')
  const doing = items.filter(row => row.stage === 'working')
  const open = (row: Row) => navigate({ page: 'execution', id: row.id })
  const line = (row: Row) => <li key={row.id} className="dt-row">
    <div className="dt-row-main">
      <div className="dt-row-title">
        <button type="button" className="dt-open" onClick={() => open(row)}>{row.title}</button>
        <span className="dt-home-state">{stateWord(t, row)}</span>
      </div>
      {detail(row) && <p className="dt-hint dt-clamp">{detail(row)}</p>}
    </div>
  </li>
  return <div className="dt-page">
    <div className="dt-column dt-home">
      <header className="dt-head">
        <div className="dt-head-title"><h1 className="dt-title">{t('title')}</h1></div>
        <div className="dt-toolbar">
          <Button variant="outline" size="sm" icon={<Icon name="session" size={14} />} disabled={!masterId}
            onClick={() => { if (masterId) openSession(masterId).catch(failure => notify(errorText(failure))) }}>{t('openMaster')}</Button>
          <Button variant="ghost" size="sm" onClick={onAdvanced}>{t('homeAdvanced')}</Button>
        </div>
      </header>
      <main className="dt-main">
        <ChatEntry />
        <Section title={t('homeThings')} count={waiting.length + doing.length}>
          {waiting.length || doing.length
            ? <ul className="dt-list">
              {waiting.map(line)}
              {doing.map(line)}
            </ul>
            : <Hint>{t('homeEmpty')}</Hint>}
        </Section>
        <ObservedProposals />
      </main>
    </div>
  </div>
}
