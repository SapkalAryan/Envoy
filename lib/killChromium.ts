// lib/killChromium.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Kill any Chromium process bound to our Playwright profile.
 * This INCLUDES the top-level browser and all child processes.
 * Waits until the OS actually releases the profile lock.
 */
export async function killStaleChromium(): Promise<number> {
  if (process.platform !== 'win32') {
    console.log('[kill-chromium] non-Windows — skipping');
    return 0;
  }

  try {
    const psScript = `
$profileFragment = 'browser-profile'
$totalKilled = 0

# Loop up to 3 times — some children respawn the parent
for ($round = 0; $round -lt 3; $round++) {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$profileFragment*") }

  if (-not $procs -or @($procs).Count -eq 0) {
    break
  }

  foreach ($p in $procs) {
    try {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      $totalKilled++
    } catch {}
  }

  Start-Sleep -Milliseconds 800
}

Write-Output $totalKilled
`;

    const tmpPath = path.join(
      process.env.TEMP || '/tmp',
      `envoy-kill-${Date.now()}.ps1`
    );
    await fs.writeFile(tmpPath, psScript, 'utf-8');

    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPath}"`,
      { timeout: 15000 }
    );

    await fs.unlink(tmpPath).catch(() => {});

    const killed = parseInt(stdout.trim().split('\n').pop() || '0', 10) || 0;

    if (killed > 0) {
      console.log(`[kill-chromium] ✅ killed ${killed} process(es)`);
    } else {
      console.log('[kill-chromium] no orphan Chromium found');
    }

    return killed;
  } catch (err) {
    console.error('[kill-chromium] error:', (err as Error).message);
    return 0;
  }
}

/**
 * Verify no Chromium is holding the profile. Returns true if clear.
 */
export async function isProfileClear(): Promise<boolean> {
  if (process.platform !== 'win32') return true;

  try {
    const psScript = `
$profileFragment = 'browser-profile'
$procs = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$profileFragment*") }
if ($procs -and @($procs).Count -gt 0) {
  Write-Output "locked:$(@($procs).Count)"
} else {
  Write-Output "clear"
}
`;

    const tmpPath = path.join(
      process.env.TEMP || '/tmp',
      `envoy-check-${Date.now()}.ps1`
    );
    await fs.writeFile(tmpPath, psScript, 'utf-8');

    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPath}"`,
      { timeout: 5000 }
    );

    await fs.unlink(tmpPath).catch(() => {});

    const result = stdout.trim();
    if (result === 'clear') return true;

    console.log(`[kill-chromium] profile still locked: ${result}`);
    return false;
  } catch {
    return true;
  }
}