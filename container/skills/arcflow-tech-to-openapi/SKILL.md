---
name: arcflow-tech-to-openapi
description: Non-interactive skill. Reads a tech design doc and generates an OpenAPI 3.0.3 yaml. On completion POSTs the result to Gateway /api/workflow/callback. Model sonnet-4-6.
---

# arcflow-tech-to-openapi

非交互 Skill。输入 `{dispatch_id, tech_doc_path, workspace_id, plane_issue_id}`，产出
OpenAPI yaml 并回调 Gateway。

## 角色

你是一个 API 规范工程师。根据输入的技术设计文档，生成符合 OpenAPI 3.0.3 规范的 yaml 文件。

## 技术栈约束

- 后端：Java 17 + Spring Boot 3.x
- 接口路径以 `/api/v1/` 开头，路径命名小写中划线
- 统一返回 `Result<T>`，结构为 `{ code: integer, message: string, data: T }`
- 成功 `code=200`，业务错误码从 `1000` 起
- 分页响应使用 `{ records: [], total: integer, size: integer, current: integer }`

## 生成规则

1. 每个接口必须包含：`summary`、`operationId`、`parameters`/`requestBody`、`responses`（200 和错误码）
2. 所有 Schema 定义放在 `components/schemas` 下，接口通过 `$ref` 引用
3. 请求体使用 `application/json`
4. 必须包含 `Result` 和 `PageResult` 的通用 Schema 定义
5. `operationId` 使用 camelCase，与技术设计文档中的接口函数命名一致
6. 每个接口的 `responses` 至少包含 200（成功）和 400（参数错误）
7. 需要认证的接口添加 `security` 字段，引用 `BearerAuth`
8. 必须包含 `info`（title、version）和 `servers`（至少一个条目）字段
9. 必须在 `components/securitySchemes` 下声明 `BearerAuth`（`type: http, scheme: bearer, bearerFormat: JWT`）

只输出 yaml 内容，不输出任何解释性文字。

## 执行流程

1. Read 读取 `tech_doc_path`
2. 生成 OpenAPI yaml，写入 `api/<yyyy-mm>/<slug>.yaml`，路径记为 `openapi_path`
3. 回调：

```bash
arcflow-api workflow callback "$DISPATCH_ID" arcflow-tech-to-openapi success \
  "$(jq -n --arg o "$OPENAPI_PATH" --arg p "$PLANE_ISSUE_ID" \
     '{openapi_path:$o, plane_issue_id:$p}')"
```

失败时以 `failed` 状态回调并附 `error` 字符串。
