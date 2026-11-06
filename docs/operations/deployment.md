# 部署与运维（Personal Schedule Service）

更新日期：2026-11-06（E-183 首次部署）

## 部署拓扑

| 项 | 值 |
|---|---|
| 入口 | http://schedule.xmnup.com/（DNS 已确认解析 → 10.32.56.212） |
| 主机 | `rcadmin@10.32.56.212`（macOS, OrbStack + Docker, node v23.11.0 `/usr/local/bin/node`） |
| 应用 | Node ≥ 23.4，**零 npm 依赖**（node:sqlite/node:http/node:crypto），rsync 即部署，无需 install/build |
| 监听 | `0.0.0.0:3230`（preflight 已确认空闲；服务实际只应经 NPM 访问） |
| 进程管理 | launchd：`com.personal-schedule.service`（`~/Library/LaunchAgents/com.personal-schedule.service.plist`，KeepAlive） |
| 数据 | `/Users/rcadmin/personal-schedule/data/schedule.db`（SQLite WAL）+ 同目录内 `settings`（timeline 源等） |
| 日志 | `~/personal-schedule/schedule.log` / `schedule.err.log` |
| 反向代理 | **Nginx Proxy Manager**（docker 容器 `nginxproxymanager-app-1`，占用宿主 80/81/443）。**容器访问不到宿主 loopback**，upstream 必须写 `10.32.56.212:3230`（与其他 12 个站点一致） |
| NPM 数据 | `~/nginxproxymanager/data/database.sqlite` + `data/nginx/proxy_host/<id>.conf`（nginx 实际加载的是 conf 文件；DB 行保持管理界面一致） |

## 部署/升级（可重复执行）

```bash
./deploy/deploy.sh preflight   # 检查 node/端口/NPM 现状/launchd/DNS
./deploy/deploy.sh app         # rsync service → ~/personal-schedule/current + launchd 重启
./deploy/deploy.sh nginx       # NPM 加 proxy host（幂等，已存在则复用 id）+ nginx -t + reload
./deploy/deploy.sh verify      # 127.0.0.1:3230 与 http://schedule.xmnup.com/api/v1/health
./deploy/deploy.sh all
```

安全规则：改 NPM 前自动备份 `database.sqlite.bak-<ts>` 与 `proxy_host/<id>.conf.bak-<ts>`；`nginx -t` 失败自动回滚本次 conf；只新增/修改 `schedule.xmnup.com` 自己的行，不动其他站点。

## 服务管理命令（在服务器上）

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.personal-schedule.service.plist  # 启动
launchctl bootout gui/$(id -u)/com.personal-schedule.service                                 # 停止
launchctl kickstart -k gui/$(id -u)/com.personal-schedule.service                            # 重启
tail -f ~/personal-schedule/schedule.log ~/personal-schedule/schedule.err.log               # 日志
curl -s http://127.0.0.1:3230/api/v1/health                                                   # 健康检查
```

## 用户与 Token（CLI）

```bash
cd ~/personal-schedule/current
node src/cli.js user add <email> [name]
node src/cli.js token create <email> [label]   # 输出 pst_ token，只显示一次
node src/cli.js token list <email>
node src/cli.js token revoke <pst_...>
```

Token 即个人身份（Web 登录 / 扩展 Bearer / API），服务端只存哈希。**凭证不入仓库与文档**；用户级连接（RC JWT、Bot secret、memory user key、Multica binding）经 Web 设置页加密存于服务端 SQLite（回显打码）。

## 回退

1. 应用：`cp -a ~/personal-schedule/releases/<ts> ~/personal-schedule/current && launchctl kickstart -k gui/$(id -u)/com.personal-schedule.service`
2. NPM：`cp ~/nginxproxymanager/data/database.sqlite.bak-<ts> ~/nginxproxymanager/data/database.sqlite`；`mv ~/nginxproxymanager/data/nginx/proxy_host/<id>.conf.bak-<ts> .../<id>.conf`；`docker exec nginxproxymanager-app-1 nginx -t && docker exec nginxproxymanager-app-1 nginx -s reload`
3. 完全下线：`launchctl bootout …` + 删除 `proxy_host/<id>.conf` + reload（DB 行可留档）。

## 内网依赖（部署预检结论）

- memory-service：`10.32.56.212:3210`（容器 `personal-ai-memory-service`，`/health` 可达——注意当前其自报 `status: degraded`、database connected:false，联调前需先恢复，属 E-184/服务侧范围）。
- NPM 容器 → 宿主端口：用 `10.32.56.212:<port>`，不要用 127.0.0.1。
- Multica Autopilot webhook / OpenClaw / RC API / Release Info：随首次真实触发与 Stage 4 验收逐项核验（契约文档 §6 V3–V5）。

## DNS 说明

`schedule.xmnup.com` 已由 DNS 解析至 `10.32.56.212`（`dig +short` 验证）。本次部署**未修改任何 DNS 记录**——不需要；NPM 代理主机配置即完成入口。
