/** The moment the conversation gets compacted, said as what it means: the middle may be forgotten. */
import { useMemo, useState } from 'react'
import type { T } from './text.ts'

interface CompactionData { summary: string | null; shadowedItemCount: number | null; shadowedTokenCount: number | null }

/** Replaces the conversation's compaction node with one sentence a person can act on. */
export function CompactionNotice({ node, t }: { node: { data: CompactionData }; t: T }) {
  const data = node.data
  const [open, setOpen] = useState(false)
  const text = useMemo(() => data.shadowedItemCount === null
    ? t('compactUnknown')
    : t('compactNotice', { count: String(data.shadowedItemCount) }), [data.shadowedItemCount, t])
  return <div className="dt-compact">
    <div className="dt-compact-line">
      <span>{text}</span>
      {data.summary && <button type="button" className="dt-textlink" onClick={() => setOpen(value => !value)}>
        {open ? t('compactHide') : t('compactShow')}
      </button>}
    </div>
    {open && data.summary && <pre className="dt-compact-text">{data.summary}</pre>}
  </div>
}

/** `/compact` by hand: the same sentence, or a plain answer when there was nothing to compact. */
export function ManualCompactionNotice({ node, t }: { node: { data: { compaction: CompactionData | null } }; t: T }) {
  if (!node.data.compaction) return <div className="dt-compact"><div className="dt-compact-line">
    <span>{t('compactNothing')}</span>
  </div></div>
  return <CompactionNotice node={{ data: node.data.compaction }} t={t} />
}
