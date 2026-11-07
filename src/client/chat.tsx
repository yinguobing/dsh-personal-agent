/** The person's conversation with the agent, inside the panel: one entry that no DSH session choice can misdirect. */
import { useState } from 'react'
import { usePoll } from './api.ts'
import { Button } from './controls.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { Hint, Section } from './widgets.tsx'

/** What a fresh installation shows instead of an empty transcript: three things to try, and where material goes. */
function GettingStarted({ stateDir, onPick }: { stateDir?: string; onPick: (text: string) => void }) {
  const { t } = usePanel()
  const examples = [t('startExample1'), t('startExample2'), t('startExample3')]
  return <div className="dt-start">
    <p className="dt-hint">{t('startHint')}</p>
    <ul className="dt-list">{examples.map(example => <li key={example}>
      <button type="button" className="dt-textlink" onClick={() => onPick(example)}>{example}</button>
    </li>)}</ul>
    <p className="dt-hint">{t('startInbox', { path: `${stateDir ?? ''}/inbox` })}</p>
    <p className="dt-hint">{t('startObserve')}</p>
  </div>
}

/** A composer and the last turns of the conversation, refreshed while the panel is open. */
export function ChatEntry() {
  const { t, call } = usePanel()
  const { setup } = usePanelData()
  const [text, setText] = useState('')
  const chat = usePoll(() => call('GET chat', { query: { limit: 12 } }), [])
  const send = useAction(async (value: string) => {
    // The id makes a retried submit one message rather than two.
    await call('POST chat', { body: { text: value, requestId: `panel-${Date.now()}-${Math.random().toString(16).slice(2)}` } })
  }, { reload: chat.reload })
  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || send.busy) return
    if (await send.run(value)) setText('')
  }
  return <Section title={t('chatTitle')} hint={t('chatHint')}>
    <div className="dt-chat">
      {chat.data?.messages.length
        ? <ul className="dt-chat-list">{chat.data.messages.map((message, index) => <li key={index}
          className={message.role === 'user' ? 'dt-chat-turn dt-chat-mine' : 'dt-chat-turn dt-chat-theirs'}>{message.text}</li>)}</ul>
        : <GettingStarted stateDir={setup?.machine.stateDir} onPick={setText} />}
      {chat.data?.error && <p className="dt-error" role="alert">
        {/api key|credentials/i.test(chat.data.error) ? t('chatNoKey') : t('chatFailed', { error: chat.data.error })}
      </p>}
      <div className="dt-chat-compose">
        <textarea className="dt-chat-input" rows={2} value={text} placeholder={t('chatPlaceholder')} aria-label={t('chatPlaceholder')}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} />
        <Button variant="primary" disabled={send.busy || !text.trim()} onClick={() => void submit()}>{t('chatSend')}</Button>
      </div>
    </div>
  </Section>
}
