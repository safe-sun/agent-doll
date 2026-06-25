# Codex 桌宠

一个轻量桌面小窗口，用来显示 Codex 本地记录里的剩余用量状态。

## 启动

```powershell
npm install
npm start
```

也可以双击 `启动桌宠.vbs`，它会隐藏控制台，只显示桌宠窗口。

## 数据来源

应用只读取本机 Codex 数据，不会上传认证信息。

- 用量：读取 `~/.codex/sessions` 下最近的 `rate_limits` 记录。
- 桌宠图片：优先复用 `~/.codex/pets/capoo/spritesheet.webp`。
- 如果 Codex 最近没有产生 token 统计，界面会显示“未检测到用量记录”。

## 说明

Codex 当前没有在 CLI 中提供单独的“剩余额度”命令。这里显示的是本地 `rate_limits.used_percent` 推算出的剩余百分比，以及对应窗口的重置时间。
