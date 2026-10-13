# 转个开始 · 今日任务转盘

把选择交给转盘，把今天交给行动。支持账号与邀请码、跨设备同步、长期任务、纯随机抽取、服务器计时、每日目标、月度年度统计和管理员后台。

## 使用规则

- 每天从长期任务库手动选择，支持全选。勾选先保存在本地，点击「完成」一次保存并更新转盘与今日清单；取消不保存。每项任务当天只能完成一次，完成不会删除长期模板。
- 每个未完成任务等概率抽中。抽中立即计时，暂停也保持锁定，完成后才能抽下一项。
- 刷新、关闭网页、手机锁屏后继续计时。连续计时默认120分钟后自动暂停，可设置15～240分钟；继续时创建新的计时段。
- 按北京时间零点换日，计时准确截断在零点，昨日任务保存为未完成并解除锁定。可手动带入今日。
- 目标次日生效，留空表示不设目标。设置两个目标时必须同时达到；至少完成一项计为活跃一天。
- 任务归档不删除历史；修改模板不改历史名称。计时与汇总来自服务器记录。

## 技术结构

React / Vite / TypeScript，Fastify，PostgreSQL 17，Prisma，Node.js 24，Docker Compose / Caddy。生产数据库不发布端口。

`src/` 是前端，`server/` 是接口与业务规则，`prisma/` 是数据库结构和迁移，`tests/` 是真实数据库测试与浏览器测试。

## 本机完整部署

需要运行中的 Docker Desktop 或 Docker Engine。所有命令在项目目录执行。

1. 复制 `.env.example` 为 `.env`。把 `POSTGRES_PASSWORD` 改成随机的**十六进制**密码，并同步修改 `DATABASE_URL` 中的密码。为只允许本机访问，添加 `HTTP_BIND=127.0.0.1`。
2. 运行 `docker compose up -d --build`。迁移成功后应用才启动。
3. 运行 `docker compose exec app node dist/server/admin.js`，按提示创建首个管理员。密码至少12位，无内置默认密码。初始化不会覆盖已有管理员。
4. 打开 [http://localhost:8080](http://localhost:8080)。登录管理员，在管理空间生成邀请码，再注册普通用户。

本机配置使用 `NODE_ENV=development`、HTTP 和非 Secure Cookie；这只适用于本机验证。部署外网时必须使用下述 HTTPS 配置。

## 本机开发

需要 Node.js 24.11+。本项目也在开发依赖中提供固定的 Node.js 24 二进制，安装后 `npm run` 会自动使用项目内运行时。

```sh
npm ci
docker compose -f compose.yml -f compose.dev.yml up -d db
npm run db:migrate
npm run db:generate
npm run admin:create
npm run dev
```

前端 [http://127.0.0.1:5173](http://127.0.0.1:5173)，API 3000。开发用的 `DATABASE_URL` 使用 `127.0.0.1:5432`；Compose 会为容器自动配置 `db:5432`。

开发附加文件只把数据库端口绑定到127.0.0.1，**不要在服务器使用 `compose.dev.yml`**。本机端口被占用时调整端口与连接串。

## 外网服务器部署

1. 准备 Linux 服务器、Docker Compose 和域名，将域名解析到服务器。允许外网80、443端口。
2. 从公开 GitHub 仓库拉取代码，复制 `.env.production.example` 为 `.env`。
3. 使用随机十六进制数据库密码；设置 `APP_ORIGIN=https://你的域名`、`DOMAIN=你的域名`、`NODE_ENV=production`、HTTP/HTTPS端口80/443。
4. `.env` 权限设为600。只对需要部署的管理员开放 SSH，不对外开放 PostgreSQL。
5. 运行 `docker compose up -d --build`，用初始化命令创建管理员。Caddy 自动签发并续期 HTTPS 证书，Cookie 启用 Secure。
6. 检查 `docker compose ps`，访问 `/api/health` 和网站，完成邀请码注册、抽取、计时与完成验收。

服务器地址、域名、凭证需要由部署者提供，本项目不会包含真实服务器配置或密钥。`APP_ORIGIN` 必须是完整浏览器来源（协议+域名+可选端口，无末尾斜杠）。

## 备份、恢复与升级

```sh
sh scripts/backup.sh
sh scripts/restore.sh backups/turntable-YYYYMMDDTHHMMSSZ.dump --confirm-replace
```

备份使用 PostgreSQL custom 格式，文件权限受 `umask 077` 保护。每次成功备份后清理超过7天的旧备份。建议使用服务器调度器每天执行 `backup.sh`，备份目录保存在受控磁盘，异地副本应加密。脚本不会擅自配置系统调度器。

恢复会替换当前数据库，务必先备份。应用在恢复期间停止，恢复后清除所有登录会话，用户须重新登录。恢复旧备份可能恢复其中被删除的账号；如需恢复旧备份，应先核对并重新执行期间的删除操作。网站永久删除清除在线数据库，旧备份按保留周期过期。

升级流程：先备份并记录当前 Git 提交，再拉取新代码、执行 `docker compose up -d --build`、检查迁移和健康状态。迁移采用新增字段等兼容策略；只回滚代码不回滚数据库。若发生不兼容迁移，恢复升级前备份并检出对应旧提交后重建。不要执行 `docker compose down -v`，该命令会删除数据库卷。

## 测试

测试必须连接名字以 `_test` 结尾的**专用数据库**，会清空该测试库，绝不能使用真实业务库。本机创建 `turntable_test` 数据库，并在 `.env` 添加 `TEST_DATABASE_URL`，连接串格式同 `DATABASE_URL`。

```sh
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" turntable_test'
# 使用测试连接串执行迁移，切勿把真实密码写进提交或聊天。
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

上面的迁移命令要求先将 `TEST_DATABASE_URL` 加载到当前 shell 环境；也可以把测试连接串临时作为环境变量传给命令。CI 自动提供独立测试数据库。

浏览器测试使用内置临时服务器与临时账号，不使用用户的管理员账号。覆盖电脑与手机的注册、任务勾选、抽取、暂停继续、刷新恢复、完成和后台管理。接口测试额外覆盖并发、请求幂等、跨天、上限、目标快照、用户隔离和级联删除。

## API 约定

- `/api/auth/*`：注册、登录、会话读取、退出、密码修改。
- `/api/tasks`：长期任务列表、新增、编辑、归档。
- `/api/today`：今日状态、昨日未完成记录、服务器时间。
- `PUT /api/today/selection`：`{ taskId, selected }`。
- `PUT /api/today/selection/batch`：`{ date, changes: [{ taskId, selected }] }`，事务内批量保存勾选变动，保留其他设备对未修改任务的选择；日期过期或试图移出锁定任务时整批拒绝。
- `POST /api/today/draw`：必须携带 UUID `Idempotency-Key`。重复使用同一标识返回同一次抽取结果，不创建新计时段。
- `POST /api/today/:id/pause|resume|complete`：服务端验证状态，重复完成不会重复统计。
- `/api/settings`：计时上限与次日目标；`/api/stats?year=2026&month=10`：月统计，省略month为全年。
- `/api/admin/*`：邀请码、用户、密码重置、永久删除、操作记录，仅管理员可用。

已登录的修改请求须携带 `/api/auth/me` 返回的 `X-CSRF-Token`，并来自配置的 Origin。令牌不存储在 localStorage。会话有效期7天，密码修改、账号停用、重置与删除使相关登录失效。

## 公开仓库与隐私

`.gitignore` 与 `.dockerignore` 预先排除环境变量文件、数据库、密钥、备份、日志和QA产物。提交前运行 `npm run check:secrets`；它检查跟踪文件和 Git 补丁历史，打印文件名而不打印秘密内容。仍需人工确认没有真实任务内容或凭证。

邀请码原文只在生成时返回，数据库存储哈希；关闭生成窗口前请复制保存。后台删除需要管理员密码和目标用户名；管理员不能删除自己。操作日志只保存操作类别与时间。

页面可见时每5秒同步，重新进入立即同步。关闭页面也持续计时，后台维护与读取时都执行准确的时间截断。断网不能修改，恢复后以服务器状态校准。首版针对单应用实例部署，不包含离线模式、邮件找回密码或外部身份登录。

MIT License.
