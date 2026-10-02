# Regroupeur pour Cardmarket - desinstallation : arrete les mises a jour automatiques et supprime les fichiers.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Regroupeur-pour-Cardmarket'),
  [switch]$NoPause
)

$TaskName = 'Regroupeur pour Cardmarket - mise a jour'
try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop; Write-Host 'Mises a jour automatiques arretees.' }
catch { Write-Host 'Aucune tache de mise a jour a supprimer.' }

# Le script est dans le dossier a supprimer : on le quitte avant.
Set-Location $env:TEMP
Remove-Item -Recurse -Force -Path $InstallDir -ErrorAction SilentlyContinue
if (Test-Path $InstallDir) { Write-Host "Ferme Chrome puis supprime ce dossier a la main : $InstallDir" }
else { Write-Host 'Fichiers supprimes.' }

Write-Host ''
Write-Host 'Derniere etape : dans chrome://extensions, clique « Supprimer » sur Regroupeur pour Cardmarket.'
if (-not $NoPause) { Read-Host 'Appuie sur Entree pour fermer' | Out-Null }
