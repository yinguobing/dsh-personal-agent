/** The default surface for the person: one conversation, with the work in flight appearing inside it as cards. */
import { useMemo, useState } from 'react'
import type { ApiResponse } from '../app/api.ts'
import { usePoll } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { ChatComposer, GettingStarted } from './chat.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { Hint } from './widgets.tsx'
import { WorkPanel } from './work.tsx'

type Home = ApiResponse<'GET home'>
type Row = Home['tickets'][number]
type Turn = Home['messages'][number]
type Proposal = Home['observed'][number]

/** A ticket's state in everyday words, with no domain vocabulary. */
function stateWord(t: ReturnType<typeof usePanel>['t'], row: Row): string {
  if (row.stage === 'ended') return t('workState.ready')
  if (row.stage === 'working') return t('homeDoing')
  if (row.stage === 'idle') return t('homeIdle')
  if (row.stage === 'person') {
    if (row.action === 'review') return t('homeReview')
    if (row.action === 'blocked' || row.action === 'failed' || row.action === 'delivery') return t('homeBlocked')
    return t('homeAnswer')
  }
  return t('homeIdle')
}

/** One line under a card's title: the question it asks, or the last thing it said. */
function detail(row: Row): string {
  const question = row.attention?.question
  if (question) return question.replace(/\s+/g, ' ').slice(0, 240)
  return (row.summary || row.note?.text || '').replace(/\s+/g, ' ').slice(0, 240)
}

type Item = { key: string; at: string } & ({ kind: 'turn'; turn: Turn } | { kind: 'ticket'; row: Row })

/** The conversation and the open work, interleaved by the time each last moved. */
function stream(home: Home | undefined): Item[] {
  const turns: Item[] = (home?.messages ?? []).map((turn, index) => ({ kind: 'turn', key: `turn-${index}`,
    at: turn.at, turn }))
  const tickets: Item[] = (home?.tickets ?? []).map(row => ({ kind: 'ticket', key: `ticket-${row.id}`,
    at: row.updatedAt || row.createdAt || '', row }))
  // Turns keep their order; the open work follows them, because a card is the state of something still happening,
  // not a moment in the conversation.
  return [...turns, ...tickets.sort((left, right) => left.at.localeCompare(right.at))]
}

export function HomePage({ onAdvanced }: { onAdvanced: () => void }) {
  const { t, call } = usePanel()
  const { setup } = usePanelData()
  const [limit, setLimit] = useState(40)
  const [seed, setSeed] = useState<string>()
  const [focusSignal, setFocusSignal] = useState(0)
  const [selected, setSelected] = useState<Row>()
  const home = usePoll(() => call('GET home', { query: { limit } }), [limit], 4000)
  const send = useAction(async (text: string) => {
    await call('POST chat', { body: { text, requestId: `panel-${Date.now()}-${Math.random().toString(16).slice(2)}` } })
  }, { reload: home.reload })
  const act = useAction(async (id: string) => { await call('POST observed/:id/act', { id }) }, { reload: home.reload })
  const drop = useAction(async (id: string) => { await call('POST decisions/:id/dismiss', { id }) }, { reload: home.reload })
  const items = useMemo(() => stream(home.data), [home.data])
  const waiting = (home.data?.tickets ?? []).filter(row => row.stage === 'person')
  const proposals = home.data?.observed ?? []
  const answer = () => setFocusSignal(value => value + 1)
  if (selected) return <div className="dt-page dt-home-page">
    <div className="dt-home">
      <WorkPanel row={selected} onClose={() => setSelected(undefined)}
        onRewrite={text => { setSeed(text); setSelected(undefined); setFocusSignal(value => value + 1) }} />
    </div>
  </div>
  return <div className="dt-page dt-home-page">
    <div className="dt-home">
      <header className="dt-head">
        <div className="dt-head-title"><h1 className="dt-title">{t('title')}</h1></div>
        <div className="dt-toolbar">
          <Button variant="ghost" size="sm" icon={<Icon name="gear" />} aria-label={t('homeAdvanced')}
            title={t('homeAdvanced')} onClick={onAdvanced} />
        </div>
      </header>
      <div className="dt-home-stream">
        {items.length >= limit && <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 40)}>{t('homeEarlier')}</Button>}
        {items.length === 0 && <GettingStarted stateDir={setup?.machine.stateDir} onPick={setSeed} />}
        <ul className="dt-stream">
          {items.map(item => item.kind === 'turn'
            ? <li key={item.key} className={item.turn.role === 'user' ? 'dt-chat-turn dt-chat-mine' : 'dt-chat-turn dt-chat-theirs'}>
              {item.turn.text}
            </li>
            : <li key={item.key} className={`dt-stream-card dt-stream-card-${item.row.stage}`}>
              <div className="dt-card-head">
                <button type="button" className="dt-open" onClick={() => setSelected(item.row)}>
                  {item.row.title}
                </button>
                <span className="dt-home-state">{stateWord(t, item.row)}</span>
              </div>
              {detail(item.row) && <p className="dt-hint dt-clamp">{detail(item.row)}</p>}
            </li>)}
        </ul>
      </div>
      <div className="dt-home-foot">
        {waiting.map(row => <div key={row.id} className="dt-stream-card dt-stream-card-person">
          <div className="dt-card-head"><span>{stateWord(t, row)}</span><span className="dt-card-title">{row.title}</span></div>
          {detail(row) && <p className="dt-hint">{detail(row)}</p>}
          <div className="dt-row-meta dt-row-buttons"><Button variant="primary" size="sm" onClick={answer}>{t('homeReply')}</Button></div>
        </div>)}
        {proposals.map(item => <div key={item.decisionId} className="dt-stream-card dt-stream-card-proposal">
          <div className="dt-card-head"><span>{t('observedTitle')}</span><span className="dt-card-title">{item.title || t('observedUntitled')}</span></div>
          <p className="dt-hint dt-clamp">{item.preview}</p>
          <div className="dt-row-meta dt-row-buttons">
            <Button variant="primary" size="sm" disabled={act.busy || drop.busy} onClick={() => void act.run(item.decisionId)}>{t('observedAct')}</Button>
            <Button variant="outline" size="sm" disabled={act.busy || drop.busy} onClick={() => void drop.run(item.decisionId)}>{t('observedDrop')}</Button>
          </div>
        </div>)}
        {home.data?.error && <p className="dt-error" role="alert">
          {/api key|credentials/i.test(home.data.error) ? t('chatNoKey') : t('chatFailed', { error: home.data.error })}
        </p>}
        {home.error && !home.data && <Hint>{String(home.error)}</Hint>}
        <ChatComposer busy={send.busy} seed={seed} focusSignal={focusSignal} onSend={value => send.run(value)} />
      </div>
    </div>
  </div>
}
