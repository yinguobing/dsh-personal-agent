// @vitest-environment jsdom
// The simple home that a person sees by default.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, all, click, find, text } from './fixtures/panel.tsx'

usePanel()
it('opens on the simple home: the conversation, your things, and one way into the operator view', async () => {
  await mount(zh, 'simple')
  expect(all('[role="tab"]')).toHaveLength(0)
  expect(all('.dt-chat')).toHaveLength(1)
  expect(text()).toContain(zh['homeThings'])
  expect(text()).toContain(zh['homeDoing'])
  // The way into the operator view is an icon now, named for screen readers.
  expect(find(zh['homeAdvanced']).getAttribute('aria-label')).toBe(zh['homeAdvanced'])
  expect(text()).not.toContain(zh['tab.eval'])
})

it('opens the operator view from the simple home and comes back', async () => {
  await mount(zh, 'simple')
  await click(zh['homeAdvanced'])
  expect(all('[role="tab"]')).toHaveLength(6)
  await click(zh['homeSimple'])
  expect(all('[role="tab"]')).toHaveLength(0)
  expect(text()).toContain(zh['homeThings'])
})
