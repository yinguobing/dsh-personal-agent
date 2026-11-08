/** The person's conversation with the agent, inside the panel: one entry that no DSH session choice can misdirect. */
import { useEffect, useRef, useState } from 'react'
import { usePoll } from './api.ts'
import { Button } from './controls.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { Hint, Section } from './widgets.tsx'

/** What a fresh installation shows instead of an empty transcript: three things to try, and where material goes. */
export function GettingStarted({ stateDir, onPick }: { stateDir?: string; onPick: (text: string) => void }) {
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

/** The composer alone, so the simple home can pin it under a stream of turns and cards. */
export function ChatComposer({ onSend, busy, autoFocus, seed, focusSignal }: {
  onSend: (text: string) => Promise<boolean | void>; busy: boolean; autoFocus?: boolean; seed?: string; focusSignal?: number
}) {
  const { t } = usePanel()
  const [text, setText] = useState(seed ?? '')
  // Picking an example writes it here rather than sending it; the person still presses send.
  useEffect(() => { if (seed !== undefined) setText(seed) }, [seed])
  const input = useRef<HTMLTextAreaElement>(null)
  // Answering a question puts the cursor where the answer goes.
  useEffect(() => { if (focusSignal) input.current?.focus() }, [focusSignal])
  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || busy) return
    if (await onSend(value) !== false) setText('')
  }
  return <div className="dt-chat-compose">
    <textarea className="dt-chat-input" rows={2} ref={input} value={text} placeholder={t('chatPlaceholder')} aria-label={t('chatPlaceholder')}
      autoFocus={autoFocus}
      onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} />
    <Button variant="primary" disabled={busy || !text.trim()} onClick={() => void submit()}>{t('chatSend')}</Button>
  </div>
}

/** A section with the last turns of the conversation, refreshed while the panel is open. */
export function ChatEntry() {
  const { t, call } = usePanel()
  const { setup } = usePanelData()
  const [seed, setSeed] = useState<string>()
  const chat = usePoll(() => call('GET chat', { query: { limit: 12 } }), [])
  const send = useAction(async (value: string) => {
    // The id makes a retried submit one message rather than two.
    await call('POST chat', { body: { text: value, requestId: `panel-${Date.now()}-${Math.random().toString(16).slice(2)}` } })
  }, { reload: chat.reload })
  return <Section title={t('chatTitle')} hint={t('chatHint')}>
    <div className="dt-chat">
      {chat.data?.messages.length
        ? <ul className="dt-chat-list">{chat.data.messages.map((message, index) => <li key={index}
          className={message.role === 'user' ? 'dt-chat-turn dt-chat-mine' : 'dt-chat-turn dt-chat-theirs'}>{message.text}</li>)}</ul>
        : <GettingStarted stateDir={setup?.machine.stateDir} onPick={setSeed} />}
      {chat.data?.error && <p className="dt-error" role="alert">
        {/api key|credentials/i.test(chat.data.error) ? t('chatNoKey') : t('chatFailed', { error: chat.data.error })}
      </p>}
      <ChatComposer busy={send.busy} seed={seed} onSend={value => send.run(value)} />
    </div>
  </Section>
}
