# LibreChat 本机部署计划

此目录从 LibreChat 官方 GitHub 仓库的已验证 `v0.8.7` 标签取得，源码提交为 `9e74cc0e57b395926122bd4062c1fcedc48ed465`。本地版本采用“官方三段版本 + 本地修订号”，当前为 `v0.8.7.2`；版本与官方镜像 digest 集中记录在 `deployment/version.env`。运行时以官方同版本、同一 AMD64 manifest digest 的镜像为基础，而不是 `latest`。

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

## 本地定制镜像

本目录的 Claude/Grok 渠道包含本地模型发现补丁。首次部署或修改该补丁后，先构建派生镜像，再将 `.env` 中的 `LIBRECHAT_IMAGE` 设为输出的标签：

```bash
./scripts/build-local-image.sh
```

构建脚本从 `deployment/version.env` 生成 `librechat-local:v0.8.7.2`，在镜像内注入同一界面版本，并重编译 data-provider、API 包和浏览器客户端。每次发布新的本地修改前递增 `LIBRECHAT_LOCAL_REVISION`，不要覆盖已经存在的镜像标签。随后执行 `./scripts/preflight.sh` 和 `./scripts/deploy.sh`；部署脚本会识别本地镜像，不会重新拉取并覆盖它。

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
