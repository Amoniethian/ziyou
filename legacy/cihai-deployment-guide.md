# 词海 · 独立部署与跨设备同步指南

把 `index.html` 部署到任意静态网站托管，配上自己的 Google OAuth Client ID，从此任何设备（电脑、手机、平板）打开同一个 URL 就能用，进度通过 Google Drive 自动同步。

整个流程大约二十分钟，分四步：申请 OAuth Client ID → 部署 HTML → 在词海里填 Client ID → 登录 Google。

---

## 第一步：在 Google Cloud Console 申请 OAuth Client ID

这一步是为了让词海能"代表你"读写你 Drive 里的文件。

1. 浏览器打开 [console.cloud.google.com](https://console.cloud.google.com)，用你想用的 Google 账号登录。

2. 顶部点击项目选择器（"Select a project"）→ "New Project"。
   - **项目名**：随便，例如 `Cihai`
   - **位置**：保持默认
   - 点 **Create**，等几秒。

3. 创建好后顶部选回这个项目。

4. 左侧菜单 → **APIs & Services → Library**。搜索 `Google Drive API`，点进去，点 **Enable**。

5. 左侧菜单 → **APIs & Services → OAuth consent screen**。
   - **User type**：选 **External**，点 Create。
   - **App information**：
     - App name: `词海`（或任意）
     - User support email: 你自己
     - Developer contact: 你自己
     - 其他留空，点 **Save and Continue**。
   - **Scopes** 页直接 **Save and Continue**（我们用的 `drive.file` 是受限范围但不需要在这里手动加；后续登录时会动态请求）。
   - **Test users** 页 → 点 **+ Add Users**，把你要用词海的 Google 账号都加进去（最多 100 个；自己就一个就行）→ **Save and Continue**。
   - **Summary** 页 → **Back to Dashboard**。

   > 你的 app 现在处于"测试模式"，对自己使用没有限制；只是别人不能登录。日后若想给朋友用，需要走"Verification"流程，但个人使用永远停在测试模式也没问题。

6. 左侧菜单 → **APIs & Services → Credentials → + Create Credentials → OAuth client ID**。
   - **Application type**：**Web application**
   - **Name**：`Cihai Web`
   - **Authorized JavaScript origins** → 点 **+ Add URI**，填你部署的网址前缀（**不要带末尾斜杠**）。如果还没部署，先填一个临时的，部署完成后再回来改。常见情况：
     - GitHub Pages：`https://你的用户名.github.io`
     - 自定义域名：`https://cihai.example.com`
     - 本地测试：`http://localhost:8000`
   - **Authorized redirect URIs**：本方案使用 implicit token flow，不需要，**留空**。
   - 点 **Create**。

7. 弹窗显示 **Client ID** 和 **Client Secret**：复制 **Client ID**（一串以 `.apps.googleusercontent.com` 结尾的字符）保存好。Secret 不需要，可以忽略。

---

## 第二步：部署 HTML 到静态网站

推荐 GitHub Pages（免费、稳定）。如果不熟悉 Git，**Netlify Drop** 或 **Cloudflare Pages** 提供拖放上传，更简单。

### 方案 A：GitHub Pages

1. 注册 [github.com](https://github.com) 账号。
2. 右上角 **+ → New repository**。
   - Repository name: `cihai`（任意）
   - 选 **Public**（Private 也可以，但 Pages 需要付费 Pro 套餐）
   - 勾上 **Add a README**
   - **Create repository**
3. 在仓库页面 → **Add file → Upload files** → 把 `index.html` 拖进去 → 滚到底 **Commit changes**。
4. 顶部 **Settings → Pages**。
   - **Source**: Deploy from a branch
   - **Branch**: `main` / `(root)`
   - **Save**
5. 等一两分钟，刷新这个 Pages 页面，会看到 URL：`https://你的用户名.github.io/cihai/`
6. **回到第一步第 6 项**，把这个 URL（去掉末尾 `/cihai/`，只保留 `https://你的用户名.github.io`）补到 Authorized JavaScript origins。

### 方案 B：Netlify Drop（最快，零账号也行）

1. 打开 [app.netlify.com/drop](https://app.netlify.com/drop)。
2. 把 `index.html` 拖到页面上。
3. 几秒钟后得到一个 URL，例如 `https://random-name.netlify.app`。
4. 回到 Google Cloud Console，把这个 URL 加进 Authorized JavaScript origins。

> Netlify 给的随机 URL 想换成有意义的名字，注册账号后可以改 site name。

### 方案 C：Cloudflare Pages（速度好）

类似 Netlify，到 [pages.cloudflare.com](https://pages.cloudflare.com) 直接拖放。

---

## 第三步：在词海里填 Client ID 并登录

1. 在浏览器打开你的部署 URL。
2. 词海打开后，左侧栏点 **词库** 标签 → 滚到底部 **数据 · 云端与本地** 区。
3. 看到"独立浏览器模式"小标签，下方有 Client ID 输入框。把第一步的 Client ID 整段粘进去 → 点 **保存**。
4. 出现 **登录 Google Drive** 按钮 → 点击 → 弹出 Google 授权窗口 → 选你的账号 → "未经验证的应用"警告点 **Advanced → Go to 词海 (unsafe)**（这只是因为你的 app 没走过 verification，对你自己安全） → 允许访问 Drive 文件。
5. 状态指示牌变绿，写"已登录"——词海会自动检查 Drive 里是否已有 `Cihai/cihai-state.json`；如果有就提示是否覆盖本地。

之后任何状态变化都会自动写到 Drive，换设备打开同一个 URL，重复第 3-4 步（不同浏览器需要重新登录一次 Google，OAuth 是浏览器级的），词海就会自动拉云端最新。

---

## 平时使用

打开 URL → 已登录的话词海自动同步；未登录的话点左上角"同步"指示牌即可触发登录。

**iPhone / Safari** 上把 URL 加入主屏幕（分享 → 添加到主屏幕），点击图标就和 app 一样全屏打开，每次进入自动续登录态（Safari 会保持 session）。

**Android Chrome** 类似：菜单 → "添加到主屏幕"。

---

## 常见问题

**Q: 登录后弹"应用未经验证"的警告。**
A: 正常。只要你的 Google 账号在测试用户列表里（第一步第 5 项），点 Advanced → Go to ... 即可。这是 Google 对未走 verification 的 OAuth app 的标准提示。

**Q: 切换设备时云端没拉到最新版。**
A: 可能是上一台设备的同步还没完成就关掉了浏览器。每次离开词海前看左上角是否变成绿色"已同步 HH:MM"，确认后再走。或者切换前手动点同步指示牌一次。

**Q: Drive 里 Cihai 文件夹塞满了 cihai-state.json。**
A: Drive API 不允许覆盖，所以每次保存都是新文件。这其实是免费的版本备份。觉得太多了到 Drive 网页端按修改时间排序，批量删掉最旧的一批即可（词海每次只读最新一份）。

**Q: 重新部署后旧 URL 还是可用，但新功能没生效。**
A: 浏览器缓存。强制刷新（Ctrl+Shift+R / Cmd+Shift+R）或在 URL 末尾加 `?v=2`。

**Q: Client ID 想换怎么办？**
A: 数据页里点 "改 Client ID" 直接重新粘贴。原有的 Drive 文件不会丢，新 Client ID 登录后还能读到。

**Q: 不小心暴露了 Client ID 给别人怎么办？**
A: Client ID 本身不是机密——任何人都看得到（因为它就嵌在前端代码里）。它只是告诉 Google "这个 app 叫什么"。真正阻止滥用的是 Authorized JavaScript origins——只有从你部署的 URL 加载的页面才能用这个 Client ID，别人没法滥用。所以即使别人看到也不要紧。

**Q: 想给朋友用怎么办？**
A: 选项一：把朋友的 Google 邮箱加到测试用户列表（第一步第 5 项）。每人最多 100 个测试用户。选项二：走 Google 的 OAuth verification，让 app 转为生产模式——但因为我们用了 `drive.file` 这个非敏感范围，verification 很快，不需要安全审计。

---

## 故障排查

如果点登录后什么都没发生，按 F12 打开浏览器控制台看错误信息。最常见的是：

- `idpiframe_initialization_failed` / `invalid_request` → Authorized JavaScript origins 没设对。确认 Google Cloud Console 里的 origin 与你浏览器地址栏里的协议+域名完全一致（含 `https://`、不含路径、不含末尾斜杠）。
- `Drive search HTTP 403` → Drive API 没启用。回 Google Cloud Console → APIs & Services → Library 检查。
- `Cihai/cihai-state.json` 一直拉不到 → 看 Drive 网页端 Cihai 文件夹里到底有没有文件。如果连文件夹都没有，可能是权限范围不对——重登录一次，确认勾选了"查看、编辑、创建和删除你用本应用打开或创建的特定 Google Drive 文件"那一项。

---

部署完成后，把 URL 告诉我，我可以帮你确认是否正常运行（在任意能开浏览器的设备上测一遍）。
