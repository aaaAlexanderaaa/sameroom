# 共在 · SameRoom

用 3D 房间整理物品、库存和设备。网页与 Agent 通过同一套 API 读写数据。
前端使用 React、Three.js，后端是一个 Node/Express 服务，数据保存在本地 JSON 文件中。

## 运行

需要 Node.js 22.12 以上版本和 npm。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173。生产运行：

```bash
npm run build
npm start
```

打开 http://127.0.0.1:4100。首页为访客视图；在 `/admin/login` 输入
`DASH_ADMIN_KEY`，或首次启动生成的 `data/private/admin-token`，进入管理界面。
初始房间是公开示例，服务地址和库存数据仅用于演示。
设备与服务为精选示例，连线只展示应用依赖与管理关系，不包含个人网络访问路径。
已有安装保留自己的持久化数据，更新源码不会自动覆盖。

## 物品与 Agent

可以录入文字、照片或 GLB 模型。照片生成 3D 使用 Lux3D，密钥配置见
[.env.example](.env.example)。调用生成服务会消耗额度；内置离线演示使用固定示例模型。

Agent 可通过 `npm run home -- state`、HTTP API 或 `/mcp` 访问。
接口与鉴权见 [Agent API](docs/agent-api.md)，生成任务与恢复方式见
[Lux3D 接入](docs/lux3d.md)，视图说明见 [使用说明](docs/world-views.md)。

## Docker

```bash
umask 077
cp .env.example .env.local
# 按实际域名设置 DASH_ALLOWED_HOSTS、DASH_PUBLIC_ORIGINS 和 DASH_ADMIN_KEY
docker compose up -d --build
```

端口为 `4100`。`data/` 和 `public/generated/` 通过主机目录持久保存。
密钥、照片、运行状态和任务记录应留在本地。

## 检查与公开版本

```bash
npx playwright install chromium
npm run check
```

检查使用隔离的临时数据，不调用付费生成服务。

公开版本按 `scripts/public-files.json` 的文件清单生成。先提交源码改动，再运行：

```bash
npm run public:prepare
git diff public-clean~1 public-clean --stat
# 检查并验证公开分支后再推送
git push https://github.com/aaaAlexanderaaa/sameroom.git public-clean:main
```

生成命令只更新本地 `public-clean`。私人开发历史、未列入清单的文件和本地配置不进入该分支。
公开初始数据的 SHA-256 固定在文件清单中；修改后须人工复核并更新摘要，才可再次导出。

## 许可

[AGPL-3.0-only](LICENSE)。
