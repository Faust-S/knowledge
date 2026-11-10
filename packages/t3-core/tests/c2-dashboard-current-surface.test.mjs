import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const dashboardRegistry=fileURLToPath(new URL('../src/workspace-host/registries/DashboardRegistry.ts',import.meta.url));
const dashboardFacade=fileURLToPath(new URL('../src/workspace-host/context/create-dashboard-facade.ts',import.meta.url));
const runtimeFactory=fileURLToPath(new URL('../src/workspace-host/runtime/create-workspace-host-runtime.ts',import.meta.url));
const runtimeTypes=fileURLToPath(new URL('../src/workspace-host/runtime/types.ts',import.meta.url));
const dashboardSurface=fileURLToPath(new URL('../src/workspace-host/rendering/HostDashboardSurface.tsx',import.meta.url));
const appShell=fileURLToPath(new URL('../src/shell/AppShell.tsx',import.meta.url));
const baseDashboard=fileURLToPath(new URL('../src/modules/base/dashboard.ts',import.meta.url));

test('C2 dashboard contributions have a current Host-owned render and refresh path',()=>{
  const registry=readFileSync(dashboardRegistry,'utf8');
  const facade=readFileSync(dashboardFacade,'utf8');
  const runtime=readFileSync(runtimeFactory,'utf8');
  const types=readFileSync(runtimeTypes,'utf8');
  const surface=readFileSync(dashboardSurface,'utf8');
  const shell=readFileSync(appShell,'utf8');
  const base=readFileSync(baseDashboard,'utf8');

  assert.ok(registry.includes('visibleEntries('));
  assert.ok(registry.includes('requiredOperations.every'));
  assert.ok(registry.includes('requiredCapabilitiesAll.every'));
  assert.ok(facade.includes('class DashboardRefreshState'));
  assert.ok(facade.includes('subscribe(listener'));
  assert.ok(runtime.includes('new DashboardRefreshState()'));
  assert.ok(runtime.includes('dashboardState,'));
  assert.ok(types.includes('readonly dashboardState: DashboardRefreshState'));
  assert.ok(surface.includes('hostRouteRefs.base.home.id'));
  assert.ok(surface.includes('runtime.hub.dashboard.visibleEntries'));
  assert.ok(surface.includes('runtime.dashboardState.subscribe'));
  assert.ok(surface.includes('DashboardCardBoundary'));
  assert.ok(shell.includes('<HostDashboardSurface />'));
  assert.ok(base.includes('WorkspaceStatusDashboardCard'));
  assert.equal(base.includes('placeholderLoader'),false);
});
