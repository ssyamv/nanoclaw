---
name: code-review
description: Use when reviewing a PR, MR, or diff on behalf of the team — whether requested explicitly or arriving via webhook. Focuses on correctness, security, and project convention, NOT style nits. Pairs with `requesting-code-review` (Agent requests review of its own work) and `receiving-code-review` (Agent applies feedback it received). Triggers on "review 一下 PR / 帮我审这个 MR / 看看这个 diff 有没有问题".
---

# Code Review

Produce a review that a human reviewer would sign off on — not a checklist of style nits.

## Scope of a Review

In priority order:

1. **Correctness** — logic errors, off-by-one, race conditions, wrong status codes, missed null/empty cases.
2. **Security** — auth bypass, injection (SQL / shell / path), secrets in code, unsafe deserialization, missing input validation at boundaries.
3. **Convention alignment** — does this match how the surrounding code solves similar problems? (Use `Grep` on the repo before commenting — don't invent rules.)
4. **Testability** — new behavior should have tests covering at least the golden path + one edge. Missing coverage is a blocker for non-trivial changes.
5. **Observability** — new errors logged; new endpoints have at least one INFO log.

## Not In Scope

- Cosmetic formatting (linters handle that)
- Bikeshedding naming unless truly misleading
- "Could also do it this way" — only propose alternatives when the current approach is wrong

## Output Format

```markdown
## Review — <PR title / link>

**Verdict**: ✅ LGTM / ⚠️ Changes requested / ❌ Blocking

### Blocking
- path/to/file.ts:123 — <issue, evidence, suggested fix>

### Suggestions
- path/to/other.ts:45 — <non-blocking improvement>

### Questions
- <ask the author for context on decisions that look risky>

### Coverage
- Tests added: <files>
- Missing cases: <specific scenarios>
```

Every Blocking item MUST cite file:line and state the failure mode concretely. "Feels off" is not a review comment — if you can't articulate the failure mode, don't block on it.

## 工作流

1. `gh pr view <num>` + `gh pr diff <num>` 拉取 diff 和描述。
2. 若 diff > 500 行，先读 PR 描述 → 跳读关键文件 → 再细读。
3. `Grep` 周边代码验证约定（错误处理模式、命名、目录结构）。
4. 按上面格式产出 review；Blocking 必须有证据链。
5. `gh pr comment <num> --body-file /tmp/review.md` 发评论（不要 approve，ArcFlow 只有人类能 merge）。

## 反模式

- 给"建议" 但不标 Blocking / Suggestions — 作者无法判断必要性。
- 泛泛说"建议加测试" — 要指出具体场景。
- review 里掺自己的重构喜好 — review 是守门，不是重写。
