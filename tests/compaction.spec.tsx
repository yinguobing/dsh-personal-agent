// @vitest-environment jsdom
// The compaction notice replaces a token count with a consequence.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { CompactionNotice } from '../src/client/compaction.tsx'
import { zh } from '../src/client/locales.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t = ((key: string, values: Record<string, string> = {}) => (zh[key as keyof typeof zh] ?? key)
  .replace(/\{(\w+)\}/g, (_match: string, name: string) => values[name] ?? '')) as never

it('says how much was compacted and shows what survived', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(<CompactionNotice t={t} node={{ data: { summary: '早先的对话：写了两篇短文。',
    shadowedItemCount: 37, shadowedTokenCount: 12000 } }} />) })
  expect(container.textContent).toContain('37')
  expect(container.textContent).not.toContain('写了两篇短文')
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === zh.compactShow)!
  await act(async () => { button.click() })
  expect(container.textContent).toContain('写了两篇短文')
  root.unmount(); container.remove()
})
