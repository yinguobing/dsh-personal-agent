/**
 * Weixin (iLink bot) as a Source: the person's phone becomes the entry, one bound person per installation.
 *
 * The bot account is the one `dsh-weixin-login` wrote under `$DSH_HOME/weixin/accounts`; this Source only polls it and
 * sends replies. The first person who writes binds the installation; anyone else is ignored.
 */
import type { Context } from '@deepseek-ai/cordis'
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import { health, sourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'

export const SOURCE = 'weixin'
/** The one principal of the installation; the bound phone belongs to them. */
export const OWNER = 'owner'

const WeixinConfigSchema = z.object({
  accountId: z.string().trim().default(''),
  baseUrl: z.string().trim().default(''),
  pollSeconds: z.number().int().min(5).max(600).default(20),
}).strict()
export type WeixinConfig = z.infer<typeof WeixinConfigSchema>

/** One inbound message of the iLink getupdates answer. */
export interface WeixinMessage {
  from_user_id?: string
  context_token?: string
  create_time?: number | string
  item_list?: { type?: number; text_item?: { text?: string } }[]
}

/** The text of a message, ignoring parts this Source cannot read as text. */
export function weixinText(message: WeixinMessage): string {
  return (message.item_list ?? []).flatMap(item => item.type === 1 && item.text_item?.text ? [item.text_item.text] : []).join('\n').trim()
}

/** The Trigger for one message of the bound person, on the thread of their conversation with the bot. */
export function weixinTrigger(message: WeixinMessage, person: string, at: string): Trigger {
  const text = weixinText(message)
  return { id: key(SOURCE, String(message.from_user_id ?? ''), String(message.create_time ?? at)), source: SOURCE,
    threads: [{ source: SOURCE, id: person }], actor: { source: SOURCE, id: OWNER }, human: true, addressed: 'direct', at, text,
    channel: { source: SOURCE, thread: person, address: { person, ...(message.context_token ? { contextToken: message.context_token } : {}) } },
    meta: { person, ...(message.context_token ? { contextToken: message.context_token } : {}) } }
}

/** The bot account this installation polls; the login command writes it. */
export interface WeixinAccount { token: string; accountId: string; baseUrl?: string; userId?: string }

/** Reads the newest (or the named) account under `$DSH_HOME/weixin/accounts`; undefined before a login. */
export function readAccount(accountId = '', home = process.env.DSH_HOME ?? join(homedir(), '.dsh')): WeixinAccount | undefined {
  try {
    const dir = join(home, 'weixin', 'accounts')
    const files = readdirSync(dir).filter(file => file.endsWith('.json')).sort()
    const chosen = accountId ? files.find(file => file.startsWith(accountId)) : files.at(-1)
    if (!chosen) return undefined
    const account = JSON.parse(readFileSync(join(dir, chosen), 'utf8')) as WeixinAccount
    return account?.token ? account : undefined
  } catch { return undefined }
}

const baseInfo = (): Record<string, string> => ({ channel_version: '0.1.0', bot_agent: 'dsh-superagent/0.1.0' })

/** The minimal iLink client this Source needs: fetch new messages, send text. */
export class WeixinClient {
  constructor(private readonly options: { baseUrl: string; token: string; signal?: AbortSignal }) {}
  private async post(endpoint: string, body: unknown, timeoutMs = 20_000): Promise<Record<string, unknown>> {
    const url = new URL(endpoint, this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`)
    const signal = this.options.signal ? AbortSignal.any([this.options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    const response = await fetch(url, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token', 'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': '65536', ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}) },
      body: JSON.stringify(body) })
    const text = await response.text()
    if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}: ${text.slice(0, 200)}`)
    return text.trim() ? JSON.parse(text) as Record<string, unknown> : {}
  }
  async updates(buf: string, timeoutMs = 35_000): Promise<{ msgs?: WeixinMessage[]; get_updates_buf?: string }> {
    try { return await this.post('ilink/bot/getupdates', { get_updates_buf: buf, base_info: baseInfo() }, timeoutMs) as never }
    // A long poll that times out has nothing new; that is not a failure.
    catch (error) { if (error instanceof Error && /abort|timeout/i.test(error.message)) return { msgs: [] }; throw error }
  }
  async sendText(to: string, text: string, contextToken?: string): Promise<void> {
    const response = await this.post('ilink/bot/sendmessage', { msg: { from_user_id: '', to_user_id: to, client_id: `dsh-superagent-${key(text).slice(0, 16)}`,
      message_type: 2, message_state: 2, ...(contextToken ? { context_token: contextToken } : {}), item_list: [{ type: 1, text_item: { text } }] },
    base_info: baseInfo() })
    if (typeof response.ret === 'number' && response.ret !== 0) throw new Error(`sendmessage ret=${response.ret} ${String(response.errmsg ?? '')}`)
  }
}

export const weixinKind: SourceKind<WeixinConfig> = {
  kind: SOURCE,
  title: { zh: '微信', en: 'Weixin' },
  description: { zh: '你手机上的微信。绑定的那个人发来的消息成为工作；回复也回到这里。', en: 'Weixin on your phone: the bound person\'s messages become work, and replies go back there.' },
  schema: WeixinConfigSchema,
  fields: [
    { key: 'accountId', type: 'text', advanced: true, label: { zh: '机器人账号', en: 'Bot account' },
      hint: { zh: '留空用最近登录的账号。账号由 dsh-weixin-login 写入 $DSH_HOME/weixin/accounts。', en: 'Empty uses the most recent login written by dsh-weixin-login.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 5, max: 600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' },
      hint: { zh: '长轮询本身会等消息；这个间隔只在空轮询后等待。', en: 'Long polling waits for messages; this interval only spaces empty polls.' } },
  ],
  health: ['weixin'],
  defaultPolicy: { allowed: [{ id: OWNER, name: '我' }] },
  channel: {
    async send(_host, message) {
      const client = active
      if (!client) throw new Error('The Weixin Source is not running')
      await client.sendText(message.channel.address.person ?? '', message.text, message.channel.address.contextToken)
      return 'sent'
    },
    link: () => ({ url: '', label: { zh: '微信', en: 'Weixin' } }),
  },
  scope: () => ({ listened: true, observed: false }),
}

/** The client the running Source uses for replies; one account per installation. */
let active: WeixinClient | undefined

/** Polls until `signal` aborts, handing each message of the bound person to the Engine once. */
export async function runWeixin(source: ReturnType<typeof sourceContext>, signal: AbortSignal): Promise<void> {
  const config = source.config<WeixinConfig>(SOURCE)
  if (!config) { source.report('weixin', health('paused', 'sourceOff')); return }
  const account = readAccount(config.accountId)
  if (!account) { source.report('weixin', { state: 'error', detail: 'Waiting for a Weixin login; run dsh-weixin-login' }); return }
  const client = active = new WeixinClient({ baseUrl: config.baseUrl || account.baseUrl || 'https://ilinkai.weixin.qq.com', token: account.token, signal })
  source.report('weixin', { state: 'ready', detail: `Listening as ${account.accountId}` })
  let buf = source.state.get(KV.weixin.buf) ?? ''
  while (!signal.aborted) {
    try {
      const answer = await client.updates(buf)
      if (answer.get_updates_buf && answer.get_updates_buf !== buf) { buf = answer.get_updates_buf; source.state.set(KV.weixin.buf, buf) }
      for (const message of answer.msgs ?? []) {
        const person = String(message.from_user_id ?? '')
        if (!person) continue
        const bound = source.state.get(KV.weixin.owner)
        if (!bound) source.state.set(KV.weixin.owner, person)
        else if (bound !== person) continue
        if (message.context_token) source.state.set(KV.weixin.context(person), message.context_token)
        if (!weixinText(message)) continue
        // The bound person is the owner: their message is simply them talking, and the answer goes back here.
        void source.converse(weixinText(message), { source: SOURCE, thread: person,
          address: { person, ...(message.context_token ? { contextToken: message.context_token } : {}) } })
      }
      source.report('weixin', { state: 'ready', detail: `Listening as ${account.accountId}` })
    } catch (error) {
      source.report('weixin', { state: 'error', detail: `Poll failed: ${String(error).slice(0, 200)}` })
    }
    await new Promise(resolve => { const timer = setTimeout(resolve, config.pollSeconds * 1000); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined) }, { once: true }) })
  }
}

export const name = 'dsh-superagent-weixin'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(weixinKind), 'weixin: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = runWeixin(sourceContext(ctx.orchestrator, weixinKind), controller.signal)
    return async () => { controller.abort(); await running; active = undefined }
  })
}
