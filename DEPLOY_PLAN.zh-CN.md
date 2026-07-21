# LibreChat 本机部署计划

此目录从 LibreChat 官方 GitHub 仓库的已验证 `v0.8.7` 标签取得，源码提交为 `9e74cc0e57b395926122bd4062c1fcedc48ed465`。本地版本采用“官方三段版本 + 本地修订号”，当前待发布版本为 `v0.8.7.18`；版本与官方镜像 digest 集中记录在 `deployment/version.env`。运行时以官方同版本、同一 AMD64 manifest digest 的镜像为基础，而不是 `latest`。

本部署启动三个容器：LibreChat、MongoDB 和官方 Admin Panel。三者使用主机网络，但进程分别只绑定 `127.0.0.1:3080`、`127.0.0.1:27017` 与 `127.0.0.1:3000`，不会监听公网，也不会修改 DNS、Tunnel、Nginx 或现有的 `80/443` 服务。

## 本机验证

```bash
cd /home/ubuntu/librechat-deploy
./scripts/prepare.sh
./scripts/preflight.sh
./scripts/deploy.sh
./scripts/healthcheck.sh
```

`prepare.sh` 只在 `.env` 不存在时生成 JWT、刷新 JWT、凭据加密密钥、凭据 IV、MongoDB 本地密码和 Admin Panel 会话密钥。`.env` 权限为 `0600`，其中不含任何模型供应商真实 Key。

在另一台电脑查看本机效果时，通过 SSH 本地转发访问，不要先创建 Tunnel：

```bash
ssh -N -L 3080:127.0.0.1:3080 -L 3000:127.0.0.1:3000 ubuntu@SERVER_IP
```

然后在浏览器打开 `http://localhost:3080` 使用 LibreChat，或打开 `http://localhost:3000` 使用 Admin Panel。Admin Panel 使用同一个管理员账户登录，可管理用户、角色和可由面板支持的 LibreChat 配置。注册后，用户在 LibreChat 的 API Key 设置中分别填写各自的 OpenAI、Gemini、Claude 和 Grok Key；服务端固定使用各渠道地址，用户不能修改 Base URL，也不会保存共享供应商 Key。四个渠道入口始终显示，但未保存有效 Key 的渠道不显示模型；每次保存或撤销 Key 后，LibreChat 会自动刷新对应渠道的模型列表。

默认页脚显示 `ToCreate | Powered by LibreChat vX.Y.Z.N`。`ToCreate` 链接到 `https://api.lihe.chat`，版本文字链接到 `https://github.com/floating0516/LibreChat`；新部署由 `prepare.sh` 根据 `deployment/version.env` 写入版本号。现有部署升级版本时同步更新 `.env` 的 `CUSTOM_FOOTER` 版本文字，然后只重启 API。

## 联网搜索与智能体工具

聊天工具栏默认固定“网页搜索”和 MCP 入口。原生网页搜索由 Tavily 同时完成搜索与正文提取，使用 `basic` 深度、最多 5 条结果且不额外调用重排服务；每位用户在网页搜索设置中保存自己的 Tavily Key，服务端不保存共享付费 Key。Tavily 免费账户当前提供每月 1,000 credits、无需信用卡；一次基础搜索消耗 1 credit，最多 5 个页面的基础提取合计再消耗 1 credit。

审核后的远程 MCP 只开放以下四项：`Tavily Web` 无需 Key 即可搜索网页和提取正文；`Context7 Docs` 无需 Key 即可查询最新的库、框架和 SDK 文档；`Jina Web Research` 使用用户自己的免费 Jina Key，提供网页读取、网页搜索、arXiv 和图片搜索；`GitHub Repositories` 使用用户自己的 fine-grained PAT，并固定为官方 `repos/readonly` 工具集及 lockdown 模式。Jina Key 与 GitHub PAT 在 MCP 工具选择界面按用户填写并加密保存，不写入 YAML 或共享环境变量。

普通用户只能使用上述审核服务器，不能新增、共享或公开任意 MCP；出站连接严格限制为四个官方 HTTPS 域名。MCP 指令明确把网页和仓库内容视为不可信数据，禁止把检索内容当成指令，也禁止向 Context7 发送密钥、个人数据或私有代码。免费额度和限流由各供应商调整，正式高频使用前应复核其官方价格页。

当前主机只有约 3.6 GiB RAM，且未部署 RAG API 或 Code Interpreter API，因此 `fileSearch` 与 `runCode` 保持关闭，Agent 能力也不暴露 `file_search` 或 `execute_code`。Artifacts、网页搜索、MCP、上下文文件、Skills、Actions、Subagents 和工具链能力仍可使用；需要沙箱执行代码或向量检索时，应先增加主机资源或接入独立的远程后端。

## 定制镜像与远程构建

本目录的 Claude/Grok 渠道包含定制模型发现补丁。新的本地修订先提交并推送到 fork 的维护分支，再通过专用 GitHub Actions workflow 构建单架构 AMD64 镜像、发布不可变 GHCR tag/digest，并由本机下载经过校验的构建元数据和镜像：

```bash
./scripts/build-remote-image.sh
```

远程构建从 `deployment/version.env` 生成四段版本和 `ghcr.io/floating0516/librechat-local:vX.Y.Z.N`，使用 `Dockerfile.local` 重编译 data-provider、data-schemas、API 包和浏览器客户端。workflow 会验证镜像版本、关键产物、模型门控、临时依赖清理和 LangChain Responses 回归，并输出包含 commit、版本和 digest 的校验元数据。本机脚本只接受与当前已推送 commit 完全一致的元数据，按 digest 拉取后再标记为 `librechat-local:vX.Y.Z.N`；它不会修改 `.env` 或部署服务。

每次发布新的本地修改前递增 `LIBRECHAT_LOCAL_REVISION`，不要覆盖本地或 GHCR 已存在的不可变标签。远程镜像验证后，只修改 `.env` 的 `LIBRECHAT_IMAGE` 行，执行 preflight，并用 `compose up -d --no-deps api` 只重建 API。仅当 GitHub Actions 或 GHCR 明确不可用且已经报告原因时，才使用 `./scripts/build-local-image.sh` 作为本机回退。

`v0.8.7.5` 对基础镜像中的 `@langchain/openai@1.4.5` 应用版本锁定的 Responses 转换补丁，使缺省或为 `null` 的 `output_text.annotations` 按空数组处理。构建会精确核对待修改源码，并分别执行 CommonJS 与 ES module 行为验证；依赖版本或上游代码不匹配时构建会直接失败。

`v0.8.7.6` 增加 Lihe API 一键连接接收端：采用 Authorization Code、PKCE、HMAC state 与 HttpOnly OAuth Cookie，服务器间兑换长期专用 Token，并复用现有用户 Key 加密存储。导入会保存旧 Provider Key 快照，解除绑定时恢复未被用户手工修改的旧值。

待发布的 `v0.8.7.7` 补齐 API 站所选 `api_key_id` 的安全传递：浏览器端与服务端只接受规范的正 int64 字符串，服务端拒绝缺失或夹带未知字段的开始请求，再把 ID 加入受 PKCE/state 保护的授权流程。API 站继续负责认证用户、Key 归属、状态与兑换事务的二次复验；本站本地入口在缺少 ID 时返回 API 站选择页。公网域名脚本同时固定使用 `--no-deps`，避免共享 `.env` 变化连带重建 MongoDB。

`v0.8.7.8` 增加统一 Lihe 账号接收端：OIDC 登录显式支持 `client_secret_basic`、PKCE S256 与 nonce；已有本地用户通过独立回调绑定 `(issuer, sub)`，保留原 Mongo `_id` 和全部数据；删除前写永久身份 tombstone，防止 `sub` 被复用。Lihe 长期 Token 在统一模式下必须返回同一 `account_id`，不匹配即撤销。所有生产开关默认关闭，只有 API 端 Discovery、JWKS、两个精确回调和测试 Client 完成联调后才能启用。

`v0.8.7.9` 增加统一账号的隐藏联调模式：公开社交登录保持关闭，只初始化普通 OpenID 和账号绑定策略；服务器端使用已验证邮箱精确白名单同时限制绑定入口、登录回调和 Lihe `account_id/sub` 强校验。白名单不会进入匿名配置或浏览器包，非测试用户看不到入口且直接请求也会失败；管理后台 OIDC、其他社交登录和社交注册不会随隐藏模式启用。

`v0.8.7.10` 包含 `openid-client` v6 Token 端认证修复，但新增镜像校验加载完整策略后保留后台句柄，远程验证未完成，因此该 GHCR 标签未部署。

`v0.8.7.11` 保留认证修复：除声明 `token_endpoint_auth_method` 外，还显式向客户端配置传入对应认证对象，确保 `client_secret_basic` 使用 Authorization Header，且请求正文不携带 Client Secret。镜像验收会直接检查实际 Header 与表单，并在成功后显式退出且受 30 秒超时保护。

`v0.8.7.12` 把 Claude 模型发现固定到 Anthropic 原生 `GET /v1/models`，继续使用 `x-api-key`，并避免已经包含 `/v1` 的反向代理地址重复拼接路径。Lihe 凭据元数据升级为兼容旧数据的 v2 多连接格式：不同 Provider 的 Token 可长期并存，重连只替换重叠 Provider，断开菜单按 Provider 操作；共享 Token 仍被其他 Provider 使用时不会提前撤销。镜像验收使用合成 Token 验证模型路径、并存、逐 Provider 断开和最终撤销，不读取真实用户 Key。

`v0.8.7.13` 把主应用、浏览器页签与 PWA 安装名称统一为 `ToCreate`，并替换登录页标识、favicon、Apple Touch 与 maskable 图标。此版本同时修复 `public/assets` 被错误复制到双层 `/assets/assets` 的路径问题，让登录页 Logo、favicon 与 Grok 图标都从标准 `/assets/*` 地址返回；镜像验收会检查品牌元数据、各尺寸图标，并拒绝双层资源目录。

`v0.8.7.14` 为所有模型端点统一设置简体中文对话标题提示词，保留必要的产品名、技术名词和代码标识，并禁止模型在标题中输出解释或思考过程。标题清理同时覆盖模型实际返回的 `<think>` 与 `<thinking>` 推理标签，清理后为空时使用中文回退标题。

`v0.8.7.15` 增加独立于亮色、暗色与跟随系统模式的界面风格选择，提供默认、Claude 和 ChatGPT 三种外观。Claude 与 ChatGPT 风格基于 `assistant-ui` 的 MIT 示例移植配色、排版、消息气泡、输入框和侧栏视觉，不替换 LibreChat 的消息状态、附件、搜索、工具调用或智能体功能；选择仅保存在当前浏览器本地。

`v0.8.7.16` 为 Claude 和 ChatGPT 外观嵌入 OFL-1.1 授权的 Noto Serif SC 与 Noto Sans SC 简体中文字体。两种外观的界面框架均以 Inter 显示英文、以思源黑体显示中文；Claude 的消息正文、欢迎标题和输入框进一步使用思源宋体；代码区域继续固定使用 Roboto Mono。字体文件随本地镜像提供，不依赖客户端系统字体或第三方 CDN。

`v0.8.7.17` 精简统一侧栏的常驻工具入口：图标栏只保留优先级最高的两个导航面板，通常为对话历史与智能体；技能、提示词、记忆、书签、文件、参数和 MCP 等低频入口集中到带文字标签的工具菜单。菜单会标记当前面板，并在折叠状态选择工具后自动展开侧栏，所有原有功能和权限判断保持不变。

待发布的 `v0.8.7.18` 统一 Claude 浅色风格的表面配色：设置及其他标准对话框使用暖米白背景，聊天输入框改用同系列的浅米白，不再出现与整体界面割裂的纯白区域；Claude 深色模式、ChatGPT 风格和默认风格保持不变。

官方升级时，先把新官方代码合并到本地定制分支并解决冲突，再把 `LIBRECHAT_UPSTREAM_VERSION` 和 `LIBRECHAT_BASE_DIGEST` 更新到已验证的新发布，把 `LIBRECHAT_LOCAL_REVISION` 重置为 `1`，完成构建与健康检查后再部署。

## 公开域名

默认目标域名记录为 `chat.lihe.chat`，但初始配置保持本机 HTTP，确保 Tunnel 建立前可完成登录和界面验证。确认本机验证通过、Tunnel 与 DNS 均已由你单独准备好之后，再执行：

```bash
./scripts/enable-public-domain.sh
```

该脚本只把 LibreChat 自身的公开 URL 切换为 `https://chat.lihe.chat` 并重启 API；它不会创建、修改或删除 Tunnel/DNS。

## 运维

```bash
./scripts/backup.sh
./scripts/healthcheck.sh
```

备份文件和校验和保存在 `runtime/backups/`，默认保留 14 天。MongoDB、上传文件和日志均在 `runtime/` 下持久化。

本机资源为 2 核 / 3.6 GiB，低于 4 GiB 的推荐下限，因此预检查会给出警告但允许进行试运行。生产建议至少 4 核 / 8 GiB。
