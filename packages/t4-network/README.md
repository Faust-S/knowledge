# IWXA T4 Network 0.1.0-rc.1

Release candidate, not a release. Private npm package in the existing IWXA source
composition; do not publish it independently or create a second runtime.

## Build and integration boundary

- Node.js 22.16.0 or newer; locked transport dependency `saxes`.
- Keep `packages/t3-core` and `packages/t4-network` from the **same** admitted
  source tree. The native profile imports the original T3 native relay.
- The integration entry point is `src/network/original-native-host-network-profile.mjs`
  (`createT4OriginalNativeHostNetworkProfile`). Compose it in the existing
  trusted native owner with its original Access, Vault, Registry, topology,
  peer history and Kernel ports; attach its `networkOwner` to that owner's
  single relay and bind its peer-history receiver to the existing authenticated
  channel. The browser UI is not an authority owner.
- Network and extended DB9/multipart profiles require explicit selection.
  No network feature is required for ordinary LOCAL_T3 operation.
- Every fresh recipient observation goes through the original physical frame
  read, not just an index read. The K179 experimental in-wake byte reuse
  is not part of this release candidate.

## Qualification

Run `npm ci --ignore-scripts --no-audit --no-fund` in this package, then
`npm run check`. That check enumerates JS files under src/scripts/tests and
retains Python and independent wire-vector checks. It is not runtime evidence.

The exact candidate must pass addressed integration tests, the original
Kernel/Access/Vault route, Linux/Windows qualification, and a real two-device
pilot before production activation. Existing results for older trees are
historical only. No private source, keys, credentials, or business data belong
in public Actions outputs.

## Scope freeze

No new wire format, storage engine, IAM, scheduler, arbitrary cloud provider
or expanded payload limit in 0.1. Use existing .iwxa Exchange for supported
package transfer and explicit fallback where appropriate; do not silently
downgrade a negotiated session or an unresolved mutation.

The first pilot is one existing Workspace, a designated original write owner,
a second independent recipient, a self-hosted HTTPS/WebDAV location and a
trusted authenticated peer channel. A network outage must not disable local
T3. Unsupported payloads must stop before subject mutation. Independent native
acceptance is still required. T4_READY=false.
