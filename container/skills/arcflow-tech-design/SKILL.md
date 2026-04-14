---
name: arcflow-tech-design
description: Use when converting an approved PRD into a technical design document. Replaces the former Dify "PRD → tech design" workflow. Produces a Markdown spec at `tech-design/<slug>.md` in the workspace docs repo with a fixed structure so OpenAPI generation and code generation can chain off it. Triggers on "生成技术方案 / 技术设计 / 出个技术文档 / PRD → 技术".
---

# ArcFlow Tech Design Authoring

Read an approved PRD and produce a deterministic technical design document. Output format is fixed — downstream skills depend on the section anchors.

## Inputs

- `plane_issue_id` or `draft_id`
- Current PRD content (via `arcflow-requirement get` or `arcflow-knowledge kb_read_doc`)
- Code layout of the target repo(s) — read via native `Read` / `Grep` on `/workspace`

## Required Sections (strict order)

```markdown
# 技术设计 — <需求标题>
> 对应 PRD: <link>  · 状态: Draft · 作者: NanoClaw

## 1. 背景 & 目标映射
<一段话复述需求目标；列出本设计覆盖 / 不覆盖 的范围>

## 2. 方案概览
<1-2 段话 + 可选 Mermaid 架构图>

## 3. 关键决策
| 决策点 | 选项 | 选择 | 理由 |
...

## 4. 数据模型
<新增或改动的表/字段；含 DDL 或 schema 片段>

## 5. 接口契约
<列出要新增/改动的 endpoints — 路径/方法/鉴权/核心字段。OpenAPI 不在这里细化，交给 arcflow-openapi-gen>

## 6. 变更影响面
<影响哪些模块/页面/端；向后兼容说明>

## 7. 风险与回滚
<已识别的风险 + 回滚路径>

## 8. 里程碑切片
<MVP / 增强 / 可延后>

## 9. 验收测试
<每条 PRD 验收标准映射到可执行的测试场景>
```

## 工作流

1. 拉 PRD → 概览核心问题、主用户故事、功能清单。
2. 读相关代码仓库（后端 / vue3 / flutter / android 按命中范围选）熟悉现有模式，避免设计出与既有架构冲突的方案。
3. 起草 §1-§3（方案 + 决策）先和用户对齐 — 不要一把写到 §9。
4. 用户确认方向后再写 §4-§9。
5. 落盘：Gateway docs 仓库路径 `tech-design/<plane-issue-id>-<slug>.md`，通过 Gateway `/api/docs/file` POST 写入（走 `arcflow-knowledge` 的上游 API，或直接 curl — 此操作**只能通过 Gateway**）。
6. 完成后，提示"可触发 `arcflow-workflow trigger tech_to_openapi <issue_id>`"。

## 反模式

- 不要写"将使用 Redis 做缓存"这种无条件断言 — 写成"缓存方案：候选 Redis / 本地 LRU；选 Redis，理由：..."。
- 不要复制 PRD 原文大段 — 引用 + 补充技术视角。
- §5 接口契约粒度不要到字段 DTO — OpenAPI 生成器会展开。
- 任何"TODO"、"待讨论" — 必须先找用户确认，不能留空在最终文档里。
