import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function selectFolder(): Promise<string | null> {
  if (process.platform !== "win32") {
    return null;
  }

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Select a local project folder"
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      Write-Output $dialog.SelectedPath
    }
  `;

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: false }
  );

  return stdout.trim() || null;
}
