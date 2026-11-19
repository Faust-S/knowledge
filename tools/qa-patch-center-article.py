"""Capture real Admin Center GUI frames by instrumenting a temporary COPY of existing Windows UIA verification."""
from pathlib import Path
import sys
source=Path(sys.argv[1])
content=source.read_text(encoding="utf-8-sig")
def replace_once(needle,replacement):
    global content
    assert content.count(needle)==1,"Exact installed verification marker changed"
    content=content.replace(needle,replacement)
capture=r"""
function Capture-EditorialCenter([string]$tag) {
  $window=Root-Element
  $rect=$window.Current.BoundingRectangle
  $screen=[System.Windows.Forms.Screen]::FromHandle($proc.MainWindowHandle).Bounds
  $x=[int][Math]::Max($screen.Left,[Math]::Floor($rect.Left))
  $y=[int][Math]::Max($screen.Top,[Math]::Floor($rect.Top))
  $rx=[int][Math]::Min($screen.Right,[Math]::Ceiling($rect.Right))
  $by=[int][Math]::Min($screen.Bottom,[Math]::Ceiling($rect.Bottom))
  $w=$rx-$x;$h=$by-$y
  if($w -lt 640 -or $h -lt 400) { throw 'ADMIN_EDITORIAL_REAL_WINDOW_BOUNDS_INVALID' }
  $dir=Join-Path $env:GITHUB_WORKSPACE 'artifacts/editorial-admin'
  [void][IO.Directory]::CreateDirectory($dir)
  $dst=Join-Path $dir ($tag+'.png')
  $bmp=[System.Drawing.Bitmap]::new($w,$h)
  $gfx=[System.Drawing.Graphics]::FromImage($bmp)
  try {
    Start-Sleep -Milliseconds 400
    $gfx.CopyFromScreen([System.Drawing.Point]::new($x,$y),[System.Drawing.Point]::Empty,[System.Drawing.Size]::new($w,$h))
    $bmp.Save($dst,[System.Drawing.Imaging.ImageFormat]::Png)
  }finally{$gfx.Dispose();$bmp.Dispose()}
  if((Get-Item -LiteralPath $dst).Length -lt 10000) { throw 'ADMIN_EDITORIAL_REAL_CAPTURE_EMPTY' }
  Write-Host ('ADMIN_EDITORIAL_NATIVE_IMAGE_PASS '+$tag+' sha256='+
    (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash.ToLowerInvariant())
}
"""
replace_once("function Start-Center {",capture+"\nfunction Start-Center {")
replace_once("  $saved=Wait-SavedProject 1\n","  $saved=Wait-SavedProject 1\n  Capture-EditorialCenter 'admin-01-atlas-work'\n")
replace_once("  Type-Control 'Критерии приёмки' 'Verified delivery report'\n",
             "  Type-Control 'Критерии приёмки' 'Verified delivery report'\n  Capture-EditorialCenter 'admin-02-assignment-editor'\n")
replace_once("  Click-ButtonContaining 'Запланировать место'\n",
             "  Click-ButtonContaining 'Запланировать место'\n  Capture-EditorialCenter 'admin-03-roles-seats'\n")
source.with_name("qa-editorial-installed-center.ps1").write_text(content,encoding="utf-8-sig")
print("EDITORIAL_NATIVE_ADMIN_THREE_CAPTURE_POINTS_READY")
