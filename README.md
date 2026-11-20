# 甜蜜厨房（网页版）

给两个人用的点菜应用：一方点菜，一方下厨。创建厨房后把链接或 6 位邀请码发给对方，两部手机会同步菜谱、点菜单和订单（约 2.5 秒刷新一次）。

页面可在微信内置浏览器、手机 Chrome / Safari 里使用。默认 21 道家常菜在创建厨房时写入。

## 本地启动

需要 Node 18 或更高版本，无额外 npm 依赖。

```bash
cd sweet-kitchen-web
node server.js
```

默认地址：http://localhost:8787  
换端口：`PORT=3000 node server.js`

打开首页即可创建厨房。厨房数据保存在 `data/` 目录，菜品图片在 `data/images/`，重启服务不会丢失。

## 接口一览

除图片下载外均返回 JSON。厨房令牌是 32 位十六进制，出现在链接 `/k/<token>` 里，不要公开列出。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/kitchens` | 创建厨房（写入默认 21 道菜），返回 token、code、shareUrl、完整状态 |
| POST | `/api/kitchens/join` | 用邀请码加入，body：`{"code":"A3K7P2"}` |
| GET | `/api/kitchens/:token` | 读取完整状态；可加 `?since=<updatedAt>`，无更新时返回 `{unchanged:true}` |
| POST | `/api/kitchens/:token/images` | 上传菜品图片（JSON，base64 或 data URL），返回 `{id,url}` |
| GET | `/api/kitchens/:token/images/:id` | 读取图片二进制，带长期缓存 |
| POST | `/api/kitchens/:token/dishes` | 新增或更新一道菜（可用 `image` 字段引用已上传的图片 id） |
| DELETE | `/api/kitchens/:token/dishes/:id` | 删除菜谱 |
| POST | `/api/kitchens/:token/dishes/restore` | 恢复默认 21 道菜 |
| POST | `/api/kitchens/:token/cart` | 改点菜单。body：`{action:"change",id,delta}` / `{action:"notes",notes}` / `{action:"clear"}` |
| POST | `/api/kitchens/:token/orders` | 提交点菜单，body 可带 `notes` |
| POST | `/api/kitchens/:token/orders/:id` | `{action:"done"}` 标记做好啦，或 `{action:"delete"}` 删除 |
| DELETE | `/api/kitchens/:token/orders/:id` | 删除订单 |

接口有基础限流（按 IP），没有列出全部厨房的接口。

## 部署

**方式一：自己的服务器（推荐给国内微信里打开）**

把本目录放到服务器，用 Node 18+ 运行 `node server.js`。前面可加 Caddy / Nginx 做 HTTPS 反代。请设置环境变量 `PORT`。若在反代后面，请把 `X-Forwarded-Proto` 和 `X-Forwarded-Host` 传给 Node，这样生成的分享链接才是 https 公网地址。

**方式二：Netlify**

本仓库已包含 `netlify.toml`、`public/` 静态页面和 `netlify/functions/api.js`。在 Netlify 上导入本目录（或把本目录作为站点根目录）即可，构建命令留空，发布目录为 `public`。接口会转到 Functions，数据存在 Netlify Blobs（站点创建后自动可用）。

注意：Netlify 在中国大陆有时较慢或不稳定。若主要在微信里打开，优先用方式一，把服务放在国内可访问的主机上，再把链接发给对方。

## 目录说明

```
server.js                 本地 / 自建服务器入口
lib/                      共享业务逻辑与存储适配
  dishes.js               默认 21 道菜
  kitchen.js / api.js     业务与路由
  store-fs.js             本地 JSON 文件存储
  store-blobs.js          Netlify Blobs 适配
public/                   前端（CSS/JS 全部自包，无外部脚本）
netlify/functions/api.js  Netlify 接口
data/                     本地运行时数据（不要提交里面的厨房文件）
```
