# 卸载 dsh-pet-plus
$ErrorActionPreference = 'Stop'

$profileName = 'desktop'
$profileRoot = Join-Path $env:USERPROFILE ".dsh\profiles\$profileName"
$dst = Join-Path $profileRoot 'node_modules\dsh-pet-plus'
$patch = Join-Path $profileRoot 'cordis.patch.yml'

if (Test-Path $dst) {
    Remove-Item -LiteralPath $dst -Recurse -Force
    Write-Host "已删除 $dst"
}
if (Test-Path $patch) {
    Copy-Item -LiteralPath $patch -Destination ($patch + '.bak') -Force
    $text = Get-Content -LiteralPath $patch -Raw
    $new = $text -replace "(?s)\r?\n# dsh-pet-plus.*?- id: dsh-pet-plus\r?\n      name: 'dsh-pet-plus'\r?\n?", "`r`n"
    if ($new -ne $text) {
        Set-Content -LiteralPath $patch -Value $new -Encoding utf8 -NoNewline
        Write-Host "已从 cordis.patch.yml 移除插件条目（备份：$patch.bak）"
    }
}
Write-Host "请重启 DeepSeek Harness 生效。"
