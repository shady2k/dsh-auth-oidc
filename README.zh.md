---
description: "非官方独立 DSH authentik OIDC 浏览器登录插件，显式授予完整所有者权限。"
kind: "package-reference"
---

# dsh-auth-oidc

[English](<README.md>) | 中文

## 概述

用于 authentik 原生 OpenID Connect 浏览器登录的**非官方实验性 DSH 插件**，由 [shady2k](https://github.com/shady2k/dsh-auth-oidc) 维护。需要下述独立 Connection 浏览器认证扩展；**不支持未经修改的 DSH `0.2.2-rc.1`**。通过 DSH GUI 配置 authentik 和所有者准入，无需在设备间复制启动 token URL。

获准的身份拥有共享 DSH 所有者的全部权限，包括文件、命令、凭据和配置。**这不是多用户隔离。**准入是附加的：启动 token URL、内置浏览器 cookie 和 API 操作者凭据仍可使用。启用 OIDC 并不要求每个连接都通过 authentik。

## 目录

- [兼容性前提](#兼容性前提)
- [本地构建与安装](#本地构建与安装)
- [配置 authentik](#配置-authentik)
- [配置 DSH](#配置-dsh)
- [配置参考](#配置参考)
- [会话行为](#会话行为)
- [开发](#开发)
- [模型体验](#模型体验)
- [已知限制](#已知限制)

## 兼容性前提

集成目标为官方 DSH **`0.2.2-rc.1`**，配合提供 `connection.browserAuth.register` 的临时、提供者无关 Connection 分支 **`0.2.2-rc.1+browser-auth.1`**。未修改的已发布 Connection 不提供该 API。本插件不会替换 DSH，也不嵌入认证代理。

此包声明 `engines.dsh: 0.2.2-rc.1`。这一安装／激活版本门槛是必要条件，**不是充分条件**：激活还会在解析凭据、执行发现或注册路由前检查 `connection.browserAuth.register`。安装此 bundle 无法升级 Connection。不要通过绕过版本门槛来尝试支持不兼容的 Host。集成使用匹配的 Cordis **`4.1.0`** 与 rc1 服务包；参阅[开发策略](<docs/development.md>)。仓库包含[精确的 Connection 补丁与部署前提](https://github.com/shady2k/dsh-auth-oidc/tree/main/compat)。这是需要维护者协助的实验性安装，不是用于原版 DSH 的一键插件。

## 本地构建与安装

在本独立包目录中使用 Node.js `>=24.9.0` 和 pnpm：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm pack
```

独立构建不需要相邻 checkout。打包会运行包的 prepack 构建及运行时／包检查，生成 `dsh-auth-oidc-0.1.4.tgz`，但不会发布它。也可在已有 [GitHub release](https://github.com/shady2k/dsh-auth-oidc/releases) 时下载其中的插件归档。不要假定已有 npm 发布。

通过 **DSH 插件管理器**的 `install_bundle` 操作安装该归档，使用绝对本地路径。例如，请 DSH agent 使用以下参数调用其 `plugin_manager` 工具：

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/dsh-auth-oidc/dsh-auth-oidc-0.1.4.tgz"
}
```

这是工具调用，不是 shell 命令。遵循管理器的正常审批流程，并检查返回结果／后续步骤。不要通过 shell 包管理器命令手动修改 profile 的依赖清单、锁文件或解析器。安装会影响所选 DSH profile，而多个会话可能共享该 profile。

bundle 的[安装补丁](<cordis.patch.yml>)插入始终运行的设置插件，OIDC 登录默认停用：

```yaml
- insert:
    - id: auth-oidc-settings
      name: dsh-auth-oidc
      config:
        enabled: false
```

浏览器设置页面将连接、所有者准入和高级设置分组，并提供紧凑的**配置 authentik**参考；每个可用值均有**复制**操作，包括根据尚未保存的 **DSH 公共 URL** 计算的精确 Strict 重定向 URI。仅在浏览器接受复制后确认成功；剪贴板失败时保留可见值供手动复制。公共 URL 为空时，根据当前 HTTPS 应用基础地址（含挂载路径）预填，不覆盖已有值，也不保存。提供方凭据和所有者身份仍由用户填写；密钥不会出现在表格中。安装和预填均不会启用登录。

## 配置 authentik

在 authentik 中创建 OAuth2/OpenID provider 和应用。使用机密客户端、授权码流程和签名密钥。复制 provider 的**精确 issuer 标识符**、客户端 ID 和客户端密钥。DSH 基础 URL 为 `https://dsh.example/ui/` 时，注册精确重定向 URI `https://dsh.example/ui/auth/oidc/callback`；不要使用通配符。插件使用 PKCE S256、query 模式回调以及 `client_secret_basic` token 认证。

简单的单所有者配置可使用专用 authentik 组：

1. 在 **Directory → Groups** 创建 `dsh-owners`，无需超级用户权限或 authentik 管理角色。
2. **将实际用于登录的用户加入该组。**仅创建组不会添加成员。请使用直接成员关系，不要依赖父组继承。
3. 在 DSH OAuth2/OIDC provider 的 scope mappings 中选择 **authentik default OAuth Mapping: OpenID 'profile'**，并启用 **Include claims in id_token**。默认 profile 映射在 `groups` 中提供组名；仅在 UserInfo 中提供的声明不符合要求。
4. 在插件中将**允许的主体**留空，**允许的组**设为 `dsh-owners`，**组声明**设为 `groups`，**作用域**设为 `openid, profile`。仅添加应能控制整个 DSH 实例的人员。

也可通过**允许的主体**允许 issuer 内精确的 `sub` 值，或为组准入配置其他**已签名 ID token 数组声明**。主体和组名单使用 OR 而非 AND：任一匹配均授予所有者权限。自定义映射可能需要请求额外作用域。

有关 provider 创建和映射，请参阅 [authentik OAuth2/OpenID provider 文档](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/)。

## 配置 DSH

安装兼容版本及 bundle 后，刷新现有 GUI，使用原有所有者会话打开 **插件 → Authentik / OIDC**。测试期间保留可用的原生所有者会话。配置 OIDC 无需编辑 YAML、重启或在聊天中分享凭据。

1. 保持**启用 OIDC 登录**关闭。核对预填的 **DSH 公共 URL**，包括挂载路径和末尾斜杠，并填写**签发者 URL**与**客户端 ID**。若未预填 HTTPS 地址，请手动输入，例如 `https://dsh.example/ui/`。使用参考值行中的**复制**按钮传递提供方设置。
2. 在**允许的主体**或**允许的组**中填写逗号分隔的精确所有者身份。至少一个准入名单不能为空。按 authentik ID token 映射调整**组声明**和**作用域**。启用草稿缺少必要配置时无法保存，内联消息会指出问题。通过其他途径已保存的无效配置会阻止登录运行，并报告固定原因，不暴露凭据或上游响应。
3. 保留默认**客户端密钥引用**，或指定有效的凭据引用名称。仅在**客户端密钥**中输入密钥原文，然后选择**保存**。页面通过 DSH 凭据存储密钥，在 profile 设置中仅保存其引用。密钥字段留空会保留已存值。输入密钥需要 credentials-local 等可写凭据提供者。
4. 确认密钥已配置，打开**启用 OIDC 登录**并再次**保存**。等待**运行状态：OIDC 登录正在运行**。保存设置本身不代表激活成功；等待、失败或不可用状态均保持可见，设置插件仍可编辑。

凭据和设置写入不是原子操作。若密钥保存成功但设置失败，密钥仍会保留；修复配置或存储问题后重试。不要把密钥写入 profile YAML 或发给 agent。

应用现有的公告 URL 和 Connection 信任配置必须已与 **DSH 公共 URL**一致。OIDC 设置不会添加受信任的 Host。URL、转发的 Host 和受信任的 authority 应一致保留非默认端口。安装或切换底层 DSH 版本可能需要另行商定重启；编辑这些 volatile OIDC 设置不需要重启。

在浏览器无痕窗口中打开普通应用 URL 进行测试。未经认证的 index 请求会重定向到 authentik，再携带本地浏览器 cookie 返回 DSH。此流程不需要启动 token。DSH Host 必须能够访问 provider，以执行发现、token 交换和签名密钥获取；浏览器必须能够访问 authentik 和公开应用 URL。

若回调显示 **“This identity is not permitted to own this DSH instance.”**，表示 token 验证已完成，但两个准入名单均未匹配。请检查实际登录用户、`dsh-owners` 的直接成员关系、大小写完全一致的组名、profile scope 映射以及 ID token 中是否包含声明。修改后重新打开普通应用 URL 发起新登录；不要刷新或分享回调 URL。切勿在 issue 或聊天中粘贴 token、授权码或客户端密钥。

两个配置 URL 均要求 HTTPS。发现元数据中的 issuer 必须与配置的 `issuer` **精确相等**，包括结尾斜杠；应使用 issuer 标识符，而非发现文档 URL。外部应用 URL、回调、cookie 路径和 Host 比较只取自 `publicUrl`，绝不以转发的身份、主机或协议头为准。

对于 `/ui/` 示例，反向代理必须保留外部 `Host`，在转发给 DSH 前剥离 `/ui/`，并转发 WebSocket 升级。将上游监听器限制在可信代理／网络内。即使上游监听器使用 HTTP，OIDC cookie 也已包含 `Secure` 和外部 `Path=/ui/`；**不要对 OIDC cookie 应用内置 cookie 路径改写**。现有 DSH 内置 cookie 有独立的监听器／代理要求，可能需要单独处理 Secure／路径。不要混淆两类 cookie，也不要削弱 Connection 的 Host／Origin／Fetch-Metadata 检查。

## 配置参考

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 设置插件保持运行；配置完成后才启用独立登录运行插件 |
| `issuer` | 空；启用时必填 | 精确 HTTPS issuer 标识符，而非发现文档 URL |
| `publicUrl` | 必填 | 外部 HTTPS 应用基础 URL，包含规范的结尾斜杠；不含凭据、查询或片段 |
| `clientId` | 空；启用时必填 | 机密客户端标识符 |
| `clientSecretRef` | `DSH_OIDC_CLIENT_SECRET` | 凭据服务引用，绝非密钥原文 |
| `allowedSubjects`, `allowedGroups` | `[]`, `[]` | 精确的完整所有者准入列表；至少一个非空；任一匹配即获准 |
| `groupsClaim` | `groups` | 包含组名的已签名 ID token 数组声明 |
| `scopes` | `[openid, profile]` | 请求的 scope；必须包含 `openid` |
| `loginMaxAgeSeconds` | `300` | 单次使用事务有效期，1–600 秒 |
| `sessionMaxAgeSeconds` | `28800` | 绝对会话有效期，同时受 ID token 过期时间限制 |
| `maxPendingLogins`, `maxSessions` | `256`, `1024` | 保留的事务／会话数上限；容量耗尽时返回 503 |
| `requestTimeoutSeconds` | `15` | 发现／token／签名密钥请求截止时间，1–120 秒 |

能力或凭据缺失、配置无效或发现失败会阻止插件激活。回调协议或 provider 故障返回固定的 502，不暴露 token、声明、授权码或上游响应正文。事务无效／过期时返回 400，准入列表之外的身份收到 403，凭据暂不可用或容量耗尽时返回 503。出错后重新打开普通应用 URL，即可开始新事务。

## 会话行为

事务通过随机的 HttpOnly、Secure、SameSite=Lax cookie 绑定 state、nonce 和 PKCE，并在 token 交换前消费。会话 cookie 为不透明值，具有 HttpOnly、Secure、SameSite=Strict 属性，仅限当前主机（无 Domain），路径限定到配置的外部挂载。Host 仅在内存中保存哈希后的会话标识符和绝对过期时间。每次 token 交换都会重新解析凭据。

成功回调会返回一个位于应用 origin 的最小 **HTML 200 文档**，随后导航到配置的应用基础 URL。提交该文档会结束跨站 IdP 重定向链，使下一次同源请求能够发送 Strict cookie 并通过 Fetch-Metadata 检查。不要将它改成 HTTP 重定向、放宽 SameSite 或让所有应用请求免于信任检查。

向应用基础 URL 下的 `auth/oidc/logout` 发起同源 `POST`，可撤销该 OIDC 浏览器会话并清除其 cookie；请求必须包含精确匹配的 `Origin` 头。没有退出按钮。例如，可在 DSH origin 的浏览器控制台中运行：

```js
await fetch(new URL('auth/oidc/logout', document.baseURI), { method: 'POST' })
```

**关闭现有 DSH 标签页以断开活动 socket。**退出不会撤销内置 cookie、API 凭据或 authentik 登录；再次访问 DSH 时，可能通过 authentik SSO 立即登录。

## 开发

参阅[开发策略与验证](<docs/development.md>)和[独立包安全依据](<docs/decision-original.md>)。插件拥有 OIDC 协议处理，并注册一个调用方作用域的通用 Connection 浏览器认证提供者。Connection 保留信任检查和内置 token 优先级；WebServer 仅承载精确的原始路由。dispose 会中止上游 fetch、清除保留状态、移除注册，并等待活动路由操作完成。

认证运行插件使用 schemastery、openid-client 和 DSH 凭据；设置插件增加 Cordis 生命周期及 Typert Remote 状态。独立构建的 Client 复用 DSH 设置原语、类型化语言字典、slots、store 和 Remote API。共享的 Host／Client 服务为平台提供的 peer，而非嵌入替代品；仅 Host 使用的 OIDC 依赖不会进入浏览器 bundle。

## 模型体验

无：浏览器认证不贡献工具、提示词或模型 token，也不改变模型请求或 KV-cache 行为。

## 已知限制

- 重启或插件 dispose（资源释放）会清除会话和待处理登录。不提供共享会话存储、refresh token 续期、UserInfo 授权、IdP 发起／后通道退出或逐请求组校验。
- 保存已改变的部署设置或轮换选定凭据会重启 OIDC 子插件并清除其会话。仅在 authentik 修改的设置只影响新登录，不会在过期／重启前影响现有会话。已获准的 socket 在过期、退出或插件 dispose 后仍保持连接。如需立即撤销，请缩短会话时限并断开 socket／重启 Host。
- 认证授予共享的完整所有者权限，不提供逐用户账号、文件系统权限、命令沙箱或租户隔离。其他 DSH 凭据保持启用时，OIDC 并非排他性强制认证。
- 未修改的已发布 rc1 Connection 不兼容；所需的通用 Host 能力必须另行提供。此 bundle 不会为 DSH 打补丁、配置 authentik 或配置代理。包测试不等于安全审计，也不能证明支持其他 DSH 版本。
