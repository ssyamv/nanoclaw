---
name: arcflow-auth-check
description: Phase 0 联通验证 — 读取容器内挂载的 ArcFlow 凭证并调用 Gateway 验证身份
---

# arcflow-auth-check

Phase 0 联通验证 skill，确认凭证文件挂载正确并能成功调用 Gateway。

```bash
#!/bin/bash
set -e
TOKEN=$(jq -r .token /run/arcflow/credentials.json)
GATEWAY=$(jq -r .gatewayUrl /run/arcflow/credentials.json)
curl -fsS -H "Authorization: Bearer $TOKEN" "$GATEWAY/api/auth/me"
```
