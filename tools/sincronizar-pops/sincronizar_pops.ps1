# Sincroniza os POPs (PDF) da pasta do OneDrive com o sistema Suporte Técnico.
# Roda pela tarefa agendada todo dia às 9h. Manda só o que mudou desde a última vez.
# Não altera nada no OneDrive/SharePoint: só lê.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}

$Servidor  = if ($env:POPS_SERVIDOR) { $env:POPS_SERVIDOR } else { 'https://suporte-tecnico.silvertec.net.br' }
$Subpastas = '^(00|02|04) - '          # Uso comum, N2 e Monitoramento (N1 fica de fora por enquanto)
$TamMax    = 11MB
$Aqui      = $PSScriptRoot
$Log       = Join-Path $Aqui 'sincronizacao.log'

function Log($msg) {
    $linha = "{0:dd/MM/yyyy HH:mm:ss}  {1}" -f (Get-Date), $msg
    Add-Content -LiteralPath $Log -Value $linha -Encoding UTF8
    Write-Host $linha
}

# Mantém o log curto (últimas 2000 linhas)
if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 500KB) {
    $ult = Get-Content -LiteralPath $Log -Tail 2000 -Encoding UTF8
    Set-Content -LiteralPath $Log -Value $ult -Encoding UTF8
}

try {
    # Chave guardada cifrada para o seu usuário do Windows (só você, nesta máquina, consegue ler)
    $arqChave = Join-Path $Aqui 'chave.dat'
    if (-not (Test-Path $arqChave)) { throw "Chave não configurada. Rode 'Instalar sincronizacao POPs.cmd'." }
    $seg   = Get-Content -LiteralPath $arqChave | ConvertTo-SecureString
    $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
    $H = @{ 'X-API-Key' = $chave }

    # O PowerShell do Windows lê resposta sem "charset" como Latin-1 e estraga os acentos
    # dos nomes das pastas; aqui a resposta é lida sempre como UTF-8.
    function Pedir($url, $metodo = 'Get', $corpo = $null) {
        $p = @{ Uri = $url; Method = $metodo; Headers = $H; UseBasicParsing = $true; TimeoutSec = 120 }
        if ($corpo) { $p.Body = [Text.Encoding]::UTF8.GetBytes(($corpo | ConvertTo-Json -Depth 4)); $p.ContentType = 'application/json; charset=utf-8' }
        $r = Invoke-WebRequest @p
        return ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json)
    }

    # Pasta do OneDrive da Life (a mesma que o Explorer mostra)
    $raizOD = $env:OneDriveCommercial
    if (-not $raizOD) { $raizOD = (Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Filter 'OneDrive - Life*' | Select-Object -First 1).FullName }
    $Pasta = Join-Path $raizOD '06 - WIKI\03 - Procedimentos Operacionais'
    if (-not (Test-Path -LiteralPath $Pasta)) { throw "Pasta não encontrada: $Pasta" }

    # 1) O que existe aqui
    $locais = @{}
    Get-ChildItem -LiteralPath $Pasta -Directory | Where-Object { $_.Name -match $Subpastas } | ForEach-Object {
        Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter '*.pdf' -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = $_.FullName.Substring($Pasta.Length).Replace('\', '/').TrimStart('/')
            $locais[$rel] = $_
        }
    }
    if ($locais.Count -eq 0) { throw "Nenhum PDF encontrado em $Pasta (OneDrive parado?). Nada foi enviado nem removido." }

    # 2) O que o servidor já tem
    $estado = @{}
    $resp = Pedir "$Servidor/ferramentas/pops/sync/estado"
    foreach ($p in $resp.PSObject.Properties) { $estado[$p.Name] = $p.Value }

    # 3) Envia o que é novo ou mudou (tamanho ou data diferentes)
    $enviados = 0; $erros = @()
    foreach ($rel in $locais.Keys) {
        $f   = $locais[$rel]
        $mod = [string]([DateTimeOffset]$f.LastWriteTimeUtc).ToUnixTimeSeconds()   # número: o PowerShell não converte em data
        $srv = $estado[$rel]
        if ($srv -and [int64]$srv.tamanho -eq $f.Length -and [string]$srv.modificado -eq $mod) { continue }
        if ($f.Length -gt $TamMax) { $erros += "acima de 11 MB: $rel"; continue }
        try {
            $url = "$Servidor/ferramentas/pops/sync/arquivo?caminho=$([uri]::EscapeDataString($rel))&modificado=$([uri]::EscapeDataString($mod))"
            $r = Invoke-RestMethod -Uri $url -Method Put -InFile $f.FullName -ContentType 'application/pdf' -Headers $H -TimeoutSec 180
            $enviados++
            Log ("enviado: {0} ({1})" -f $rel, $r.status)
        } catch {
            $erros += "$rel -> $($_.Exception.Message)"
            Log "ERRO ao enviar $rel : $($_.Exception.Message)"
        }
    }

    # 4) Remove do sistema o que saiu da pasta (excluído ou movido para "99 - Arquivo antigo")
    $sumiram = @($estado.Keys | Where-Object { -not $locais.ContainsKey($_) })
    $removidos = 0
    if ($sumiram.Count -gt 0) {
        if ($sumiram.Count -gt [Math]::Max(10, $estado.Count / 2)) {
            $erros += "não removi $($sumiram.Count) arquivos: são muitos de uma vez (pasta incompleta?)"
            Log "AVISO: $($sumiram.Count) arquivos sumiram de uma vez; nada removido por segurança."
        } else {
            $r = Pedir "$Servidor/ferramentas/pops/sync/remover" 'Post' @{ caminhos = $sumiram }
            $removidos = $r.removidos
            $sumiram | ForEach-Object { Log "removido do sistema: $_" }
        }
    }

    # 5) Registro da rodada (aparece na tela Procedimentos como "atualizado em")
    Pedir "$Servidor/ferramentas/pops/sync/fim" 'Post' @{ maquina = $env:COMPUTERNAME; total = $locais.Count; enviados = $enviados; removidos = $removidos; erros = @($erros) } | Out-Null
    Log ("Concluído: {0} PDFs na pasta, {1} enviados, {2} removidos, {3} erros." -f $locais.Count, $enviados, $removidos, $erros.Count)
} catch {
    Log "FALHOU: $($_.Exception.Message)"
    exit 1
}
