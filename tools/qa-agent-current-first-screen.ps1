# Independent native screenshot of the first visible page of current installed Agent.
# Public QA owns this watcher; private product bytes, user data and full stderr never leave CI.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDir, [int]$TimeoutSeconds=4200)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[void][IO.Directory]::CreateDirectory($OutputDir)
$end=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
while([DateTime]::UtcNow -lt $end){
  $candidates=@(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -eq 'IWXA Personal'
  })
  foreach($p in $candidates){
    try {
      $p.Refresh()
      if($p.HasExited -or $p.MainWindowHandle -eq [IntPtr]::Zero -or
         $p.MainWindowTitle -cne 'IWXA Personal'){continue}
      $root=[Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      $caption=-join([char[]]@(0x422,0x435,0x43a,0x441,0x442,0x20,0x437,0x430,0x434,0x430,0x447,0x438))
      $labels=@($caption,'Task text','Текст задачи')
      $fields=@()
      foreach($label in $labels){
        $filter=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$label)
        $fields+=@($root.FindAll([Windows.Automation.TreeScope]::Descendants,$filter))
      }
      $editor=$null
      foreach($field in $fields){
        if($field.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and
           $field.Current.IsEnabled -and !$field.Current.IsOffscreen){$editor=$field;break}
      }
      if(!$editor){continue}
      Start-Sleep -Milliseconds 600
      $p.Refresh()
      if($p.HasExited){continue}
      $bounds=$root.Current.BoundingRectangle
      $screen=[Windows.Forms.Screen]::PrimaryScreen.Bounds
      $left=[int][Math]::Max($screen.Left,[Math]::Floor($bounds.Left))
      $top=[int][Math]::Max($screen.Top,[Math]::Floor($bounds.Top))
      $right=[int][Math]::Min($screen.Right,[Math]::Ceiling($bounds.Right))
      $bottom=[int][Math]::Min($screen.Bottom,[Math]::Ceiling($bounds.Bottom))
      $width=$right-$left;$height=$bottom-$top
      if($width -lt 650 -or $height -lt 470){continue}
      $png=Join-Path $OutputDir 'agent-native-current-first-screen.png'
      $bmp=[Drawing.Bitmap]::new($width,$height)
      $gfx=[Drawing.Graphics]::FromImage($bmp)
      try{
        $gfx.CopyFromScreen([Drawing.Point]::new($left,$top),
          [Drawing.Point]::Empty,[Drawing.Size]::new($width,$height))
        $bmp.Save($png,[Drawing.Imaging.ImageFormat]::Png)
      }finally{$gfx.Dispose();$bmp.Dispose()}
      if((Get-Item -LiteralPath $png).Length -lt 6000){Remove-Item -LiteralPath $png -Force;continue}
      $fileSha=(Get-FileHash -LiteralPath $png -Algorithm SHA256).Hash.ToLowerInvariant()
      # No project/task text is read or emitted. Screenshot is reviewed separately before publication.
      $manifest=[ordered]@{
        originalAgentSha='0d4196fa732b52d192ac75590715199381dfb2df'
        ciSha=$env:GITHUB_SHA
        windowTitle='IWXA Personal'
        mode='Tauri installed native, first visible editable task field'
        screenshotSha256=$fileSha
        source='Independent Window UIAutomation + Windows Graphics.CopyFromScreen'
        status='CAPTURED_REQUIRES_VISUAL_REVIEW'
      }
      $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDir 'capture-manifest.json') -Encoding UTF8
      Write-Output 'QA_AGENT_REAL_NATIVE_CAPTURE_CREATED'
      exit 0
    }catch{
      # Never write private process metadata, text, or failures to public logs.
    }
  }
  Start-Sleep -Milliseconds 600
}
Write-Output 'QA_AGENT_REAL_NATIVE_CAPTURE_NOT_OBSERVED'
exit 1
