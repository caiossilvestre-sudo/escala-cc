# Instala a sincronização dos POPs: guarda a chave (cifrada) e cria a tarefa das 9h e 15h.
# Não precisa de administrador.
$ErrorActionPreference = 'Stop'
$Aqui   = $PSScriptRoot
$Script = Join-Path $Aqui 'sincronizar_pops.ps1'
$Nome   = 'Sincronizar POPs (Suporte Tecnico)'

Write-Host ''
Write-Host '=== Sincronização dos POPs com o Suporte Técnico ===' -ForegroundColor Cyan
Write-Host ''
$seg = Read-Host 'Cole a chave de sincronização (FERRAMENTAS_POPS_CHAVE do servidor)' -AsSecureString
$seg | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $Aqui 'chave.dat')
Write-Host 'Chave guardada (cifrada para o seu usuário do Windows).' -ForegroundColor Green

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Script`"" -WorkingDirectory $Aqui
$gatilhos = @(
    (New-ScheduledTaskTrigger -Daily -At '09:00'),
    (New-ScheduledTaskTrigger -Daily -At '15:00')
)
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -Priority 7 -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Nome -Action $acao -Trigger $gatilhos -Settings $config `
    -Description 'Envia ao sistema Suporte Técnico os POPs que mudaram na pasta do OneDrive (9h e 15h).' -Force | Out-Null
Write-Host "Tarefa '$Nome' criada: todo dia às 9h e às 15h." -ForegroundColor Green
Write-Host '(Se o PC estiver desligado no horário, roda assim que ligar.)'
Write-Host ''
$r = Read-Host 'Fazer a primeira sincronização agora? Envia todos os PDFs uma vez, leva alguns minutos. (S/N)'
if ($r -match '^[sS]') {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script
}
Write-Host ''
Write-Host 'Pronto. O histórico fica em sincronizacao.log, nesta pasta.' -ForegroundColor Cyan
Read-Host 'Enter para fechar'
