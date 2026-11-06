证据与推荐见 docs/e184-auth-readonly-audit.md。

关键发现：storage.local 不同步；现有桥不登录网页；网页登录手工输入/签发 PAT 可接触网页 JS；新增令牌管理不解决首次登录；PAT 撤销不联动旧 Cookie；Memory Google 校验不是 Schedule Web OAuth；HTTP 200、HTTPS 自签名校验失败；无扩展分享导入尚存 secure-context randomUUID 静态风险。
