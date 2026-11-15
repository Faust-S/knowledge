# Compiles the exact raw filter using the ORIGINAL WinDivert.dll helper without loading driver.
[CmdletBinding()]
param([string]$BundleRoot='C:\BypassManager\engine',
      [Parameter(Mandatory=$true)][string]$EndpointIPv4,
      [Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port,
      [ValidateSet('TCP','UDP')][string]$Transport='TCP')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '..\runtime\Scripts\Common.psm1') -Force
[void](Assert-IPv4 $EndpointIPv4)
$dll=[System.IO.Path]::GetFullPath((Join-Path $BundleRoot 'WinDivert.dll'))
if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) {throw "WinDivert.dll missing at $dll"}
if ($dll.Contains('"')) { throw 'Unusual DLL path quoting is not supported.' }
# Use the SAME production builder as Start-Profile.ps1.
$filter=Get-ExactWinDivertFilter -EndpointIPv4 $EndpointIPv4 -Port $Port -Transport $Transport
# DllImport absolute path is used to avoid searching untrusted DLL locations.
$typeName='BypassWinDivertCompile' + [guid]::NewGuid().ToString('N')
$cs=@"
using System;
using System.Runtime.InteropServices;
public static class $typeName {
    [DllImport(@"$dll", CallingConvention=CallingConvention.Cdecl, EntryPoint="WinDivertHelperCompileFilter")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool Compile([MarshalAs(UnmanagedType.LPStr)] string filter, uint layer,
        IntPtr obj, uint objLen, out IntPtr errorStr, out uint errorPos);
}
"@
$t=Add-Type -TypeDefinition $cs -Language CSharp -PassThru -ErrorAction Stop
$errPtr=[IntPtr]::Zero
[uint32]$errPos=0
$args=[object[]]@($filter,[uint32]0,[IntPtr]::Zero,[uint32]0,$errPtr,$errPos)
$ok=[bool]($t.GetMethod('Compile').Invoke($null,$args))
if(-not $ok){
    $message=[Runtime.InteropServices.Marshal]::PtrToStringAnsi([IntPtr]$args[4])
    throw "WinDivert raw filter invalid at offset $($args[5]): $message : $filter"
}
Write-Host "PASS: original WinDivert.dll compiled exact $Transport filter for $EndpointIPv4`:$Port without opening a driver handle."
Write-Host $filter
