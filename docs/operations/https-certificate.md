# schedule.xmnup.com 受信 HTTPS 证书方案（待凭据，已备好执行路径）

## 现状（2026-11-06 核验）
- `schedule.xmnup.com` 在公网 DNS（阿里云/hichina NS）解析到**内网地址 10.32.56.212**。
- 本机 NPM 的 schedule 代理主机当前服务的是**自签名证书**（CN=schedule.xmnup.com，非受信）。
- 全机核查：`*.xmnup.com` 各站点均无受信证书（task.xmnup.com 亦自签名；memory/iva 等无 443 主机）。
- 服务器上已存在的受信证书仅限 `*.int.rclabenv.com` 通配符（DigiCert/Thawte 链，公司管理，密钥不在本机，DNS 亦无通配解析）。

## 为什么 HTTP-01/TLS-ALPN 不可行
Let's Encrypt 校验服务器从公网访问域名，而公网 DNS 指向内网 IP，校验必然失败。**不能用跳过证书校验替代。**

## 两条可行路径（二选一）

### 路径 A（推荐）：DNS-01 + 阿里云 DNS API（保持现有域名）
1. **需要的凭据（缺口）**：xmnup.com 所在阿里云 DNS 账号的 AccessKey（具备为 `xmnup.com` 写 `_acme-challenge` TXT 记录的权限）。由 E 在阿里云控制台创建、以安全方式交给部署（服务器文件，不入仓库/评论）。
2. **执行**：`deploy/issue-cert.sh`（acme.sh DNS-01，键值写入 `~/.acme.sh/account.conf` 权限 600）→ 生成受信证书 → 自动导入 NPM（custom certificate，绑定 schedule 代理主机）。
3. **续期**：acme.sh cron 每 60 天自动续期并重导 NPM（脚本含 NPM API 重上传钩子）。
- 备选：若不想提供长期 AccessKey，可用阿里云"RAM 临时凭证"每 90 天手动续期一次（同样脚本，传入 STS token）。

### 路径 B：公司 `int.rclabenv.com` 域（零证书成本，但需公司流程）
给本机申请一个 `*.int.rclabenv.com` 域名下的 DNS 记录（或公司证书签发流程），即可直接使用公司通配受信证书。DNS/证书均走公司流程，超出本部署权限。

## 已就绪（无需等待）
- `deploy/issue-cert.sh`：DNS-01 签发 + NPM 导入 + 续期钩子；`ALIYUN_ACCESS_KEY_ID/SECRET` 环境变量传入即执行。
- NPM 代理主机已有回退能力：自签名证书保留为 fallback，导入受信证书前站点照常 HTTP/HTTPS(自签) 可用；其他站点不受影响。
