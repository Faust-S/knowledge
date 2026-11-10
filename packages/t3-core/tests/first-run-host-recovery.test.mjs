/**
 * Regression: first-run failure must never hide the ordinary Kernel retry and
 * T2 Capability Control Plane diagnostics owned by the Host chrome.
 * Uses built-in Node tools only, so it is usable before npm install.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const app = readFileSync(fileURLToPath(new URL('../src/shell/AppShell.tsx',import.meta.url)),'utf8');
function between(from,to) {
 const a=app.indexOf(from), b=app.indexOf(to,a+from.length);
 assert.ok(a>=0&&b>a,'Expected ordered shell anchors: '+from+', '+to);
 return app.slice(a,b);
}
test('First-Run Workspace gate wraps only workspace content, never HostShellContent',()=>{
 const appReturn=between('<DomainShellProvider','</DomainShellProvider>');
 assert.match(appReturn,/<AppShellRuntimeBridge[\s\S]*<HostShellContent/);
 assert.doesNotMatch(appReturn,/<FirstRunWorkspaceGate/);
});
test('Kernel retry header, action bar and diagnostics remain outside first-run gate',()=>{
 const shellBody=app.slice(app.indexOf('function HostShellContent'));
 const header=shellBody.indexOf('<Header');
 const gate=shellBody.indexOf('<FirstRunWorkspaceGate');
 const dashboard=shellBody.indexOf('<HostDashboardSurface');
 const outlet=shellBody.indexOf('<ModuleRouteOutlet');
 const endGate=shellBody.indexOf('</FirstRunWorkspaceGate>');
 const action=shellBody.indexOf('<ActionBar');
 const diagnostics=shellBody.indexOf('<ConfigurationDiagnosticsPanel');
 assert.ok(header>=0&&gate>header&&dashboard>gate&&outlet>dashboard&&endGate>outlet);
 assert.ok(action>endGate&&diagnostics>action);
});
test('Host uses real kernel session and domain configuration for scoped gate',()=>{
 assert.match(app,/<FirstRunWorkspaceGate[\s\S]*session=\{session\}[\s\S]*domain=\{hostDomain\}/);
 assert.match(app,/workspaceServiceId=\{hostWorkspace\.workspace_service_id\}/);
 assert.match(app,/devBootstrap=\{devBootstrap\}/);
});
