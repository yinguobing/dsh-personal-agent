/**
 * The owner's own conversation as a Source: every message the person writes in the main Session becomes a Trigger.
 * This is the personal installation's primary entry; it needs no account, no polling and no external service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import { health, sourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'

export const SOURCE = 'chat'
/** The single principal of a personal installation: whoever is writing in the main Session. */
export const OWNER = 'owner'

const ChatConfigSchema = z.object({}).strict()
export type ChatConfig = z.infer<typeof ChatConfigSchema>

/** Builds the Trigger for one message of the owner's conversation; its Thread is the conversation itself. */
export function chatTrigger(input: { sessionId: string; messageId: string; text: string; at: string }): Trigger {
  return {
    id: key(SOURCE, input.messageId),
    source: SOURCE,
    threads: [{ source: SOURCE, id: input.sessionId }],
    actor: { source: SOURCE, id: OWNER },
    human: true,
    addressed: 'direct',
    at: input.at,
    text: input.text,
    meta: { sessionId: input.sessionId, messageId: input.messageId, direct: true },
  }
}

/** Whether a message is the owner writing in this installation's main Session, rather than a relay or another Session. */
export function isOwnerMessage(masterId: string, agentId: string, message: Pick<UserMessage, 'source'>): boolean {
  return agentId === masterId && message.source.kind === 'user'
}

/** The text of a message, with a placeholder for a part this Source cannot read as text. */
export function messageText(message: Pick<UserMessage, 'content'>): string {
  return message.content.map(block => block.type === 'text' ? block.text : `[${block.type}]`).join('\n').trim()
}

export const chatKind: SourceKind<ChatConfig> = {
  kind: SOURCE,
  title: { zh: '对话', en: 'Conversation' },
  description: {
    zh: '你在主会话里说的话。这是个人版的主要入口：不需要账号，也不需要轮询。',
    en: 'What you write in the main Session. The personal edition\'s primary entry: no account and no polling.',
  },
  schema: ChatConfigSchema,
  fields: [],
  health: ['chat'],
  // The owner is the only person who may originate work, and needs no Policy edit to be let in.
  defaultPolicy: { allowed: [{ id: OWNER, name: '我' }] },
  scope: () => ({ listened: true, observed: false }),
}

export const name = 'dsh-superagent-chat'
export const inject = ['orchestrator', 'agents']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(chatKind), 'chat: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, chatKind)
    source.report('chat', source.config<ChatConfig>(SOURCE) ? { state: 'ready', detail: 'Listening to the main conversation' } : health('paused', 'sourceOff'))
    const onMessage = ({ agent, message }: { agent: Agent; message: UserMessage }): void => {
      // Only the main Session of this installation, and only what the person typed: relays and notices the
      // superagent itself injects are user-role messages too, and must not become Triggers.
      if (!isOwnerMessage(source.masterId, agent.id, message)) return
      if (source.config<ChatConfig>(SOURCE) === undefined) return
      const text = messageText(message)
      if (!text) return
      void source.receive(chatTrigger({ sessionId: agent.id, messageId: String(message.id), text, at: new Date().toISOString() }))
    }
    return ctx.on('agent/inbox/inserted', onMessage)
  })
}
