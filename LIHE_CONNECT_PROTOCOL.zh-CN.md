# Lihe 对话站连接协议 v1

本文档是 `api.lihe.chat` 与 `lihe.chat` 的联调契约。API 端和对话站端必须按本文档实现，不得把长期 Token 放进 URL、浏览器存储、前端 JavaScript 日志或访问日志。

## 固定信息

| 项目               | 生产值                                             |
| ------------------ | -------------------------------------------------- |
| API 平台           | `https://api.lihe.chat`                            |
| 对话站             | `https://lihe.chat`                                |
| `client_id`        | `lihe-chat`                                        |
| API 站按钮         | `https://lihe.chat/connect/lihe?api_key_id=<id>`   |
| OAuth 回调         | `https://lihe.chat/api/integrations/lihe/callback` |
| 授权范围           | `models:read chat:write`                           |
| 支持的 Provider 值 | `openAI`、`anthropic`、`google`                    |

`client_secret` 由两端管理员通过安全渠道生成和保存，只允许服务器读取。Token 与撤销接口采用 OAuth `client_secret_basic`，即 HTTP `Authorization: Basic base64(client_id:client_secret)`。

## 1. API 站按钮

API 用户登录后点击“导入对话站”，浏览器在当前标签页打开：

```text
https://lihe.chat/connect/lihe?api_key_id=<id>
```

`api_key_id` 必须是 API 站数据库中的规范十进制正整数，范围为 `1..9223372036854775807`。它只是所选 Key 的不透明标识，不是认证凭据；按钮不能附带 API Key 明文、Token、用户 ID、邮箱或任意回调地址。对话站只验证 ID 格式，不信任其归属，负责创建 `state` 和 PKCE，再把 ID 转发给 API 平台授权。

API 平台必须从登录认证上下文取得当前用户，验证 `api_key_id` 对应 Key 属于该用户、未删除且处于可用状态，并验证所属分组与 Provider 可用。授权码必须同时绑定用户与 Key；Token 兑换事务内必须再次复验归属和状态，并拒绝换绑、失效 Key 与竞态重放。

## 2. 授权接口

```http
GET /oauth/authorize
```

查询参数：

| 字段                    | 要求                            |
| ----------------------- | ------------------------------- |
| `response_type`         | 固定为 `code`                   |
| `client_id`             | 固定为 `lihe-chat`              |
| `redirect_uri`          | 必须精确匹配登记值              |
| `scope`                 | 固定为 `models:read chat:write` |
| `state`                 | 原样返回，不记录日志            |
| `code_challenge`        | PKCE S256 challenge             |
| `code_challenge_method` | 固定为 `S256`                   |
| `api_key_id`            | API 站按钮中选择的 Key ID       |

API 端必须验证登录用户、`client_id`、回调地址、scope 与 `api_key_id` 的用户归属和可用状态。授权成功后生成至少 256 bit 随机 code，只保存 code 哈希，并记录用户、Key ID、PKCE challenge、回调地址、scope、创建时间、使用状态。code 在 60 秒后失效且只能原子消费一次。

成功跳转：

```text
https://lihe.chat/api/integrations/lihe/callback?code=...&state=...
```

用户拒绝时：

```text
https://lihe.chat/api/integrations/lihe/callback?error=access_denied&state=...
```

## 3. Token 兑换接口

```http
POST /oauth/token
Authorization: Basic <client credentials>
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

表单字段：

```text
grant_type=authorization_code
client_id=lihe-chat
code=<single-use-code>
redirect_uri=https://lihe.chat/api/integrations/lihe/callback
code_verifier=<pkce-verifier>
```

成功响应必须是：

```json
{
  "access_token": "lhc_...",
  "token_type": "Bearer",
  "scope": "models:read chat:write",
  "providers": ["openAI", "anthropic"],
  "account_id": "opaque-account-id",
  "account_label": "masked-or-display-name",
  "expires_in": null
}
```

要求：

- `access_token` 是独立的对话站 Token，长期有效，直到撤销。
- `expires_in` 必须为 `null` 或省略；返回数字会被对话站拒绝。
- `providers` 至少一项，只能使用固定大小写的允许值。
- 启用统一账号模式后，`account_id` 必须返回，且必须精确等于该用户 OIDC ID Token 的稳定 `sub`；`account_label` 可省略。两者都不能包含密钥或敏感身份信息。
- API 数据库只保存 Token 的安全哈希，明文只在本响应返回一次。
- Token 只能查询模型和发起聊天，不能管理账户、余额、支付或其他 Key。

OAuth 错误使用标准状态码和响应，例如：

```json
{
  "error": "invalid_grant",
  "error_description": "Authorization code is invalid, expired, or already used"
}
```

错误描述不得包含 code、Token、client secret 或数据库内容。

## 4. Token 验证

对话站兑换后立即调用：

```http
GET /v1/models
Authorization: Bearer <access_token>
Accept: application/json
```

API 端必须返回 OpenAI 兼容结构，且至少有一个模型：

```json
{
  "data": [{ "id": "model-id" }]
}
```

验证失败时，对话站不会保存 Token，并会尝试调用撤销接口。

## 5. 对话请求认证

导入成功后，LibreChat 会把同一个专用 Token 当作对应 Provider 的用户 Key 使用。API 端不能只让该 Token 通过 `/v1/models`，还必须在实际对话路由识别它：

| Provider    | API 路由                                | Token 位置                          |
| ----------- | --------------------------------------- | ----------------------------------- |
| `openAI`    | `/v1/chat/completions`、`/v1/responses` | `Authorization: Bearer <token>`     |
| `anthropic` | `/v1/messages`                          | `x-api-key: <token>`                |
| `google`    | API 端现有的 Gemini 兼容路由            | 按 Gemini SDK 的 API Key 请求头处理 |

API 端收到请求后必须先规范化认证头，再用 Token 安全哈希查询同一条专用 Token 记录，并依次验证：未撤销、账号可用、包含 `chat:write`、当前路由属于 `providers` 白名单。禁止从查询参数读取 Token。

- Token 无效、已撤销或账号停用时返回 `401`。
- Token 有效但 scope 或 Provider 不允许时返回 `403`。
- 流式与非流式响应继续沿用 API 站现有协议，不能因为使用专用 Token 而改变 SSE/JSON 格式。
- `google` 默认不启用；只有 API 端 Gemini 代理、对话站 `GOOGLE_REVERSE_PROXY` 和 Token 请求头适配都完成联调后，才允许在 `providers` 中返回 `google`。

## 6. 撤销接口

```http
POST /oauth/revoke
Authorization: Basic <client credentials>
Content-Type: application/x-www-form-urlencoded
```

表单字段：

```text
token=<access_token>
token_type_hint=access_token
```

遵循 RFC 7009：Token 已撤销或不存在时也返回成功，保证重复操作安全。用户在 API 平台撤销、账号停用或管理员禁用后，模型请求必须立即返回 `401` 或 `403`。

## 7. 安全与日志

- 只允许 HTTPS，生产环境不得接受 HTTP 回调。
- 回调地址使用精确白名单，不允许通配符或请求参数覆盖。
- 授权和兑换接口需要用户/IP 限流，连续失败应记录安全事件。
- code 必须单次原子消费，并使用数据库 TTL 自动清理。
- Token、code、state、PKCE verifier 和 client secret 不进入日志、监控属性或错误响应。
- 每次请求可记录随机 `request_id`、结果、耗时和错误类别，用于排障。
- API 端应提供用户可见的 `lihe.chat` 专用 Token 记录和撤销按钮。

## 8. 联调验收

1. 已登录用户从按钮到新对话的 P95 小于 3 秒。
2. code 过期、重复使用、错误 PKCE、错误回调地址和错误 client secret 均被拒绝。
3. 成功导入后刷新浏览器或重启对话站仍然有效。
4. 对话站解除绑定后 Token 被撤销，旧 Provider Key 正确恢复。
5. API 平台主动撤销后，后续聊天请求立即失败且可重新绑定。
6. OpenAI 与 Anthropic 均能用同一专用 Token 完成一次流式对话；不支持的 Provider 返回 `403`。
7. URL、浏览器存储、Cloudflare 日志和两端应用日志中均不存在长期 Token。
8. 缺失、重复、非规范或超出 int64 范围的 `api_key_id` 被对话站拒绝；其他用户、已删除、已禁用或授权后失效的 Key 被 API 站拒绝，且不能在兑换阶段换绑。
9. 已绑定 OIDC 用户兑换到缺失或不匹配的 `account_id` 时，对话站不保存 Token，并立即调用撤销接口。

## 9. 统一账号 OIDC 契约

统一账号登录与本文前述 API Key OAuth 是两套独立协议和数据表，不得复用 `lihe_` 长期 Token。两边数据库保持独立，只使用 `(issuer, sub)` 建立稳定身份关联。

| 项目                | 生产值                                         |
| ------------------- | ---------------------------------------------- |
| Issuer              | `https://api.lihe.chat`                        |
| Client ID           | `lihe-chat-login`                              |
| 普通登录回调        | `https://lihe.chat/oauth/openid/callback`      |
| 已有账号绑定回调    | `https://lihe.chat/oauth/openid/link/callback` |
| Scope               | `openid profile email`                         |
| Flow                | Authorization Code + PKCE S256 + nonce         |
| Token Endpoint Auth | `client_secret_basic`                          |

Discovery 至少声明 `response_types_supported=["code"]`、`grant_types_supported=["authorization_code"]`、`subject_types_supported=["public"]`、`id_token_signing_alg_values_supported=["RS256"]`、`code_challenge_methods_supported=["S256"]` 和 `token_endpoint_auth_methods_supported=["client_secret_basic"]`。JWKS 必须提供可轮换的 RSA 公钥和稳定 `kid`。

`/oidc/token` 成功响应必须包含 `access_token`、`token_type=Bearer`、`expires_in`、`id_token` 和 `scope`。OIDC Access Token 是只允许访问 `/oidc/userinfo` 的不透明短期 Token，建议 5 分钟；第一阶段不签发 Refresh Token。`id_token` 至少包含 `iss`、稳定 `sub`、`aud`、`iat`、`exp`、`nonce`，`email_verified` 必须反映真实验证状态。

已有 LibreChat 本地用户只能从已登录的账号设置页发起绑定。对话站在服务端 Session 中保存 10 分钟的一次性绑定意图，使用独立 Passport 策略和回调；绑定时以 MongoDB 条件更新及 `(openidId, openidIssuer, tenantId)` 唯一索引防止抢占，保留原 `_id`、对话和文件。禁止按邮箱静默合并。

用户删除前，对话站先写入只含 issuer、subject 哈希和原用户 ID 的永久 tombstone；写入失败则停止删除。普通登录和已有账号绑定都会拒绝 tombstone 身份，防止删除后相同 `sub` 被另一个 MongoDB 用户复用。

第一阶段退出仅结束 LibreChat 本地会话，不调用 Provider Logout；LibreChat Refresh Session 最长 24 小时。API 端禁用账号后必须立即阻止新的 OIDC 授权和 Lihe Token 使用。

正式开放前可使用服务器端隐藏联调模式：`ALLOW_SOCIAL_LOGIN=false`、`ALLOW_SOCIAL_REGISTRATION=false`，同时只为已验证的精确邮箱白名单初始化普通 OIDC 和账号绑定策略。匿名配置与登录页不得暴露按钮；绑定开始、绑定回调、普通登录回调和 Lihe `account_id/sub` 校验都必须再次执行同一白名单检查。隐藏模式不得启用管理后台 OIDC、其他社交登录或非白名单新用户注册，验收结束后必须清空白名单并关闭隐藏模式。

生产切换必须同时满足：Discovery/JWKS 可用、两个回调地址精确登记、测试 Client Secret 通过 `client_secret_basic` 联调、历史用户绑定验收通过。随后才可启用 `ALLOW_SOCIAL_LOGIN=true`、`ALLOW_SOCIAL_REGISTRATION=true`、`OPENID_ACCOUNT_LINKING_ENABLED=true` 和 `LIHE_CONNECT_REQUIRE_OPENID_SUBJECT=true`；公开邮箱注册在迁移窗口结束后改为 `ALLOW_REGISTRATION=false`，OIDC 新用户注册仍由 `ALLOW_SOCIAL_REGISTRATION=true` 单独控制。
