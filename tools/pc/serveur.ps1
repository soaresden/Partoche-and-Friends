﻿# Mini serveur local de Partoche and Friends pour Windows (rien à installer : PowerShell est fourni avec Windows).
# Sert le dossier « app » sur http://localhost:53682/ (adresse autorisée par l'appli pCloud) et ouvre le navigateur.
# Le dossier « Partitions » est présenté comme un dossier Partoche (même chose que serveur.py) :
#   Partitions/*.mscz (sous-dossiers compris) -> MSCZ/…   ·   Partitions/Friends/ -> Friends/ (profil, annotations)
$ErrorActionPreference = 'Stop'
$port = 53682
$app = Join-Path $PSScriptRoot 'app'
$parts = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Partitions'))
$url = "http://localhost:$port/"
New-Item -ItemType Directory -Force -Path (Join-Path $parts 'Friends') | Out-Null

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'
  '.data' = 'application/octet-stream'; '.mscz' = 'application/octet-stream'; '.sf2' = 'application/octet-stream'
  '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.woff2' = 'font/woff2'; '.txt' = 'text/plain; charset=utf-8'
}

function Meta($f) {
  $i = Get-Item -LiteralPath $f
  $t = [int64]([DateTimeOffset]$i.LastWriteTimeUtc).ToUnixTimeSeconds()
  @{ size = $i.Length; hash = "$($i.Length)-$t"; modified = $i.LastWriteTimeUtc.ToString('r') }
}
# MSCZ/x -> Partitions/x ; Friends/x -> Partitions/Friends/x ; rien d'autre
function RealPath($v) {
  $v = $v -replace '\\', '/'
  if ($v.StartsWith('MSCZ/')) { $rel = $v.Substring(5) } elseif ($v.StartsWith('Friends/')) { $rel = $v } else { return $null }
  $full = [System.IO.Path]::GetFullPath((Join-Path $parts $rel))
  if ($full.StartsWith($parts + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { $full } else { $null }
}
function Listing {
  $out = @{}
  foreach ($f in Get-ChildItem -LiteralPath $parts -Recurse -File -ErrorAction SilentlyContinue) {
    $rel = $f.FullName.Substring($parts.Length + 1) -replace '\\', '/'
    if ($rel.StartsWith('Friends/')) { $out[$rel] = Meta $f.FullName }
    elseif ($f.Extension -ieq '.mscz') { $out['MSCZ/' + $rel] = Meta $f.FullName }
  }
  $out
}
function Send($res, [int]$code, [byte[]]$body, $type) {
  $res.StatusCode = $code
  if ($type) { $res.ContentType = $type }
  $res.Headers.Add('Cache-Control', 'no-cache')   # après une mise à jour, pas de mélange ancien / nouveau
  if (-not $body) { $body = [byte[]]@() }
  $res.ContentLength64 = $body.Length
  if ($body.Length) { $res.OutputStream.Write($body, 0, $body.Length) }
}
function Json($o) { [System.Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Depth 4 -Compress)) }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try { $listener.Start() }
catch {
  # déjà lancé (autre fenêtre) : on ouvre juste le navigateur
  Write-Host "Partoche and Friends tourne déjà (ou le port $port est pris). Ouverture du navigateur..."
  Start-Process $url
  Start-Sleep -Seconds 3
  exit
}

Write-Host ''
Write-Host '  Partoche and Friends tourne sur ' -NoNewline; Write-Host $url -ForegroundColor Green
Write-Host '  Tes partitions : ' -NoNewline; Write-Host $parts -ForegroundColor Yellow
Write-Host '  (mets tes fichiers .mscz dedans, puis Actualiser dans l''appli)'
Write-Host ''
Write-Host '  Laisse cette fenêtre ouverte pendant que tu joues. Ferme-la pour arrêter.'
Write-Host ''
if (-not $env:PAF_NO_BROWSER) { Start-Process $url }

$appFull = [System.IO.Path]::GetFullPath($app)
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $raw = $req.RawUrl; $q = ''
    if ($raw.Contains('?')) { $q = $raw.Substring($raw.IndexOf('?') + 1); $raw = $raw.Substring(0, $raw.IndexOf('?')) }
    $path = [System.Uri]::UnescapeDataString($raw)
    if ($path.StartsWith('/_paf/')) {
      $name = $path.Substring(6)
      if ($name -eq 'info') { Send $res 200 (Json @{ folder = (Split-Path $parts -Leaf); path = $parts }) 'application/json' }
      elseif ($name -eq 'list') { Send $res 200 (Json (Listing)) 'application/json' }
      elseif ($name -eq 'file') {
        $p = $null
        foreach ($kv in $q.Split('&')) { if ($kv.StartsWith('p=')) { $p = RealPath ([System.Uri]::UnescapeDataString($kv.Substring(2).Replace('+', ' '))) } }
        if (-not $p) { Send $res 400 $null $null }
        elseif ($req.HttpMethod -eq 'GET') {
          if (Test-Path -LiteralPath $p -PathType Leaf) { Send $res 200 ([System.IO.File]::ReadAllBytes($p)) 'application/octet-stream' } else { Send $res 404 $null $null }
        }
        elseif ($req.HttpMethod -eq 'PUT') {
          $ms = New-Object System.IO.MemoryStream
          $req.InputStream.CopyTo($ms)
          New-Item -ItemType Directory -Force -Path (Split-Path $p -Parent) | Out-Null
          [System.IO.File]::WriteAllBytes($p + '.tmp', $ms.ToArray())
          Move-Item -LiteralPath ($p + '.tmp') -Destination $p -Force
          Send $res 200 (Json (Meta $p)) 'application/json'
        }
        elseif ($req.HttpMethod -eq 'DELETE') {
          if (Test-Path -LiteralPath $p -PathType Leaf) { Remove-Item -LiteralPath $p -Force }
          Send $res 200 ([System.Text.Encoding]::UTF8.GetBytes('{}')) 'application/json'
        }
        else { Send $res 405 $null $null }
      }
      else { Send $res 404 $null $null }
      continue
    }
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $app $path.TrimStart('/')))
    if (-not $file.StartsWith($appFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      Send $res 404 ([System.Text.Encoding]::UTF8.GetBytes('Introuvable')) 'text/plain; charset=utf-8'
    } else {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $type = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      Send $res 200 ([System.IO.File]::ReadAllBytes($file)) $type
    }
  } catch {
    Write-Host ("  Erreur : " + $_.Exception.Message) -ForegroundColor Red
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.OutputStream.Close() } catch { }
  }
}
