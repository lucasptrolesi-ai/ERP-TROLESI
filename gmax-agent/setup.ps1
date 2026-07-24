# Baixa e extrai o motor Firebird 2.5 embedded (64-bit) — a única peça
# externa que este agente precisa além do Python. Roda uma vez só, na
# instalação. Não commitamos essas DLLs no git (repositório fica mais leve);
# o próprio Firebird é open-source (IDPL), redistribuir o motor embedded é
# uso normal e esperado.
$ErrorActionPreference = "Stop"
$pastaAgente = Split-Path -Parent $MyInvocation.MyCommand.Path
$zip = Join-Path $pastaAgente "fbembed.zip"
$destino = Join-Path $pastaAgente "fbembed"

Write-Host "Baixando Firebird 2.5.7 embedded (64-bit)..."
Invoke-WebRequest -Uri "https://sourceforge.net/projects/firebird/files/firebird-win64/2.5.7-Release/Firebird-2.5.7.27050-0_x64_embed.zip/download" -OutFile $zip

Write-Host "Extraindo..."
Expand-Archive -Path $zip -DestinationPath $destino -Force
Remove-Item $zip

Write-Host "Instalando dependência Python (fdb)..."
python -m pip install fdb

Write-Host "Pronto. Copie .env.example para .env e preencha antes de rodar 'python agent.py'."
