# Stops GTA V Enhanced (and RAGE Plugin Hook) when testing is done: closes the window politely, forces after 5 s.
# Double-click gt4_stop.cmd. Same shutdown logic as step 1 of gt4_restart.ps1; does not relaunch anything.
foreach($n in 'GTA5_Enhanced'){
 $p=Get-Process $n -ErrorAction SilentlyContinue
 if($p){$p|ForEach-Object{[void]$_.CloseMainWindow()};Start-Sleep 5;$p|Where-Object{-not $_.HasExited}|Stop-Process -Force}
}
Get-Process RAGEPluginHook -ErrorAction SilentlyContinue|Stop-Process -Force
Write-Output 'GTA stopped (if it was running).'
Start-Sleep 2
