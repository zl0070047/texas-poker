# 德州扑克春节版 · 在线部署说明

把游戏部署到公网后，任何人用浏览器打开链接即可玩，无需在同一 WiFi。

---

## 中国玩家 / 国内访问说明

- **若主要给国内朋友玩**：建议把游戏部署在**国内服务器**（阿里云、腾讯云等），国内访问更快、更稳定，不易被墙或超时。
- **若部署在海外**（Render、Railway 等）：国内部分地区可能访问较慢或偶发超时；游戏已做**断线重连**和**中文提示**，断线后会提示「请刷新页面并重新加入房间（房间号：XXX）」。
- 下方「方式一、二」为海外免费部署；「方式三」为自建服务器，**含国内云服务器（阿里云/腾讯云）**，推荐国内玩家使用。

---

## 方式一：Render（免费，海外）

[Render](https://render.com) 提供免费 Node 托管，支持 WebSocket，适合小规模联机。

### 第一步：把项目放到 GitHub

1. 打开 [GitHub](https://github.com)，登录后点击右上角 **+** → **New repository**。
2. 仓库名随便起（例如 `texas-poker-spring`），选 **Public**，点 **Create repository**。
3. 在本机打开终端，执行（把 `你的用户名` 和 `texas-poker-spring` 换成你的仓库名）：

```bash
cd "/Users/zhulei/Desktop/AI CODE/德普春节版"
git init
git add .
git commit -m "德州扑克春节版"
git branch -M main
git remote add origin https://github.com/你的用户名/texas-poker-spring.git
git push -u origin main
```

若未装 Git：到 https://git-scm.com 下载安装后再执行上面命令。  
若从未配置过 GitHub：需先在 GitHub 网站 **Settings → SSH and GPG keys** 或用 HTTPS 按提示登录。

### 第二步：在 Render 创建 Web 服务

1. 打开 **https://render.com**，用 GitHub 账号登录。
2. 点击 **Dashboard** → **New** → **Web Service**。
3. **Connect a repository**：选刚才的仓库（如 `texas-poker-spring`），点 **Connect**。
4. 按下面填写：
   - **Name**：随便填（如 `texas-poker`）
   - **Region**：选离你近的（如 Singapore）
   - **Branch**：`main`
   - **Runtime**：`Node`
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Instance Type**：选 **Free**
5. 点 **Create Web Service**，等几分钟部署完成。

### 第三步：获取在线地址

部署成功后，在服务页面会看到类似：

**https://texas-poker-xxxx.onrender.com**

这就是游戏的在线地址。把链接发给好友，对方打开后即可「加入房间」一起玩（房间号由房主在游戏里创建后分享）。

### 免费版说明

- 约 15 分钟无人访问后服务会休眠，下次有人打开链接时可能要等 30 秒～1 分钟才会打开，属正常现象。
- 每月约 750 小时免费时长，一般够用。

---

## 方式二：Railway（免费额度，需绑卡）

[Railway](https://railway.app) 每月有免费额度，不休眠，适合希望随时能打开的场景。

1. 打开 **https://railway.app**，用 GitHub 登录。
2. **New Project** → **Deploy from GitHub repo**，选中本项目的仓库。
3. 若未自动识别为 Node 项目：在项目里点 **Settings**，**Build Command** 填 `npm install`，**Start Command** 填 `npm start`。
4. 点 **Settings** → **Networking** → **Generate Domain**，会得到一个 `xxx.up.railway.app` 的地址，即为游戏在线地址。

---

## 方式三：自己的服务器（VPS）— 推荐国内玩家用国内云

若你有云服务器（**阿里云、腾讯云、华为云等国内云**，或海外 VPS）：

1. 用 SSH 连上服务器，安装 Node.js（如 18 LTS）。
2. 把项目上传到服务器（Git 或 SFTP 均可）。
3. 在项目目录执行：
   ```bash
   npm install
   PORT=3000 node server.js
   ```
   或使用进程守护（推荐）：`npm install -g pm2` 后执行 `pm2 start server.js --name poker`，掉线会自动重启。
4. 在云控制台**安全组 / 防火墙**中放行 3000 端口（或你设置的端口）。
5. 用 **http://你的服务器公网IP:3000** 访问。  
   若希望用域名和 HTTPS，可在前面加 Nginx + 免费证书（如 Let’s Encrypt 或国内云提供的免费 SSL）。

**国内云简要**：
- **阿里云**：轻量应用服务器或 ECS，新用户常有优惠；地域选离玩家近的（如华东、华北）。
- **腾讯云**：轻量应用服务器或 CVM，同样选就近地域。
- 部署在同一大区后，国内玩家用你的公网 IP 或域名即可流畅联机。

---

## 部署后分享给他人

- **房主**：打开你的在线地址 → 创建房间 → 复制房间号，把「游戏链接 + 房间号」发给好友。
- **其他人**：打开同一游戏链接 → 加入房间 → 输入房间号即可。

前端会自动连到当前打开网页的域名，无需再改代码。

---

## 常见问题

- **打开链接一直转圈 / 超时**  
  若是 Render 免费版，可能是服务在休眠，多等 30 秒～1 分钟再试。  
  若**国内访问**海外链接很慢，建议改用国内服务器部署（见方式三）。

- **能打开页面但无法加入房间 / 断线**  
  检查是否用了同一链接（同一域名），且没有公司/学校网络拦截 WebSocket。  
  页面顶部若出现「网络已断开，请刷新并重新加入房间（房间号：XXX）」：刷新后重新打开链接，在首页「加入房间」输入提示中的房间号即可。

- **中国玩家连不上或经常掉线**  
  优先把游戏部署在**国内云**（阿里云/腾讯云），同一网络环境下访问更稳定；游戏已做断线重连和房间号提示，掉线后按提示重新加入即可。

- **想用自己域名**  
  在 Render / Railway 的域名设置里可绑定自定义域名；若用 VPS/国内云，需在 Nginx 里配置反向代理和域名。
