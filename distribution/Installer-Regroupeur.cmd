@echo off
title Installation du Regroupeur pour Cardmarket
rem Telecharge l'installateur depuis GitHub puis le lance (aucun droit administrateur necessaire).
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f = Join-Path $env:TEMP 'installer-regroupeur.ps1'; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/__REPO__/main/installer.ps1' -OutFile $f; & $f"
