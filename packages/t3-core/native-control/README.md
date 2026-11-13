# IWXA T3 Control: Windows WebView2 window

This is the **native window of the existing T3 Host**, not a second
Kernel/Store/IAM/Workspace implementation. No network account or model is
required to show its disconnected state.

The trusted local Node Host starts the compiled EXE with a private stdin pipe,
writes exactly the result of `host.signedWorkspaceLaunchUrl() + "\\n"`
and closes stdin. The EXE never accepts a bearer through argv, environment,
disk, public URL or JavaScript IPC. It opens only the original signed Workspace
on the Host-pinned loopback origin, denies navigation to other top-level
origins, new windows and privileged WebView2 permission requests.

No local Test issuer, private key, grant, status cache, new Kernel or .iwxa
parser is bundled into this window. The native app by itself shows
"Подписанный локальный Host не подключён" rather than faking access.

Build on Windows in the public `knowledge` Actions. Before invoking cargo,
copy the existing `packages/t3-core/public/favicon.ico` into
`native-control/src-tauri/icons/icon.ico`. Build with:
`cargo build --release --manifest-path native-control/src-tauri/Cargo.toml`.
The Windows EXE is a **native candidate**, not the product installer.

Remaining: package the same original Host + one-dist alongside the EXE using
the approved IWXA Setup Core, connect a real signed Windows issuer and OS vault
to the trusted Control callbacks, run PERSONAL + two organizations/Result/.iwxa,
and qualify the installed GUI/two cold restarts. Until then:
`D1_INSTALLED_WINDOWS_CONTROL=NOT_ACCEPTED`,
`T3_READY=false`, `G4=NOT_ACCEPTED`.
