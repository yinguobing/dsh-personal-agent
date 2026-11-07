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
