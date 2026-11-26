# T4 Home Lab 0.2 — Fau2 integration overlay

Status: DEVELOPMENT / NOT_DEPLOYED. Base: 8d853387ba279df162aed3365ce521d7c00a455c. The 0.1 README is the guest bootstrap reference, not a host installation procedure for Fau2.

## Decisions
- Dedicated Ubuntu guest under KVM/libvirt on the personal server; no duplicate T3/T4 Kernel, IAM, Store or wire format.
- Guest named iwxa-t4-test, autostart disabled. Initial budget 2 vCPU, 6 GiB RAM, 80 GiB bounded virtual disk; confirm capacity and limits on actual host. No host filesystem shares, USB passthrough, docker socket or personal credentials.
- Keep Keycloak and its identity_test PostgreSQL inside the guest. Domain databases and domain APIs belong to hosting infrastructure; use separate TEST environments and API authentication over verified HTTPS. No production credentials or direct SQL access from guest. Do not replace original domain persistence contracts merely to fit a hosting tariff.
- P0 uses existing .iwxa.test names and local CA in the guest, preserving issuer and original WebDAV. Dedicated isolated routed network with explicit allowlist from test clients and host admin; deny guest access to personal LAN, IoT, host management and host services. Allow only necessary DNS/time and approved outbound endpoints. NAT/bridge alone is not isolation. Verify both directions, including IPv6 and Docker rules.
- No WAN forwarding to guest. Public demonstration is a separate opt-in stage: host reverse proxy with exact approved hostnames and paths, upstream certificate verification, independent authentication, no guest admin exposure. Do not publish existing LAN-only Apache profile through a proxy blindly: source-IP ACL changes meaning. Real OIDC issuer/redirect/certificate/backchannel changes require fresh test realm and explicit profile qualification; no runtime string replacement.
- P0 must work without Keycloak. Production domains must not depend on the on-demand test issuer.
- External backup target independent of VM storage; guest database-consistent dumps, original Vault/Kernel recovery materials, WebDAV, config and keys. Never treat a running disk snapshot alone as application-consistent backup.

## Lifecycle
After Codex provisions and qualifies the VM, run locally as authorized administrator:
```sh
sudo virsh --connect qemu:///system autostart iwxa-t4-test --disable
sudo python3 labctl.py status
sudo python3 labctl.py start
sudo python3 labctl.py stop
```
Install labctl.py from reviewed commit into a root-owned non-writable directory before sudo execution. No browser endpoint with shell access. VM state running is not application readiness; separately verify guest health, TLS, WebDAV and selected IdP profile. Before shutdown stop test workloads and new submissions, confirm in-flight operations finished or recoverable, then request graceful guest shutdown. Timeout requires diagnosis; never automatically destroy VM. Guest shutdown and NUT host shutdown ordering must be tested. Persistent data must survive cold restart. Lifecycle lock only serializes this tool; other libvirt administrators must not race it.

## Checkpoints
1. Host and storage inventory, separate clean guest, disabled autostart; verify resource limits and disk reserve.
2. Network negative tests from WAN, home LAN and guest, approved clients can reach only permitted routes. No exposure of 5432, 18080, admin or host control.
3. Run original P0 and identity qualification inside guest; actual Docker images, real PostgreSQL, Keycloak discovery, two accounts and two clients.
4. Original T4 on two independent devices: transfer, readback, restart, revocation, partition/recovery. Diagnostic SSO pages are not domain integration.
5. Optional external TEST API on hosting: issuer/audience, actor binding, original Access, separate domain DB roles, no cross-domain access.
6. Graceful start/stop, cold host reboot with guest off, home services remain available under load and shutdown. Test UPS and recovery separately.
7. If needed, separately design and qualify externally reachable demonstration profile. No public route by default.

## Verification
labctl.py: 12/12 local Python unit tests using injected virsh responses (state transitions, timeout, failure, disabled autostart). Real libvirt, network setup, actual VM, UPS, Keycloak, hosting integration and public demonstration NOT_RUN. No claims of physical deployment or T4 readiness. No GitHub Actions invoked.
