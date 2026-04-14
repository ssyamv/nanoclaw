---
name: arcflow-release-checklist
description: Use before shipping any ArcFlow feature to production. Walks the required pre-release checks (tests / coverage / docs / migrations / Feishu dry-run / rollback plan) as TodoWrite items. Triggers on "准备上线 / 发版 / pre-release / release checklist".
---

# ArcFlow Release Checklist

Pre-ship gate. Convert every item below into a TodoWrite task and complete in order. DO NOT self-approve — verification steps require explicit evidence.

## Checklist

1. **所有测试绿灯** — `npm test` / `mvn test` / `flutter test`，贴当次运行 summary 到对话。
2. **覆盖率** — 新增/改动文件覆盖率不低于 80%；低于则列出未覆盖分支。
3. **数据库迁移审查** — 若本版本含 migration:
   - DDL 向后兼容（先加列再改代码，不要同版本里删列）
   - 大表变更附 rollout 方案（分批 / 在线 DDL / 维护窗口）
   - 附回滚脚本
4. **配置 / 环境变量** — 新增 env 必须在 `.env.example` / docker-compose / docs 同步。
5. **文档** — PRD / tech-design / OpenAPI / 发布说明全部 merged，用 `arcflow-knowledge kb_search_prd` 验证已落 docs 仓。
6. **接口兼容性** — 删字段 / 改路径 / 改状态码 ⇒ 必须声明为 breaking，附通知时间线。
7. **权限 / 安全** — 涉及权限变更的 endpoint 走过 `owasp top 10` 心智模型走查（至少 auth / authz / input validation / 日志脱敏）。
8. **可观测性** — 新 endpoint 至少有一条 INFO 级日志 + 错误路径有 WARN/ERROR；监控指标（QPS / 错误率 / 延迟）已接入。
9. **飞书通知 dry-run** — 所有会推消息的路径在预发跑一次，确认卡片 / 链接正确。
10. **回滚预案** — 写明 "发现问题后 X 分钟内回滚到 <commit>" 的具体操作。
11. **灰度方案** — 按 workspace / user / 流量比例灰度；说明灰度范围与观察窗口。
12. **on-call 通知** — 发布前 30 分钟在飞书通知 on-call + 相关开发。

## 产出

生成一份 `ops/release-YYYY-MM-DD-<slug>.md`，包含 checklist 勾选状态 + 每项证据链接。落盘走 Gateway `/api/docs/file`。

## 反模式

- "本地跑过了" — 不作数，要 CI green。
- "小改动不需要灰度" — 所有面向用户的改动都需要显式灰度策略（哪怕是"全量，0 分钟观察"也要显式写）。
- "回滚 = revert commit" — 不够，要写具体命令/步骤 + 谁执行。
