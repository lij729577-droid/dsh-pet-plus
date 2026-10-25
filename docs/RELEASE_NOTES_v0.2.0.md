# dsh-pet-plus v0.2.0

给 **蓝毛小女仆（dsh-pet）** 的伴生挂件：四个可收起的无边框悬浮图标 + 番茄钟倒计时 + 喝水提醒。

## 这版有什么

- **默认全部收起**：画面上不显示图标；有番茄钟时只保留人物下方的倒计时气泡。
- **点一下女仆**：四个图标（饭 / 时钟 / 水杯 / Q 版头像）一起展开，再点一下收起；展开后 5 秒没有交互会自动收起。
- **番茄钟**：15 / 25 / 45 / 60 / 90 分钟或自定义；倒计时 21px、跟随文字自适应，点气泡可停止。
- **喂食 / 喝水 / 状态**：只在女仆头顶说一句，不在挂件下方重复弹气泡。
- **只保留饱食度**：心情、好感、喂食次数已移除（它们没有对应的剧情或动作）。
- **无边框透明**：Win32 分层窗口逐像素透明，没有卡片、白底或边框；每 1 秒跟随女仆。
- 右键菜单：番茄钟 / 喝水提醒 / 停止番茄钟 / 刷新 / 显示隐藏图标 / 关闭挂件。

## 安装

1. 先装好 **DSH desktop** 和 **dsh-pet（蓝毛小女仆）**。
2. 解压后右键 `install.ps1` →「使用 PowerShell 运行」。
3. 完全退出并重新打开 DSH；通常热加载几秒即可。

手动安装：把 `dsh-pet-plus` 复制到
`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-pet-plus`，
再在 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: dsh-pet-plus
      name: 'dsh-pet-plus'
```

## 依赖

- DSH desktop profile
- 已安装的 dsh-pet（本插件不打包它的源码和素材）
- Windows 10/11 + DSH 自带 Python（Pillow、numpy）

## 已知限制

- 仅 Windows；独占全屏应用可能盖住 topmost 窗口。
- 点女仆展开依赖 dsh-pet 的窗口位置，女仆被完全挡住时点不到。
- dsh-pet 升级后如果本地接口变化，需要跟着更新本插件。

## 校验

```powershell
node --check index.js
python -m py_compile panel.py
```

完整改动见 [CHANGELOG.md](../CHANGELOG.md)。

**License:** MIT
