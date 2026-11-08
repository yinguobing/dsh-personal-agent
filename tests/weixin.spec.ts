import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KV } from '../src/kv.ts'
import { readAccount, runWeixin, weixinKind, WeixinClient, weixinText, weixinTrigger } from '../src/sources/weixin.ts'

const message = { from_user_id: 'u1', context_token: 'ctx1', create_time: 1794020000000,
  item_list: [{ type: 1, text_item: { text: '帮我写一段介绍' } }, { type: 3 }] }

describe('the Weixin Source', () => {
  it('reads text parts and ignores the rest', () => {
    expect(weixinText(message)).toBe('帮我写一段介绍')
    expect(weixinText({ item_list: [{ type: 3 }] })).toBe('')
  })
  it('turns a message into an explicit request of the owner on that person\'s thread', () => {
    const trigger = weixinTrigger(message, 'u1', '2026-11-07T04:00:00.000Z')
    expect(trigger).toMatchObject({ source: 'weixin', actor: { source: 'weixin', id: 'owner' }, human: true, addressed: 'direct',
      text: '帮我写一段介绍', meta: { person: 'u1', contextToken: 'ctx1' } })
    expect(trigger.threads).toEqual([{ source: 'weixin', id: 'u1' }])
    expect(trigger.channel).toEqual({ source: 'weixin', thread: 'u1', address: { person: 'u1', contextToken: 'ctx1' } })
    expect(weixinTrigger(message, 'u1', '2026-11-07T04:00:00.000Z').id).toBe(trigger.id)
  })
})

describe('the bot account', () => {
  let home: string
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'weixin-accounts-')); mkdirSync(join(home, 'weixin', 'accounts'), { recursive: true }) })
  afterEach(() => { rmSync(home, { recursive: true, force: true }) })
  it('reads the newest login, or the one named, and nothing before a login', () => {
    expect(readAccount('', home)).toBeUndefined()
    writeFileSync(join(home, 'weixin', 'accounts', 'a.json'), JSON.stringify({ token: 't1', accountId: 'a' }))
    writeFileSync(join(home, 'weixin', 'accounts', 'b.json'), JSON.stringify({ token: 't2', accountId: 'b' }))
    expect(readAccount('', home)?.accountId).toBe('b')
    expect(readAccount('a', home)?.accountId).toBe('a')
  })
})

describe('the iLink client', () => {
  let server: ReturnType<typeof createServer>, base: string
  let sent: string[] = []
  beforeEach(async () => {
    sent = []
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        if (req.url?.includes('getupdates')) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ret: 0, msgs: [message], get_updates_buf: 'next' }))
          return
        }
        sent.push(body)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ret: 0 }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })
  afterEach(() => { server.close() })

  it('polls updates and sends text with the context token', async () => {
    const client = new WeixinClient({ baseUrl: base, token: 't' })
    const update = await client.updates('')
    expect(update.get_updates_buf).toBe('next')
    expect(weixinText(update.msgs![0]!)).toBe('帮我写一段介绍')
    await client.sendText('u1', '收到', 'ctx1')
    expect(JSON.parse(sent[0]!).msg).toMatchObject({ to_user_id: 'u1', context_token: 'ctx1', item_list: [{ type: 1, text_item: { text: '收到' } }] })
  })

  it('binds the first person, speaks their message into the conversation, and ignores anyone else', async () => {
    const state = new Map<string, unknown>()
    const converse = vi.fn()
    const source = {
      config: () => ({ accountId: '', baseUrl: base, pollSeconds: 5 }),
      state: { get: (k: string) => state.get(k), set: (k: string, v: unknown) => { state.set(k, v) }, keys: () => [] },
      report: vi.fn(), converse,
    }
    const controller = new AbortController()
    const running = runWeixin(source as never, controller.signal)
    await vi.waitFor(() => expect(converse).toHaveBeenCalledTimes(1))
    // A second poll carries a stranger: it must not reach the conversation.
    await new Promise(resolve => setTimeout(resolve, 50))
    controller.abort(); await running
    expect(converse).toHaveBeenCalledTimes(1)
    expect(state.get(KV.weixin.owner)).toBe('u1')
    expect(converse.mock.calls[0]![0]).toBe('帮我写一段介绍')
    expect(converse.mock.calls[0]![1]).toMatchObject({ source: 'weixin', address: { person: 'u1' } })
  })
})

describe('the kind', () => {
  it('lets the owner in without a Policy edit and listens to everything it receives', () => {
    expect(weixinKind.defaultPolicy?.allowed).toEqual([{ id: 'owner', name: '我' }])
    expect(weixinKind.scope?.({ meta: {} }, { accountId: '', baseUrl: '', pollSeconds: 20 })).toEqual({ listened: true, observed: false })
  })
})
