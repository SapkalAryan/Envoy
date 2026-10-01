// lib/focusWindow.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export async function focusWindowByTitle(titleFragment: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;

  const safeFragment = titleFragment.replace(/'/g, "''");

  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@

$fragment = '${safeFragment}'

$procs = Get-Process | Where-Object {
  $_.MainWindowTitle -and ($_.MainWindowTitle -like "*$fragment*") -and $_.MainWindowHandle -ne 0
}

if (-not $procs -or @($procs).Count -eq 0) {
  Write-Output "not_found"
  exit 0
}

$p = @($procs)[0]
$hWnd = $p.MainWindowHandle

$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP_NOMOVE = 0x0002
$SWP_NOSIZE = 0x0001
$SWP_SHOWWINDOW = 0x0040

if ([Win32]::IsIconic($hWnd)) {
  $null = [Win32]::ShowWindow($hWnd, 9)
}

$foreground = [Win32]::GetForegroundWindow()
$targetThread = [Win32]::GetWindowThreadProcessId($foreground, [ref]0)
$currentThread = [Win32]::GetCurrentThreadId()
$null = [Win32]::AttachThreadInput($currentThread, $targetThread, $true)

$null = [Win32]::BringWindowToTop($hWnd)
$null = [Win32]::SetWindowPos($hWnd, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW)
$null = [Win32]::SetForegroundWindow($hWnd)
$null = [Win32]::SetWindowPos($hWnd, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE)

$null = [Win32]::AttachThreadInput($currentThread, $targetThread, $false)

Write-Output "focused:$($p.MainWindowTitle)"
`;

  try {
    const tmpPath = path.join(process.env.TEMP || '/tmp', `envoy-focus-${Date.now()}.ps1`);
    await fs.writeFile(tmpPath, psScript, 'utf-8');

    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPath}"`,
      { timeout: 5000 }
    );
    await fs.unlink(tmpPath).catch(() => {});

    const result = stdout.trim();
    if (result.startsWith('focused:')) {
      console.log(`[focus] ✅ ${result}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function focusEnvoyConsole(): Promise<boolean> {
  const candidates = ['ENVOY', 'Envoy', 'localhost', 'Autonomous'];
  for (const c of candidates) {
    if (await focusWindowByTitle(c)) return true;
  }
  return false;
}

export async function focusPlaywrightBrowser(): Promise<boolean> {
  const candidates = [
    'Google Chrome for Testing',
    'Chrome for Testing',
    'YouTube',
    'Instagram',
    'GitHub',
    'Meta',
    'Sign in',
    'Chromium',
  ];
  for (const c of candidates) {
    if (await focusWindowByTitle(c)) return true;
  }
  return false;
}