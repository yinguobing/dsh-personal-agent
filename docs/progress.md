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
