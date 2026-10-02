# Regroupeur pour Cardmarket - mise a jour automatique.
# Lance par la tache planifiee (toutes les 3 heures et a l'ouverture de session) ; peut aussi etre lance a la main.
# Compare la version installee avec version.json sur GitHub, telecharge le nouveau paquet, verifie son empreinte
# SHA-256 puis remplace les fichiers. L'extension propose ensuite « Activer maintenant » (ou au prochain Chrome).
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Regroupeur-pour-Cardmarket'),
  [string]$VersionUrl = 'https://raw.githubusercontent.com/Lioxyze/Cardmarket-Regroupeur/diffusion/version.json',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$ExtDir = Join-Path $InstallDir 'extension'
$LogFile = Join-Path $InstallDir 'mise-a-jour.log'

function Write-Log([string]$Message) {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message
  $old = @()
  if (Test-Path $LogFile) { $old = @(Get-Content -Path $LogFile -Encoding UTF8 | Select-Object -Last 199) }
  Set-Content -Path $LogFile -Value ($old + $line) -Encoding UTF8
  Write-Host $Message
}

function Test-Newer([string]$A, [string]$B) {
  # Vrai si la version A est plus recente que B (1.0.10 > 1.0.9).
  try { return ([version]$A) -gt ([version]$B) } catch { return $A -ne $B }
}

$tmp = $null
try {
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $info = Invoke-RestMethod -Uri ($VersionUrl + '?t=' + $stamp) -UseBasicParsing -TimeoutSec 60
  if (-not $info.version -or -not $info.zip) { throw 'version.json illisible.' }

  $local = $null
  $manifest = Join-Path $ExtDir 'manifest.json'
  if (Test-Path $manifest) { $local = (Get-Content -Path $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version }
  if (-not $Force -and $local -and -not (Test-Newer $info.version $local)) {
    Write-Log "Deja a jour (version $local)."
    exit 0
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('regroupeur-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'regroupeur.zip'
  Invoke-WebRequest -Uri $info.zip -OutFile $zip -UseBasicParsing -TimeoutSec 180

  $hash = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($info.sha256 -and $hash -ne ([string]$info.sha256).ToLowerInvariant()) {
    throw 'Empreinte SHA-256 differente de celle annoncee : fichier corrompu ou modifie, mise a jour annulee.'
  }

  $unzipped = Join-Path $tmp 'x'
  Expand-Archive -Path $zip -DestinationPath $unzipped -Force
  $src = Join-Path $unzipped 'Regroupeur-pour-Cardmarket'
  if (-not (Test-Path (Join-Path $src 'manifest.json'))) { throw 'Paquet invalide : manifest.json absent.' }

  # Copie miroir : fichiers nouveaux, modifies et supprimes. Chrome ne verrouille pas ces fichiers.
  # /IS /IT : tout recopier, meme un fichier de meme taille et de meme date (sinon robocopy l'ignorerait).
  New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null
  & robocopy.exe $src $ExtDir /MIR /IS /IT /R:3 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copie des fichiers impossible (code robocopy $LASTEXITCODE)." }
  $installed = (Get-Content -Path $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($installed -ne $info.version) { throw "Copie incomplete : version $installed trouvee au lieu de $($info.version)." }

  $from = 'aucune'
  if ($local) { $from = $local }
  Write-Log ("Mise a jour installee : {0} -> {1}." -f $from, $info.version)
  exit 0
}
catch {
  Write-Log ('Echec de la mise a jour : ' + $_.Exception.Message)
  exit 1
}
finally {
  if ($tmp) { Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue }
}
