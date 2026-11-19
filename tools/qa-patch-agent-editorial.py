"""Disposable editorial witness of the original current Agent. Never commits product modifications."""
from pathlib import Path
import sys
root=Path(sys.argv[1])
p=root/"tools/build_setup_core_windows_candidate.ps1"
s=p.read_text(encoding="utf-8-sig")
needle="# Execute the exact public, product-neutral qualification locally."
assert s.count(needle)==1,"Build stage unavailable"
s=s.replace(needle,"Write-Host 'EDITORIAL_NATIVE_SETUP_BUILT_NO_RELEASE_ACCEPTANCE'\nreturn\n"+needle)
p.with_name("qa-editorial-build.ps1").write_text(s,encoding="utf-8-sig")
p=root/"tools/qualify_setup_core_runtime.ps1"
s=p.read_text(encoding="utf-8-sig")
needle="    $guiDraftSaved=$true\n"
assert s.count(needle)==1,"Native draft receipt changed"
addition="""    $guiDraftSaved=$true
    $take=Join-Path $env:GITHUB_WORKSPACE 'tools/qa-agent-article-photos.ps1'
    $output=Join-Path $env:GITHUB_WORKSPACE 'artifacts/editorial-agent'
    & $take -WindowProcessId $nativeWindow.Id -OutputDir $output
    if($LASTEXITCODE -ne 0){throw 'EDITORIAL_AGENT_GUI_CAPTURE_FAILED'}
    $qualified=[ordered]@{
      status='PASS'
      scope='EDITORIAL_NATIVE_GUI_ONLY'
      nativeGuiDraftReadback=$true
      qwenInference='NOT_RUN'
      completeProductAcceptance='NOT_RUN'
    }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($ResultPath),
      ($qualified|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    Write-Host 'EDITORIAL_AGENT_THREE_NATIVE_GUI_SHOTS_PASS'
    return
"""
s=s.replace(needle,addition)
p.with_name("qa-editorial-gui-witness.ps1").write_text(s,encoding="utf-8-sig")
print("EDITORIAL_AGENT_DISPOSABLE_INSTRUMENTATION_READY")
