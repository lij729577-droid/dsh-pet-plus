# 安装 dsh-pet-plus 到 DSH 桌面 profile
# 用法：右键“使用 PowerShell 运行”，或在 PowerShell 里执行 .\install.ps1
$ErrorActionPreference = 'Stop'

$profileName = 'desktop'
$src = $PSScriptRoot
$profileRoot = Join-Path $env:USERPROFILE ".dsh\profiles\$profileName"
$dst = Join-Path $profileRoot 'node_modules\dsh-pet-plus'
$patch = Join-Path $profileRoot 'cordis.patch.yml'

if (-not (Test-Path $profileRoot)) {
    throw "找不到 profile 目录：$profileRoot"
}
if (-not (Test-Path (Join-Path $src 'index.js'))) {
    throw "install.ps1 需要和 index.js 放在同一个文件夹里"
}

if (Test-Path $dst) {
    Remove-Item -LiteralPath $dst -Recurse -Force
}
New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force

$text = ''
if (Test-Path $patch) {
    $text = Get-Content -LiteralPath $patch -Raw
}
if ($text -notmatch 'dsh-pet-plus') {
    $block = "`r`n# dsh-pet-plus：蓝毛小女仆伴生插件`r`n- insert:`r`n    - id: dsh-pet-plus`r`n      name: 'dsh-pet-plus'`r`n"
    Add-Content -LiteralPath $patch -Value $block -Encoding utf8
    Write-Host "已向 cordis.patch.yml 追加插件条目"
} else {
    Write-Host "cordis.patch.yml 里已经有 dsh-pet-plus 条目，跳过"
}

Write-Host ""
Write-Host "已安装到：$dst"
Write-Host "请完全退出并重新打开 DeepSeek Harness 后生效。"
Write-Host "不想重启可先用独立模式：node standalone.js --port 64679 --exec feed"
