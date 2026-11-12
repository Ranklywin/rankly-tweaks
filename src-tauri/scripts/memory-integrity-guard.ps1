
$memorySupport=Get-RanklyMemoryIntegrityStatus
if (!$memorySupport.available) { throw $memorySupport.reason }
