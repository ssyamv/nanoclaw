---
name: arcflow-openapi-gen
description: Use to generate or update OpenAPI 3.1 YAML from an approved tech-design document. Replaces the former Dify "tech design → OpenAPI" workflow. Enforces ArcFlow's Result<T> envelope, Java naming conventions, and RESTful resource modeling so the generated spec can feed backend code generation without manual cleanup. Triggers on "生成 OpenAPI / 出接口文档 / tech → api".
---

# ArcFlow OpenAPI Generation

Deterministic tech-design → OpenAPI YAML. Must be consistent across runs so downstream code gen doesn't churn.

## Inputs

- A tech-design document in `tech-design/<slug>.md` (read via `arcflow-knowledge kb_read_doc`)
- Existing OpenAPI specs in `api/` — respect existing component schemas when the new endpoints reuse types

## Output

- `api/<plane-issue-id>-<slug>.yaml` in the docs repo
- OpenAPI 3.1, UTF-8, 2-space indent

## Hard Rules

1. **统一响应包裹** — 所有 200 响应 `application/json` 的 schema 必须是

   ```yaml
   allOf:
     - $ref: '#/components/schemas/Result'
     - type: object
       properties:
         data: { $ref: '#/components/schemas/<Entity>' }
   ```

   `Result` schema 定义一次，复用。

2. **命名** — 路径 `kebab-case`，字段 `camelCase`，schema 名 `PascalCase`，枚举 `UPPER_SNAKE`。Java 侧按 `camelCase` 映射，不要出现下划线字段。

3. **分页** — 列表 endpoint 必须返回 `Page<T>`：

   ```yaml
   Page:
     type: object
     required: [content, total, page, size]
     properties:
       content: { type: array, items: {} }
       total:   { type: integer, format: int64 }
       page:    { type: integer }
       size:    { type: integer }
   ```

4. **错误码** — 4xx / 5xx 响应统一指向 `components/responses/ErrorResponse`，body 为 `Result` 且 `data: null` + `code` + `message`。

5. **鉴权** — 除显式注明"公开"的 endpoint，都必须 `security: [{ bearerAuth: [] }]`，schema 里声明 `bearerAuth` 为 `http bearer` + `JWT`。

6. **examples** — 每个 request/response 至少一个 `example`，取自 tech-design 的典型场景。没有 example 的 endpoint 视为不完整。

## 工作流

1. 读 tech-design §5（接口契约）+ §4（数据模型）。
2. 先列出 endpoint 清单 + schema 清单给用户确认（别直接生成完整 YAML）。
3. 用户确认后一把生成 YAML。
4. 自检：
   - 所有 `$ref` 能解析
   - 所有 200 响应包了 `Result`
   - 所有非公开 endpoint 有 `security`
   - 列表 endpoint 用了 `Page`
   - 每个 endpoint 有 example
5. 通过 Gateway `/api/docs/file` 写入 `api/<file>.yaml`。
6. 提示"可触发 `arcflow-workflow trigger code_gen_backend <issue_id>`"。

## 反模式

- 不要凭想象造字段 — 不清楚的问用户，或从 tech-design 明确引用。
- 不要内联重复 schema — 公共类型提取到 `components/schemas`。
- 不要在 OpenAPI 里解释业务逻辑 — 那是 tech-design 的事；`description` 只写字段含义 + 约束。
