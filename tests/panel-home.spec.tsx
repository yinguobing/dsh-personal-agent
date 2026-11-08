// @vitest-environment jsdom
// The simple home that a person sees by default: one conversation with the work inside it.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, all, click, find, text } from './fixtures/panel.tsx'

usePanel()
it('opens on one conversation, with the work in flight inside it and no tabs', async () => {
  await mount(zh, 'simple')
  expect(all('[role="tab"]')).toHaveLength(0)
  expect(all('.dt-chat-input')).toHaveLength(1)
  expect(all('.dt-stream')).toHaveLength(1)
  // The fixture answers one turn and has one open ticket; both are in the stream.
  expect(text()).toContain('收到。')
  expect(all('.dt-stream-card').length).toBeGreaterThanOrEqual(1)
  expect(text()).toContain(zh['homeDoing'])
  // A recorded proposal is a decision card above the composer, with the words a person uses.
  expect(text()).toContain('整理体检报告')
  expect(text()).toContain(zh['observedAct'])
})

it('opens a piece of work as what it did and what it left, and can seed a change', async () => {
  await mount(zh, 'simple')
  await click(all('.dt-stream-card .dt-open')[0]!)
  expect(text()).toContain(zh['workDid'])
  expect(text()).toContain(zh['workResult'])
  expect(text()).toContain('drafts/morning.md')
  await click(zh['workChange'])
  // Back on the home, with the composer holding the seed and nothing sent.
  expect(all('.dt-stream')).toHaveLength(1)
  const input = document.querySelector<HTMLTextAreaElement>('.dt-chat-input')!
  expect(input.value).toContain('关于「')
})

it('keeps the way into the operator view behind a gear, and comes back', async () => {
  await mount(zh, 'simple')
  // The gear is named for screen readers rather than labelled on screen.
  expect(find(zh['homeAdvanced']).getAttribute('aria-label')).toBe(zh['homeAdvanced'])
  await click(find(zh['homeAdvanced']))
  expect(all('[role="tab"]')).toHaveLength(6)
  await click(zh['homeSimple'])
  expect(all('[role="tab"]')).toHaveLength(0)
  expect(all('.dt-stream')).toHaveLength(1)
})
