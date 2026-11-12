
$ping = New-Object System.Net.NetworkInformation.Ping
$samples = @()
try { for ($i=0; $i -lt 10; $i++) { try { $reply=$ping.Send(__RANKLY_PING_TARGET__, 1000); if ($reply.Status -eq 'Success') { $samples += [double]$reply.RoundtripTime } else { $samples += $null } } catch { $samples += $null }; Start-Sleep -Milliseconds 200 } } finally { $ping.Dispose() }
@{ samples=@($samples); target=__RANKLY_PING_TARGET__; testedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Depth 3 -Compress