---
name: arcflow-prd-authoring
description: Use when authoring or refining a PRD inside a requirement draft. Provides a checklist of fields that MUST be filled, detects AI cliché phrasing, and enforces the ArcFlow PRD structure so downstream skills (tech-design, openapi-gen) have everything they need. Triggers whenever the user mentions 写 PRD / 需求文档 / 产品需求 / 需要一份 PRD, or after `arcflow-requirement create_draft`.
---

# ArcFlow PRD Authoring

Drive PRD authoring to a shape that downstream Agent tasks (tech-design, openapi-gen, code_gen) can reliably consume.

## Required Sections

Every PRD MUST cover these blocks in this order. If a block is missing, ASK before writing.

1. **背景 / 目标** — 一段话说清要解决谁的什么问题，成功长什么样。
2. **用户故事** — "作为 <角色>, 我想 <动作>, 以便 <价值>" 至少 3 条，覆盖主链路。
3. **核心流程** — 步骤化描述主路径 + 1-2 条异常分支；必要时引用 Mermaid `sequenceDiagram`。
4. **功能清单** — 模块化列出，每项含"必须/可选"标注。
5. **接口范围** — 列出期望的资源与动作（粒度到 `POST /xxx`），不需要字段级细节（tech-design 会补）。
6. **非功能要求** — 性能、并发、权限、合规、可观测性 — 即使"暂无"也要显式写。
7. **验收标准** — 可被自动化或人工勾选的条目，禁止"如预期工作"这种空话。
8. **里程碑** — 至少分 1 个 MVP + 1 个增强。

## 反 AI 套话

下列短语**直接删除**，不要让它们进 PRD：

- "基于先进的 XXX 技术"
- "无缝集成 / 极致体验 / 深度优化"
- "赋能 / 闭环 / 抓手 / 对齐"
- "AI 驱动"（除非真的要上模型）
- 任何形容词堆砌段落（"本系统是一个强大、灵活、高性能的..."）

发现用户给的原文里有，用事实性语言重写。

## 工作流

1. 读取当前草稿（`arcflow-requirement get <id>`），判断缺哪些章节。
2. 按缺项单项追问，一次一个问题，别 dump checklist。
3. 每凑齐一个章节，调 `arcflow-requirement patch <id> --prd-file /tmp/prd-draft.md` 增量落盘（先读出当前 `prd_content`，追加后整体回写）。
4. 所有必需章节齐 + 用户 OK 后，提示可 `arcflow-requirement finalize <id>`。
5. 在调用 finalize 前，先跑一次 `verification-before-completion` skill：每条验收标准都问自己"这条能被机械化核对吗"。

## 注意

- PRD 存的是 Markdown 字符串 (`prd_content`)，写前必须先读一次拿当前内容，避免覆盖他人改动。
- `issue_title` / `issue_description` 是和 PRD 等价的短摘要，finalize 前必须非空。
- 不要在 PRD 里写具体的数据库 schema / 代码示例 / 技术选型 — 那是 `arcflow-tech-design` 的职责。
