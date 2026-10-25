# Contributing

感谢愿意一起改这个小挂件。提交前请先确认：

## 开发环境

- Windows 10/11
- Node.js 22+
- DSH desktop profile，且已安装 `dsh-pet`
- Python 3.12（DSH 自带运行时即可，需要 Pillow、numpy）

## 本地检查

```powershell
node --check index.js
python -m py_compile panel.py
```

挂件单独运行：

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"
python panel.py
```

## 约定

- 不修改 `dsh-pet` 的源码，只通过它的本地 HTTP 接口工作。
- 不把 `dsh-pet` 的立绘/表情包打包进本仓库；头像在运行时从已安装的 `dsh-pet` 读取。
- 新增 UI 行为时，尽量保持「无边框、透明背景、跟随女仆」的风格。
- 改动 `panel.py` 后至少确认：默认收起、点女仆展开、倒计时在人物下方、喂食/喝水/状态只在头顶说话。
- 提交 PR 时写清楚改了什么、怎么验证的；截图请使用干净背景，不要带个人聊天/表格内容。

## Issue

- 说清楚 DSH 版本、`dsh-pet` 版本、Windows 版本。
- 如果是挂件问题，附上 `~/.dsh/dsh-pet-plus/state.json` 里与问题相关的字段（不要贴账号信息）。
- 独占全屏、被其他 topmost 窗口覆盖属于已知限制，可以先说明场景。
