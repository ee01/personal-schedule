# E-184 扩展安装入口 — 发布对齐与配置 Runbook

状态：**等待兼容发布物**。官方条目（[Personal AI Chrome Web Store](https://chromewebstore.google.com/detail/personal-ai/kefnadjndpllbibeklhajjddgmlbafel)，ID `kefnadjndpllbibeklhajjddgmlbafel`）当前签名包为 **11.1.0**，不含 Schedule 能力（无 `contentScriptSchedule.js`、无 Schedule 域名 content_scripts、后台无 `PERSONAL_SCHEDULE_BRIDGE` 处理器）。兼容提交为 Personal AI `eadc9667`（候选版本 12.2.0）。

## 剩余依赖（非 Schedule 侧）

1. 扩展发布负责人把包含 `eadc9667` 的构建发布到上述既有官方条目。商店存在审核/生效延迟，页面 HTTP 200 不代表新包已生效。
2. 发布后以本仓库脚本核验实际签名 CRX（不是源码、不是本地 dist）。

## 发布落地后的操作（按序执行，缺一不可）

```bash
# 1) 核验官方 CRX 能力（版本、Schedule 内容脚本 + 域名匹配、后台桥）
node deploy/verify-ext-crx.mjs
#    可用环境变量：EXPECT_MIN（默认 12.2.0）、REQUIRED_HOSTS（默认
#    schedule.xmnup.com,localhost,127.0.0.1）、EXT_ID。
#    全部 PASS 才继续；任何 FAIL 保持 SCHEDULE_EXT_INSTALL_URL 不设置。

# 2) 写入部署配置（服务器 service.env，600 权限）
ssh rcadmin@10.32.56.212
cat >> ~/personal-schedule/service.env <<'EOF'
export SCHEDULE_EXT_INSTALL_URL=https://chromewebstore.google.com/detail/personal-ai/kefnadjndpllbibeklhajjddgmlbafel
export SCHEDULE_EXT_MIN_VERSION=<verify-ext-crx 输出的实际版本>
EOF
#    service.env 由 run-service.sh 自动 source；launchd 重启后生效。

# 3) 重启服务并确认入口已配置
./deploy/deploy.sh app   # 或服务器上 launchctl kickstart
curl -s http://schedule.xmnup.com/api/v1/extension/info
#    期望：extInstallUrl = 商店地址，minExtensionVersion = 已验证版本，
#    handshake（personal-schedule-extension-v1 / ready / schemaVersion 1）不变。

# 4) 同一部署指纹上复验公开安装链（真实商店安装，非 loadUnpacked）：
#    公开安装 → 返回已打开的分享页 → 真实 Options 连接单设备账号 →
#    勾选恢复（含空选择）→ 确认导入 → 双击/重放不重复建。
#    参考 Sol 的 tools/verify-schedule-install-resume.mjs（Personal AI 仓库），
#    该脚本的 14 项内部证据可复用，但需补充「从商店安装」这一步。
```

## 边界

- 在 CRX 核验通过之前，**不得**把商店链接填进线上 `extInstallUrl`——用户会装到 11.1.0 并在分享页看到无效的安装入口。
- `SCHEDULE_EXT_MIN_VERSION` 收敛为首个实际可分发且已验证的兼容版本（`deploy/verify-ext-crx.mjs` 输出），而不是 `0.1.0`。
- 本 runbook 只涉及安装入口配置；HTTPS 邮箱绑定（登录桥）与真实邮件发送仍按原计划单列。
