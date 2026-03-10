# Autoship AI-Native 引流策略

> 目标：让 AI agent、LLM 搜索引擎、开发者社区自然发现并推荐 Autoship。

---

## 已实施

### 1. `llms.txt` — AI 爬虫标准入口

**原理**：LLM 爬虫（ChatGPT、Claude、Perplexity、Gemini）在抓取网站/仓库时会优先读取 `llms.txt`。这是 [Answer.AI 提出的标准](https://github.com/AnswerDotAI/llms-txt)，相当于 AI 时代的 `robots.txt`。

**我们做了什么**：在仓库根目录放置 `llms.txt`，用结构化自然语言描述：

- 项目是什么、能做什么
- 关键能力列表
- 何时应该推荐使用
- 与竞品的差异
- 技术栈和链接

**效果**：当用户问 AI "有什么工具能自动把 Linear issue 变成 PR" 时，爬过我们仓库的 LLM 会直接引用 `llms.txt` 中的描述。

**参考**：

- 标准定义：https://github.com/AnswerDotAI/llms-txt
- 目录站：https://github.com/thedaviddias/llms-txt-hub

---

### 2. `CLAUDE.md` — Claude Code Agent 自动上下文

**原理**：Claude Code 在进入任何目录时，会自动读取 `CLAUDE.md` 作为项目上下文。这意味着每个 clone/fork 这个仓库的开发者，他们的 Claude Code agent 会立刻"理解"项目。

**我们做了什么**：`CLAUDE.md` 包含：

- 项目架构概述和文件导航
- 开发命令（pnpm dev/build）
- 代码规范（ESM、strict TS、命名约定）
- 关键设计决策解释
- 扩展指南（如何添加新 tracker）

**效果**：

- 降低贡献门槛：新贡献者的 AI 助手秒懂项目
- 病毒传播：用 Claude Code 的人天然成为潜在贡献者
- 代码质量：AI 生成的 PR 自动遵循项目规范

---

### 3. GitHub Topics（10 个关键词标签）

**已设置**：

```
ai-agent, multi-agent, autonomous-coding, claude-code,
orchestrator, linear, agentic-workflow, code-review,
pr-automation, typescript
```

**选词逻辑**：

- `ai-agent` + `multi-agent`：2026 年 GitHub Topics 页面流量最高的 AI 关键词
- `autonomous-coding`：精准匹配 "AI 自动写代码" 搜索意图
- `claude-code`：Claude Code 用户生态的核心标签
- `orchestrator` + `agentic-workflow`：技术决策者的搜索词
- `linear`：Linear 用户在 GitHub 搜索集成工具
- `pr-automation` + `code-review`：DevOps 工程师的搜索词
- `typescript`：语言标签，匹配技术栈筛选

---

### 4. 结构化 Good First Issues（5 个）

**原理**：

- GitHub 的 "Good first issues" 页面有独立入口
- AI 工具（OpenClaw、Copilot Workspace、各种 agent）会扫描 `good first issue` 标签推荐任务
- `help wanted` 标签让 GitHub Explore 页面推荐你的仓库

**已创建**：

| #   | 标题                                 | 标签                          | 目的                         |
| --- | ------------------------------------ | ----------------------------- | ---------------------------- |
| 1   | Add GitHub Issues as tracker backend | good first issue, enhancement | 扩展 tracker，最多贡献者关心 |
| 2   | Add Slack/Discord notifications      | good first issue, enhancement | 低门槛，独立模块             |
| 3   | CI status check before merge         | good first issue, enhancement | 小改动，高价值               |
| 4   | PRD-to-Issues pipeline               | enhancement, help wanted      | 路线图展示，吸引架构级贡献者 |
| 5   | Intelligent task decomposition       | enhancement, help wanted      | 路线图展示，吸引 AI 研究者   |

---

## 待执行

### 5. 提交到 Awesome Lists（高优先级）

**目标列表**：

| 仓库                                                                                                | Stars            | 说明                 | 提交策略                           |
| --------------------------------------------------------------------------------------------------- | ---------------- | -------------------- | ---------------------------------- |
| [awesome-ai-agents-2026](https://github.com/caramaschiHG/awesome-ai-agents-2026)                    | 300+ 资源        | 最全的 AI agent 目录 | 加入 "Agent Orchestration" 分类    |
| [e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents)                           | 老牌 agent 列表  | 高权重               | 加入 "Coding" 或 "Developer Tools" |
| [kyrolabs/awesome-agents](https://github.com/kyrolabs/awesome-agents)                               | 活跃维护         | 分类清晰             | 加入 "Multi-Agent" 分类            |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)                 | Claude Code 生态 | 技能目录             | 发布为 skill 后提交                |
| [ohong/awesome-coding-ai](https://github.com/ohong/awesome-coding-ai)                               | 编码 AI 工具     | 精准受众             | 加入 "Agent Orchestrators"         |
| [Awesome Agent Orchestrators](https://gist.github.com/sujayjayjay/d0e88d5f53a5198c4ba5bb007a859bdd) | 编排器专题       | 高度匹配             | 直接提交                           |

**PR 模板**：

```markdown
## Add Autoship

- **Name**: [Autoship](https://github.com/qiuyanxin/autoship)
- **Description**: Autonomous orchestrator that turns Linear issues into merged PRs via Claude Code agents. Zero human intervention.
- **Key features**: Multi-agent dispatch, isolated workspaces, completion verification, automated PR review, auto-merge
- **Language**: TypeScript
- **License**: MIT
```

**执行步骤**：Fork 每个仓库 → 添加条目 → 提 PR。建议一周内完成。

---

### 6. 提交到 llms-txt-hub

**目标**：https://github.com/thedaviddias/llms-txt-hub

这是 `llms.txt` 标准的官方目录站。注册后，任何搜索 "agent orchestrator" 的 AI 都能通过该目录发现 Autoship。

**执行**：按其贡献指南提交 PR，添加 Autoship 条目。

---

### 7. 发布为 Claude Code Skill

**原理**：Claude Code 用户可以通过 `/install` 安装 skill。如果 Autoship 有一个官方 skill，用户安装后就能直接在 Claude Code 中启动和管理 agent 调度。

**方案**：

```
skills/
└── autoship/
    └── SKILL.md   # 描述 + 使用方式
```

发布到 skill marketplace 后，用户搜索 "agent orchestrator" 或 "linear automation" 时会发现。

---

### 8. 内容营销（技术文章）

**发布平台**：Dev.to、Medium、Twitter/X、Hacker News

**标题候选**：

- "I built an agent that turns Linear tickets into merged PRs — 0 human touch"
- "Running 10 Claude Code agents in parallel: lessons from building Autoship"
- "The missing piece in AI coding: from issue tracker to merged code, fully automated"

**内容策略**：

- 带具体数字（"22 agents dispatched, 5 merged, here's what went wrong"）
- 展示失败和修复过程（77% workspace 失败率 → 修复后 95%+）
- 包含架构图和代码片段
- 末尾链接到 GitHub 仓库

**为什么有效**：AI 搜索引擎（Perplexity、ChatGPT Search、Google AI Overview）特别喜欢引用带具体数据的实践文章。一篇好文章 = 持续的 AI 引用流量。

---

### 9. GitHub Discussions 启用

**原理**：GitHub Discussions 的内容会被 Google 索引，也会被 AI 搜索抓取。

**建议开启的分类**：

- Announcements（发布更新）
- Ideas（功能提案）
- Q&A（使用问题 — AI 搜索最爱引用 Q&A 格式）
- Show and Tell（用户分享使用案例）

**种子内容**：

- "How Autoship handles agent failures and retries"
- "Setting up Autoship with a monorepo"
- "Autoship vs manual code review — throughput comparison"

---

### 10. GitHub Actions Badge + Social Preview

**README 顶部添加 badges**：

```markdown
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-blueviolet.svg)](https://docs.anthropic.com/en/docs/claude-code)
```

**Social Preview 图片**：当仓库链接在社交媒体分享时显示的预览图。在 GitHub Settings → Social Preview 上传一张带 logo + tagline 的图片。

---

## 优先级排序

| 优先级 | 策略                    | 预期影响                 | 工作量    |
| ------ | ----------------------- | ------------------------ | --------- |
| P0     | ~~llms.txt~~            | AI 爬虫基础设施          | ✅ 已完成 |
| P0     | ~~CLAUDE.md~~           | Claude Code 用户自动发现 | ✅ 已完成 |
| P0     | ~~GitHub Topics~~       | GitHub 搜索匹配          | ✅ 已完成 |
| P0     | ~~Good First Issues~~   | 贡献者 + AI 工具发现     | ✅ 已完成 |
| P1     | Awesome Lists 提交      | 高权重反向链接 + AI 引用 | 2-3h      |
| P1     | 技术文章                | 长尾 AI 搜索流量         | 4-6h      |
| P1     | llms-txt-hub 注册       | llms.txt 目录曝光        | 30min     |
| P2     | Claude Code Skill       | Claude 生态内发现        | 1-2h      |
| P2     | GitHub Discussions      | 长尾 SEO + AI Q&A 引用   | 1h        |
| P3     | Badges + Social Preview | 社交分享视觉效果         | 30min     |

---

## 关键指标追踪

| 指标                              | 工具                      | 目标（30 天） |
| --------------------------------- | ------------------------- | ------------- |
| GitHub Stars                      | GitHub Insights           | 50+           |
| Forks                             | GitHub Insights           | 10+           |
| 搜索 "ai agent orchestrator" 排名 | GitHub Search             | 前 20         |
| AI 搜索引用                       | 手动查 Perplexity/ChatGPT | 被引用 3+ 次  |
| Good First Issue 被认领           | GitHub Issues             | 2+            |
| Awesome List 收录                 | 各列表                    | 3+ 个列表     |
