/** One piece of work, as the person sees it: what it did, what it produced, and the few things they can do next. */
import type { ApiResponse } from '../app/api.ts'
import { usePoll } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { Hint } from './widgets.tsx'

type Detail = ApiResponse<'GET tickets/:id'>
type Row = ApiResponse<'GET home'>['tickets'][number]

const when = (at: string): string => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const size = (bytes: number): string => bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
/** What a worker's report means to the person, rather than its internal state name. */
const reportWord = (state: string | undefined, t: (key: never) => string): string => state === 'ready' ? t('workState.ready' as never)
  : state === 'waiting' ? t('workState.waiting' as never) : state === 'blocked' ? t('workState.blocked' as never)
    : state === 'failed' ? t('workState.failed' as never) : state === 'dropped' ? t('workState.dropped' as never)
      : t('workState.running' as never)

export function WorkPanel({ row, onClose, onRewrite }: {
  row: Row; onClose: () => void; onRewrite: (seed: string) => void
}) {
  const { t, call } = usePanel()
  const detail = usePoll(() => call('GET tickets/:id', { id: row.id }), [row.id], 5000)
  const files = usePoll(() => call('GET tickets/:id/artifacts', { id: row.id }), [row.id], 10000)
  const again = useAction(async () => {
    await call('POST chat', { body: { text: `再写一版「${row.title}」，换个角度。`,
      requestId: `again-${Date.now()}-${Math.random().toString(16).slice(2)}` } })
  }, { reload: async () => {} })
  const view: Detail | undefined = detail.data
  const artifacts = files.data?.files ?? []
  return <div className="dt-work">
    <header className="dt-work-head">
      <Button variant="ghost" size="sm" icon={<Icon name="chevron-left" />} aria-label={t('close')} title={t('close')} onClick={onClose} />
      <h2 className="dt-work-title">{row.title}</h2>
    </header>
    <div className="dt-work-body">
      <section className="dt-work-section">
        <h3 className="dt-work-label">{t('workDid')}</h3>
        {view?.assignments?.length
          ? <ul className="dt-list">{view.assignments.slice().reverse().map((assignment, index) => <li key={index} className="dt-row">
            <div className="dt-row-main">
              <div className="dt-row-title">{assignment.report?.summary || reportWord(assignment.report?.state, t as never)}</div>
              <div className="dt-row-meta"><span>{reportWord(assignment.report?.state, t as never)}</span>
                <span>{when(assignment.report?.at ?? assignment.startedAt ?? assignment.createdAt)}</span></div>
            </div>
          </li>)}</ul>
          : <Hint>{t('workNothing')}</Hint>}
      </section>
      <section className="dt-work-section">
        <h3 className="dt-work-label">{t('workResult')}</h3>
        {artifacts.length
          ? <ul className="dt-list">{artifacts.map(file => <li key={file.path} className="dt-row">
            <details className="dt-work-file">
              <summary><span>{file.path}</span><span className="dt-hint">{size(file.size)}</span></summary>
              {file.text ? <pre className="dt-work-text">{file.text}</pre> : <p className="dt-hint">{t('workBinary')}</p>}
            </details>
          </li>)}</ul>
          : <Hint>{t('workNoResult')}</Hint>}
      </section>
    </div>
    <footer className="dt-work-actions">
      <Button variant="primary" size="sm" onClick={() => onRewrite(`关于「${row.title}」：`)}>{t('workChange')}</Button>
      <Button variant="outline" size="sm" disabled={again.busy} onClick={() => { void again.run().then(ok => { if (ok) onClose() }) }}>{t('workAgain')}</Button>
      <Button variant="ghost" size="sm" onClick={onClose}>{t('close')}</Button>
    </footer>
  </div>
}
