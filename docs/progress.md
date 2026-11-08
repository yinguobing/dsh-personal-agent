# 进度记录

## 2026-11-07 · P0-a：去掉 GitHub 依赖，能独立启动

### 做了什么

原型把「部署」和「GitHub 仓库」绑死：`Deployment.repository` 必填，`Setup` 启动时探测 `gh`、校验仓库推送权限，`writeEnvironment` 还要写 git 凭据助手。个人版没有仓库，所以先把这一层解开。

改动（尽量小，方便日后和上游 diff）：

- `Deployment.repository` / `Deployment.github` 改为可选；新增 `githubOf()`，只在真正需要 GitHub 身份的代码路径上取用。
- `resolveDeployment()`：仓库和 CLI 都为空时直接返回机器配置，不再报 `repositoryUnset`。
- `writeEnvironment()`：无 GitHub 时 `gh` shim 只负责报错，git 配置不写 `credential.*` 和 `url.*`；`verifyEnvironment()` 直接跳过。
- `Commands`：`repository` / `agentCli` 改成取值时校验，缺失时报清晰的错。
- 面板 `accounts` 字段允许空值。

### 验证

隔离 profile（`DSH_HOME=/tmp/psa-home`，profile `p0`，端口 3099，GitHub Source 关闭）：

- `/orchestrator/api/state`：`runtime.state = ready`，`setup.problem = null`，无 `github` 健康项
- 状态目录生成 `orchestrator.sqlite`（9 张表）、`worker-bin/`、`worker-gitconfig`
- `worker-bin/gh` 内容为一行明确报错；`worker-gitconfig` 无凭据助手
- `accounts` 为 `{repository: "", agent: ""}`

### 测试基线

- `pnpm typecheck` 通过；新增「无 GitHub 时不探测任何账号」用例通过
- 全量测试 1196/1197 通过；`tests/sources.spec.ts` 中飞书「格式错误的一行上报健康状态」用例**在未改动的上游代码上同样失败**（健康状态被后到的 ready 覆盖），属上游既有问题，先记录不修

### 下一步

- `chat` Source：把主会话里的用户消息变成 Trigger（当前没有任何 Source，只能启动不能干活）
- 重写路由提示词：从「仓库编码 agent」改成「个人助理」

## 2026-11-07 · P0-b：主会话变成数据源

### 做了什么

- 新增 `chat` Source（`src/sources/chat.ts`）：监听主会话的 `agent/inbox/inserted`，只认「本机主会话 + 用户亲手输入」，把每条消息变成一个 Trigger，线程就是这段对话本身。
- 过滤掉 superagent 自己注入的 relay/notice：它们的消息源是 `dsh-superagent`，不是 `user`。否则它会把「自己对自己说的话」当成新任务。
- 单用户授权：`SourceKind` 增加 `defaultPolicy`，Source 第一次出现时把默认放行名单写进 Policy（`chat` 为 `owner`），用户不用先去面板配一遍名单。已存在则永不覆盖。
- `SourceContext` 暴露 `masterId`，Source 才知道哪条会话是「主会话」。
- 健康项 `chat` 报告 ready / Off。

### 验证

- 新增 8 条测试：Trigger 形状、幂等、文本提取、owner 判定、显式受理、名单缺失时被忽略、以及一条端到端「一条消息 → 一次 explicit 评估，重复投递不产生第二次」。
- 隔离 profile 重启：`health.chat = ready`，`setup.problem = null`。
- 数据库确认 `settings-version:1` 中 `chat.allowed = [{id: "owner", name: "我"}]`。

### 已知限制

- `chat` 没有 outbound Channel：结果通过 notice 回到主会话，由 Router 转述；真正的「回复到某个渠道」要等微信接入。
- 主会话里用户消息与候选卡会同时出现，Router 需要把候选卡当成同一条消息的登记，而不是另起一件事。提示词重写时解决。

## 2026-11-07 · P0-c：把提示词从「仓库维护工」改成「个人助理」

### 做了什么

- `prompts/orchestrator.md` 重写：开篇从 "assess and route requests for the deployment's repository" 改成「这台机器主人的助理，一个人、一段对话、他交办的事」；并明确写进一句：同一条消息也会以候选卡出现，**卡是这条消息进入工作队列的登记，不是第二个请求**，只受理一次。
- `prompts/shared.md`：去掉 implementation 措辞，改成中性表述。
- `prompts/worker.md`：GitHub 相关句子改成条件句（「当这台机器有 GitHub 账号时」），目录说明从「读仓库 AGENTS.md」改成「读你工作目录里的说明」。
- GitHub 技能改为按部署有无账号加载（此前无条件加载，个人版会一直看到 gh/PR 教程）。

### 验证

- 隔离 profile 里取 `/orchestrator/api/prompts`，拼出的 Router prompt 首段确认是新文案，且包含「not a second request」。
- 执行环境变量里 `DSH_SUPERAGENT_GITHUB_ACCOUNT` 不再出现。
- 新增 2 条测试：无 GitHub 账号时不注册 github 技能；Router 提示词必须包含「卡即同一条消息」的规则。
- 全量测试 1207/1208 通过（仍只有上游那条飞书用例失败）。

### 遗留

- `prompts/admission.md` 与 `prompts/work.md` 仍是编码口径（「仓库内的小改动」、PR/评审流程）。这两处决定的是**主动候选项的边界**和**worker 的干活方式**，属于 P2/P3，等内容场景定下来再改。

## 2026-11-07 · P0-d：真的跑起来了（含一次真实模型调用）

### 结果

在隔离 profile 里配好 DeepSeek 凭据，用 Playwright 驱动 Web UI，以「主人」身份发消息：

1. 第一条「你好，先打个招呼」→ 数据库出现 **1 条 chat Trigger**（thread = 主会话，actor = owner），Router 判定 `ignore`，理由「A greeting with no requested change; no ticket needed.」——入口与判定链路成立。
2. 第二条「帮我写一段三句话的产品介绍，存到 drafts/intro.md」→ **1 条 Ticket**（`写一段三句话的产品介绍并保存到 drafts/intro.md`），目录 `work/draft-product-intro-b3101b2c272d`，**1 个 Assignment**，worker 真的起来了、跑了 Bash、并提出了一个澄清问题（「工作区里没有产品资料，这段介绍要写哪款产品？」）。

### 修掉的真实 bug

第一次跑的时候 worker 根本起不来，报 `This installation has no GitHub account`。根因在 `src/app/tools/executor.ts`：注册 `orchestrator_report` 工具时，描述串里直接调了 `githubOf(...)`，于是**任何** worker 会话装饰工具都会抛。改成可选取值。这是只有真跑才会暴露的问题，单元测试和启动检查都看不到。

### 暴露的产品问题（下一轮）

1. **回答问题很难**：worker 的澄清问题在侧边栏显示「Waiting for answer」，但页面上的选项按钮没有稳定出现，点 Answer 也没进入作答态。对普通人来说这一步就是死路。
2. **追问可能被当成新任务**：上一轮实验里，对已开票的补充说明被 Router 判成 accept 新票，而不是 attach 到原票；worker 因此说「上一轮的具体交付形式我这边没收到」。
3. 会话选择有坑：直接打开页面时，输入框可能绑定到别的会话（实验中出现过一次，消息没进主会话）。

## 2026-11-07 · P0-e：全链路跑通两次（消息 → 票 → worker → 文件 → 回复）

### 关键发现：Web UI 的输入框不一定绑定主会话

抓包发现：打开页面后直接输入，前端会先发 `session/create`，把消息发到一个**新会话**（`session-xxxx`），而不是主会话。这意味着用户对着「dsh-superagent orchestrator」标题打字，实际可能进了别的会话，chat Source 完全收不到。这是「单入口」必须修的产品问题。

绕开办法：直接调 `POST /api/session/prompt`，指定 `sessionId = masterId`。本轮用它做了两次干净的端到端。

### 第一次（产品介绍）

- 发送：`写一段三句话的产品介绍，产品名是「小白」，目标用户是独立开发者，存到 drafts/intro.md`
- t+10s：票出现，stage `working`，标题「写一段三句话的「小白」产品介绍（目标用户：独立开发者）并保存到 drafts/intro.md」
- t+60s：票结束（列表返回 0）
- 产物：`work/xiaobai-intro-draft-ab458bc8d5ea/drafts/intro.md`，三句话，内容可用
- 主会话收到结束通知并转述了正文

### 第二次（问候语，回归）

- 发送：`用一句话写一句今天的问候语，存到 drafts/hello.md`
- t+10s working → t+40s 结束
- 产物：`work/<ticket>/drafts/hello.md`，41 字，一句话
- 主会话里出现「今日问候语已写好，保存在 drafts/hello.md：……」，随后一轮确认没有待办

### 修的一处

`orchestrator_reply` 在 Source 没有 Channel 时只返回 `{status:'dropped'}`，Router 会以为发送失败而反复尝试。现在附一句 `note`：这个 Source 没有回复通道，请在对话里直接回答。对话场景（chat）正属于这种。

### 下一轮

1. 让 Web UI 的输入框默认落在主会话（或让 chat Source 接受「当前活跃会话」）
2. 问题回传：worker 的澄清问题要直接出现在对话里，答一句就回到那张票

## 2026-11-07 · P0-f：让 Router 肯开票、让「待回答」会消失

### 三个真实故障与修法

1. **Router 把明确请求判成「与仓库无关」而 ignore**。证据：路由参数里写着「个人出行行程安排，与部署仓库的改动无关……直接在对话中答复」。修：dispatch 明说「主题无所谓，主人的明确请求一律受理，规则只用于主动候选」。
2. **Router 自己动手，不开票**。证据：让它写周计划，它回「开票只会产出一份编造的计划，直接回答更有用」，一次 route 都没发。修：orchestrator 首段写死「你要产出的一切都要走路由成票，不许在对话里直接产出」。
3. **worker 去研究我们自己的源码**。证据：安排行程的 worker 在读 `src/sources/chat.ts`、`IM_WORDS`。修：work.md 开头加个人工作口径——主题是主人的请求，永远不要读本安装的源码/状态/日志，交付物落在票据目录并读回验证。

另外修了「人答了话，票还显示等你」：`Tickets.addInput` 收到人的消息时清掉 attention（附单测）。

### 验证

- 问句回传：隔离实例里发「帮我安排下周去北京的行程」，票据进入 `person`，主会话收到「需要你先确认几个信息……」；随后回答「从太原出发……」确实作为 input 进了 worker 会话（session 日志可见原文）。
- 路由修复后重发「写一段三句话的产品介绍……存到 drafts/intro.md」：t+10s 开票 `working`，t+50s 完成，产物 `work/write-xiaobai-intro-a501d5e21bec/drafts/intro.md`，主会话收到成稿与一句说明。

### 仍未解决

- Router 一次问三个问题，违反「一次只问一个」。
- worker 提问后不停止，继续搜网页，票据的 attention 与真实状态会短暂不一致。

## 2026-11-07 · P0-g：问一句就停，答一句就接着干

### 改了什么

- 工人报告带 `human_action`（有疑问要问人）后，宿主**取消它当前的回合**（`keepInbox: true`），让它真正停下来等，而不是问完继续搜网页。实现：`Sessions.cancel()` + 报告工具里 `setTimeout(0)` 取消，避开工具返回前自杀。
- 工人提要求改成「一次只问一个问题」：`handoff-worker` 从「state 可以是 progress 并继续干」改成「提问即结束回合」，并写明「缺多个事实时，问最卡住的那个，剩下的等这个答完再问」。

### 端到端验证（隔离 profile）

1. 发「帮我写一份下周的工作计划」→ t+40s 票进 `person`；工人会话日志末尾是 `turn/end reason.kind=aborted (hook: blocked on a question...)`——真的停住了。
2. 主会话收到的问题是**一句话**：「下周计划要覆盖哪些工作？请简单说说你的岗位、下周要推进的项目或任务、优先级（或截止时间）……」
3. 回答「独立开发者，两篇博客 + 产品原型，博客优先」→ 10 秒内票从 `person` 回到 `working`。
4. t+60s 完成，产物 `work/next-week-plan-f6249ab609a5/下周工作计划-2026-11-09.md`，有目标、有排期、有硬节点；主会话收到摘要。

### 仍可改进

- 问题虽然是一句，但仍把「岗位 / 项目 / 优先级」塞在一起。真正的「一次一个」还需要更硬的约束或结构化提问。

## 2026-11-07 · P1-a：每日摘要（没事就不发）

### 做了什么

- `src/app/digest.ts`：统计「等你处理 / 进行中 / 昨天以来完成」三类数量；全零就**什么都不发**；每天只发一次，且只在配置的小时内（`digestHour`，默认 8）。
- 发送方式：给主会话投一条固定文案（`digest:<日期>` 作为幂等键），由 Router 用一两句话转达；文案里明确写了不要开票、不要调用工具。
- 已发送的日期写进 KV（`digest-day`），重启不会重发。
- 单测 6 条：计数、空则静默、只在指定小时、每天一次、失败重试。

### 端到端验证

- 设 `PSA_DIGEST_HOUR=12`，发一条会开票的请求；摘要准时出现在主会话：`每日摘要（12:18）：等你处理 0 件，进行中 1 件，昨天以来完成 0 件。`
- Router 转达成：「今天的进度简报：你这边没有待处理事项，有 1 件正在进行（就是那句话草稿），昨天以来暂无完成项。」
- 重启后同一小时内再检查：摘要计数没有增加，KV 里 `digest-day = "2026-11-07"`。

### 说明

- 摘要目前只在小时窗口内触发：若那一小时恰好没有事项，当天就不发——这是「沉默是默认」的直接后果，可以接受。
- 文案是中文硬编码，产品化时要走本地化。

## 2026-11-07 · P1-b：微信入口（进来通了，出去还没接）

### 做了什么

- 新增 `weixin` Source（`src/sources/weixin.ts`）：读 `$DSH_HOME/weixin/accounts` 里由 `dsh-weixin-login` 写入的机器人账号，长轮询 iLink，把绑定的人的消息变成 Trigger；回复通道用 `ilink/bot/sendmessage`，带 context_token。
- 单用户绑定：第一个发消息的人绑定这台机器，之后其他人一律忽略（个人版没有账号体系，这是最省事且可解释的默认）。
- 自带最小 iLink 客户端（约 40 行），不引入额外依赖；`baseUrl` 可配，方便对着假服务端做集成测试。
- 默认 disabled：没有登录时不该空转。

### 验证（假 iLink 服务端，完全离线）

- 假服务端返回一条 `帮我写一段产品介绍，存到 drafts/wx.md`；
- `health.weixin = ready / Listening as test`；
- 10 秒内出现票据「写一段产品介绍，存到 d…」，`working` → 80 秒时 `person`（worker 提问）；
- 6 条单测：文本解析、Trigger 形状、账号读取、客户端收发、首次绑定、陌生人忽略。

### 没通的

**出站没走到微信。** worker 的提问被 Router 转述到了 Web 会话里，`/tmp/fake-out.jsonl` 始终为空——也就是说，微信那头的人收不到问题，只在 Web 端能看到。原因：Router 对「对话型」票据习惯了直接在会话里回答，没有调用 `orchestrator_reply` 走 Source 的 Channel。下一轮要先修这条，微信才算真正闭环。

## 2026-11-07 · P1-c：微信闭环（问句和结果真的发到手机上）

### 改了什么

- 票据的问题和结果不再依赖 Router 记得调 `orchestrator_reply`：宿主在报告落下时直接投递。
  - 问题 → 发到提问者所在的会话（没有就用票据起始会话），id 固定为 `attention-reply:<attention>`，与 Router 的显式回复共用同一个 id，天然去重。
  - 结果 → 发到票据起始会话，id `result-auto:<ticket>`，同样去重；Router 再调回复会直接复用。
  - 对话型票据没有 Channel，宿主不发，仍由会话自己回答。
- `weixinTrigger` 现在带 `channel`（这是上一轮出站失败的真正原因：Trigger 没有 channel，宿主根本没有地方可发）。
- replies 提示词补一句：宿主已经把问题/结果发到有 Channel 的会话，不要在这里重复。

### 端到端验证（假 iLink）

1. 微信侧发「帮我写一段产品介绍，存到 drafts/wx.md」→ 10 秒内开票；
2. 微信立刻收到回执：「好的，我来写一段产品介绍，并保存到 drafts/wx.md。」；
3. 30 秒时 worker 提问，微信收到**一句**：「这段产品介绍是写哪个产品的？」；
4. 从微信回「产品名是「小白」，面向独立开发者」→ 20 秒内票从 `person` 回到 `working`；
5. 80 秒完成，微信收到结果摘要。

### 发现的新问题

worker 除了写票据目录，还**另存了一份到 `/home/xiaobai/xiaobai/drafts/`**——那是线上小白的家目录。个人版也许最终希望交付到用户自己的目录，但现在它是自作主张，而且碰了不该碰的地方。下一轮要么用提示词约束，要么在权限层面限制。

## 2026-11-07 · P1-d：worker 只能在票据目录里写

### 做了什么

- `Sessions.ensure` 按角色给权限：worker 用 `workspace-write`（只能写自己的票据目录，读不限），主 Session 仍是 `danger-full-access`（它跑在主人自己的机器上）。
- 示例 profile 补上权限预设：`workspace-write` 的 `approval` 设为 `never`，并显式 `defaultPreset`。原因见下。

### 发现：worker 会去申请提权，然后无限等待

第一次只改沙箱不够——worker 被拦后会弹 `approval/asked` 请求提权到 danger-full-access。这个环境里没人点「同意」，票据就一直挂在 working。也就是说：**无人值守的 worker 不能有「问人授权」这条路**。

把 `workspace-write` 的 approval 设成 `never` 后，拒绝是终局，worker 直接停下。

（顺带踩到一个配置坑：只改 approval 会让「默认 sandbox+approval」组合匹配不到任何预设，DSH 拒绝启动；必须显式写 `defaultPreset`。）

### 验证

发「把 hi 写到 /home/xiaobai/xiaobai/psa-probe.txt」：

- 30 秒内票进 `person`，文件**没有**创建；
- worker 报告 `blocked`，并附证据（uid、目录权限、`Permission denied`）与一个问题：「改写到工作区内，还是你调整策略后我再写原路径？」；
- 会话日志里 `approval/policy = never`，没有挂起的审批。

### 遗留

- 权限预设是 profile 级配置，bundle 不能替用户合并（会覆盖整个 presets 表）。已在 `examples/profile.cordis.patch.yml` 写明，产品化时要让安装流程自动写入。

## 2026-11-07 · P1-e：把主会话钉住、把 worker 会话归档（Web 入口的一半）

### 做了什么

- 启动时 `workspaceRegistry.pinSession(masterId)`：主人的那一个会话排在所有会话前面。
- 票据结束时 `archiveSession(worker-<ticket>, { stopActivity: true })`：worker 会话是管道，不该出现在人的会话列表里。

### 验证

`storages/workspace.json` 中：

```
"archivedSessionIds": ["worker-3b1afc23146892251b7c650b3788f928"],
"pinnedSessionIds": ["orchestrator-fa36c0515377a8049dcb082045f67461"]
```

即归档与置顶都落盘成功。

### 没解决的

Web 端侧栏仍然按「每张票据一个 workspace」堆积（`morning-greeting-draft-…` 等），所以打开页面时它仍恢复上次的票据 workspace，输入框也就绑到那个已归档的 worker 会话上。DSH 没有「归档 workspace」的 API，只能从根上改：worker 不再为每张票据建独立 workspace，或者我们自己做一块面板内的对话入口。

## 2026-11-07 · P1-f：面板里的对话入口（服务端）

### 做了什么

- `GET /orchestrator/api/chat?limit=N`：返回主人会话最近的若干轮（只要 `source.kind === 'user'` 的真人消息和助手回复，过滤掉宿主注入的 notice/relay JSON）。
- `POST /orchestrator/api/chat` `{text, requestId}`：走 `sessionController.prompt`，与 DSH 聊天框同一条投递路径，因此消息在会话记录里就是「主人说的」，不是通知。
- Runtime 增加 `chat()` / `say()`；API 类型与面板测试桩同步。

### 验证

`POST` 发「你好，从面板发一条」→ `{"sent":true}`；14 秒后 `GET chat?limit=6` 返回：

```
user : 你好，从面板发一条
assistant : 你好，面板消息已收到。……
```

即：面板自己就能收发言、能看到回复，不再依赖 DSH 的会话选择。

### 下一步

客户端还没做——面板里目前没有这个输入框。下一轮加组件（消息列表 + 输入框 + 发送），并在浏览器里点一遍验证。

## 2026-11-07 · P1-g：面板对话入口做完了（浏览器点通）

### 做了什么

- `src/client/chat.tsx`：Overview 顶部的「和它说话」——最近 12 轮对话 + 输入框 + 发送（Enter 发送，Shift+Enter 换行），消息用气泡区分你我。
- 文案进 `locales.ts`（中英各一），样式进 `client.css`。
- 服务端沿用上一轮的 `GET/POST /orchestrator/api/chat`。

### 验证（真浏览器，Playwright）

打开页面 → 点侧栏 Superagent → 在「和它说话」里输入「你好，我是从面板里发的」→ 点发送 → 25 秒后页面出现：

```
Talk to it
你好，我是从面板里发的
You're connected — I received your message from the panel. Tell me what you'd like done and I'll take it from there.
```

即：**不再依赖 DSH 当前打开哪个会话**，面板自己就能把话送到主会话并显示回复。

### 意义

Web 入口从「碰运气」变成「确定的」。加上微信，两条入口都成立了。

### 遗留

- 面板聊天只显示最近 12 轮，没有历史翻页；够 MVP，不够长期。
- 回复要等 agent 这一轮跑完才轮询到；没有流式。

## 2026-11-07 · P2-a：内容场景的写作约定

### 做了什么

`prompts/work.md` 增加「Content work」一节：

- 交付物固定 `drafts/<slug>.md`，开头带 front matter（title / slug / status: draft|review|published / updated / published_at / url）；
- 超过约 800 字先给提纲；
- **不许编事实、引语、数字、日期、来源，也不许编主人的个人经历**——缺的写成 `[待补: 需要什么]` 并在报告里列出；
- 保持本人的语气：短句、具体例子、不用营销形容词、不用「在这个快节奏的时代」「值得注意的是」这类腔调；
- 字数当上限而不是目标；引用处保留 Markdown 链接；
- 发布后由主人告知，再回填 status / published_at / url。

测试里加了 4 条守卫断言。

### 两次真实运行

1. **有足够信息**：「写一篇 500 字短文，主题为什么我不再用社交媒体记录生活」→ 50 秒完成，`drafts/why-no-social.md`，front matter 齐全，正文口吻平实、无套话，约 500 字。
2. **信息不足**：「写一篇 400 字短文，讲讲我去年换工作的经历」→ 它**没有编造**：先反问需要哪些事实；worker 同时产出了 `drafts/job-change.md`，通篇 `[待补: …]` 占位，标题与 slug 仍然规范。

### 发现的取舍

信息不足时，worker 交的是「带占位的 ready」而不是 blocked。规则上说得通（诚实缺口也是交付），但产品上也许该问：**当缺口是全文骨架时，是不是该停下来问，而不是交一份填空题？** 下一轮决定。

## 2026-11-07 · P3-a：主动的入口与「只记录不行动」

### 做了什么

1. **素材夹 Source**（`src/sources/inbox.ts`）：监听 `<stateDir>/inbox`，新文件或改动过的文件变成一个 Trigger。关键在 `addressed` 不设（不是对你说的），所以它只能成为 **inferred candidate**——没被规则覆盖就不动手。
   文本文件带 600 字预览，判断者不用再读文件。
2. **默认规则换成个人场景**（`policy.ts`）：`素材归档`（放进来的东西明显属于在做的一篇东西时才可以受理）与 `临近的截止`（本人记录里同时有日期和剩余工作才算）。原型的「修错别字 / 调间距」删掉。
3. 测试桩里显式声明自己需要的规则，不再依赖默认值。

### 端到端验证（observe 模式）

往 `state/superagent/inbox/` 丢一份 `slow-web-idea.md`（内容是一篇关于「网站为什么越来越慢」的素材）：

- `health.inbox = ready / Watching inbox (1 files)`；
- 45 秒内出现一条 decision：

```
ignore | [{"code":"observed","values":{"text":"New material whose own text says it belongs to a short piece the owner is writing; matches the filing rule. Observe mode records the judgement only."}}]
```

- 票据数 **0**。

即：它看懂了、按规则判断「这确实该归档成一篇稿子的素材」、然后**只把判断记下来，没有动**。这就是 `observe` 该有的样子。

### 说明

- 这条链路要成立，缺一不可：Source 负责「看见」（未署名），Policy 负责「凭什么能动」（规则 + 模式），Engine 负责「记录而不执行」。三者现在都对齐了。
- 规则名是中文（用户侧数据），测试里固定的英文桩改成了显式声明。

## 2026-11-07 · P3-b：让 observe 的判断变成一件看得见、点得动的事

### 做了什么

- `GET /orchestrator/api/observed`：列出 observe 记录下来的「本来会做什么」——标题、素材开头、命中的规则；已经批准的、已经有票的不再列出。
- `POST /orchestrator/api/observed/:id/act`：**批准**。它不是偷偷改状态，而是把这条判断变成**主人自己的一句请求**投进对话（带固定 requestId，点两次也只发一条），后面走正常的受理路径；批准过的 id 记在 KV 里，列表随即消失。
- 面板新增「它想做的事」区块：每条一句话 + 开头预览 + 「让它做 / 不用了」。空列表整块不显示（沉默是默认）。

### 验证

- API 层：`observed` 1 条（「归档「慢网站」短文素材 slow-web-idea.md」）→ act → `{"sent":true}` → 15 秒后列表 0 条。
- 浏览器层：面板里点「让它做」后，侧栏出现新票据目录 `file-slow-web-idea-…`；票据接口显示 1 张票，标题正是那条建议。

### 为什么这样设计

批准一个「观察」= 把沉默的判断翻译成一句明确的请求。这样：
- 不需要给 Engine 加一条绕过评估的后门；
- 责任清楚——是主人说的，不是系统替主人决定的；
- 同一套受理、开票、交付路径，行为一致。

## 2026-11-07 · P4-a：换一个场景，看抽象站不站得住

### 第一次（体检报告 → 一页清单）

给了 `/tmp/.../inbox/checkup-2026-10.txt`（血压、血脂、尿酸、脂肪肝），要求整理成一页清单、存到 `reports/checkup-2026-10.md`：

- 40 秒完成，产物位置正确；
- 输出是表格清单：6 项异常 + 参考范围 + 参考范围内项目单列，带勾选框；
- 末尾自己写了一句「按报告原文摘录，不构成医疗建议」。

**没有改一行代码**。

### 第二次（复查清单）

同一份报告，要求列「挂哪些科、去前准备什么、问医生什么」，存 `reports/followup.md`：

- 50 秒完成；
- 开头就是「这不是诊断或治疗建议……」；
- 分科室给建议（心内/内分泌/消化/营养），并写明「以接诊医生为准」。

### 发现与改动

第一次的免责声明是模型自己想到的，不是规则。这类事不能靠运气，于是加了一条通用规则：

> Medical, legal or financial material: organize and quote it, never diagnose, advise or decide; say it is not professional advice.

第二次运行时它出现在正文第一段——规则生效。

### 结论

同一套「素材 → 票据 → worker → 交付」在内容写作和办事类任务上都成立，没有为第二个场景加任何特判。这是 P4 想要的答案。

## 2026-11-07 · P0-h：一条命令装好

### 做了什么

`scripts/install.mjs`：从官方 web 模板建 profile → 装本 bundle → 写配置（端口、stateDir、关掉 github/feishu/weixin、**worker 权限预设**）→ 打印启动命令与素材夹路径。

关键点：
- 用 `--from-default-profile web` 继承 base 与 web-app，不必再手动补 `dsh-web-app`；
- 权限预设写进 profile 层（bundle 无法合并），`workspace-write` 的 approval 设为 `never`，并显式 `defaultPreset`——上一轮踩过的坑在这里一次配好；
- 模型密钥是唯一装不了的东西。检测 `$DSH_HOME/.credentials.yaml` 里有没有 `DEEPSEEK_API_KEY`，没有就明确提示，并在默认 home 有密钥时给出可直接复制的 `cp` 命令。

### 验证（全新 DSH_HOME）

1. `node scripts/install.mjs --profile personal --port 3086 --home /tmp/psa-script-test3` 跑完无错；
2. 按提示 `cp ~/.dsh/.credentials.yaml` 过去；
3. 启动 → 面板 `/orchestrator/api/state`：runtime ready、chat ready、inbox `Watching inbox (1 files)`；
4. 面板对话发「你好，这是新装的一份…」→ 20 秒内收到回复；
5. 往 inbox 丢一份《装修清单》→ 它判断「家务清单，不指向写作或任务，也没有日期」，**静默记录、不开票**——规则生效，而不是见啥都做。

### 说明

- 安装脚本不复制密钥、不装全局包、不碰其他 profile；所有路径都在指定 `--home` 下。
- 首次启动没有密钥时，面板里会「问而不答」——这是下一个要修的易用性缺口：失败要看得见，而不是静默。

## 2026-11-07 · P1-h：失败要看得见

### 问题

没配模型密钥的安装里，你在面板发一句话：它收下了，然后**什么都不发生**。失败发生在模型调用层，会话记录里只有一句 `turn/end reason=error`，界面上没有任何痕迹。这是最糟的失败方式——不是报错，是沉默。

### 改法

- `chat()` 现在把「最后一轮失败的原因」单独带出来：找到最后一个 `turn/end`，若它是 error 且发生在最后一条用户消息之后，返回 `error` 字段（不塞进消息流，避免伪造一条空消息）。
- 面板：聊天区下方显示一条错误行。认出是密钥问题就直说「这台安装还没有模型密钥，到 Models 填一个，或在 ~/.dsh/.credentials.yaml 里放 DEEPSEEK_API_KEY」；其他错误显示原文。

### 验证

用**没有密钥**的干净安装（`/tmp/psa-script-test`）发一条消息，`GET chat` 返回：

```
error: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service…
```

浏览器验证被 DSH 自己的新手引导挡住了（没密钥时它先要求 Add API Key），所以这条只在接口层验过；面板那一行的渲染是同一份数据，逻辑简单，但没有截图证据。

### 说明

微信侧还看不到这种失败——那边的人只会收到沉默。要让失败也发到渠道，得在投递层加一条「回合失败」的通知，下一轮做。

## 2026-11-07 · P1-i：失败也要发到手机上

### 改法

主会话的回合失败（`turn/end reason=error`）时，向**最后一条从渠道进来的消息**所在会话发一条短通知：

> 刚才那条消息没能处理完：这台安装还没有模型密钥。可以稍后再发一次。

- 只在失败发生在最近 5 分钟内有渠道消息时发，避免翻旧账；
- 常见错误（密钥/凭据）翻成人的说法，其余截断 80 字；
- 通知 id 由会话与事件时间生成，同一次失败不会重发。

### 验证（假 iLink + 无密钥安装）

微信侧发「再试一次」→ 22 秒后假服务端记录到一条出站：

```
- u1 | 刚才那条消息没能处理完：这台安装还没有模型密钥。可以稍后再发一次。
```

第一次实现里原文被截断成「…the web Models page writes 」，读起来像半句话；改成按错误类型说人话后，才是一条能看懂的通知。

### 说明

- 面板侧不走这条：它从 `chat` 接口直接拿到 error，不需要额外消息。
- 这条通知不区分是哪条消息失败——用「刚才那条」指代最近一次，够用但不够精确；多条并发时可能指错，后续可以把 triggerId 带上。

## 2026-11-07 · P1-j：头五分钟

### 做了什么

面板对话区在**没有任何消息**时不再是空白 + 一句「还没有对话」，而是：

- 一句「先让它做一件小事」；
- 三条**可点**的例子（点一下填进输入框，不直接发送）：写 500 字短文、列下周计划、把最近的材料整理成一页要点；
- 素材夹的完整路径（`<stateDir>/inbox`）；
- 一句说明默认是 observe：它判断、记录，你点头才动手。

### 验证（浏览器，全新状态）

打开面板：起始块出现、素材夹路径出现、点第一条例子后输入框被填上（英文界面下是 "Write a 500-word piece on why I stopped scrolling short videos…"）。

### 判断

这不是装饰。一个新装的人打开面板看到四个空列表，唯一合理的问题就是「我该说什么」——不回答这个，前面二十轮做的都白搭。

## 2026-11-07 · P1-k：一条对话里的多件事，不再互相吞

### 问题（验收里暴露的根因）

对话只有一个线程，而线程上的票会被后续消息唤醒：**上一件已经做完的票，会把下一条新请求当成自己的后续**。验收时批准被吞、诊断时「晚安语」被「早安语」那张票接走，都是这个原因。

### 改法

`threadFor()`：对话里的消息只有在**有票正等着你回答**时，才进入那张票的线程；否则每条消息各自开一个线程（`<sessionId>:<messageId>`），成为独立的新工作。

- 回答提问：票在等你 → 用它的线程 → 续上原票（行为不变）；
- 新请求：没有票在等 → 新线程 → 新票（不再被旧票接走）。

### 验证

| 场景 | 结果 |
|---|---|
| 连发两条独立请求（晚安语、早安语） | 两张票、两份产物（`night.md`、`morning2.md`），互不干扰 |
| 一张票提问后回答 | 同一张票继续，追问下一个问题（未新开票） |

单测：`threadFor` 在有/无等待票两种情况下的线程选择。

## 2026-11-08 · 权限链路探测（未通过）

目标：让 worker 撞到沙箱时停下来问人，而不是直接失败。

做了什么：把 worker 预设改成 `approval: ask`，写工作区外的文件；在 host 插件注册 `ctx.on('approval/request')`，期望接管成票上的「需要许可」卡片。

结果：
- DSH 确实发出 `approval/asked`，理由完整（`escalate sandbox to danger-full-access: …`）；
- 我们的处理器**一次都没被调用**（console.error 调试 + 构建确认）；
- 无人回答时 worker 挂住 90 秒以上，直到会话中断才 `cancelled`；
- 授权只有 `allowed-once`，且等于一次全局文件访问。

决定：回退这套代码（不留死代码），恢复 `approval: never`；产物出工作区改用「人从结果页导出」。
