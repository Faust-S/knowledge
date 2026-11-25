# D07 qualification requests

On the pipeline foundation branch, ordinary D07 source and workflow maintenance
does not enqueue a qualification. The pinned revisions in each workflow remain
the authority for reproducible checkouts.

- Develop and exercise the changed mechanisms locally first. Batch changes into
  one coherent release candidate before updating both pinned revisions.
- To request the full D07 qualification, explicitly update
  `d07-t3-release-request.json` (candidate identifier and reason) in this
  directory, or dispatch the integration workflow when available.
- Request the Linux/Windows portability matrix separately using
  `d07-t3-portability-request.json` only for platform-sensitive changes or a
  release milestone. Do not trigger both after every source edit.
- Wait for existing D07 qualifications to finish before requesting another.
  Never cancel a private publication in progress or weaken a failing gate.
- The release qualification compares two complete isolated builds of the same
  final manifest, direct and via the actual ordinary npm entrypoint. It still
  rejects corrupt retained inputs, audits every offline resource and checks
  private retention and fresh checkout independently.

No private artifacts or source belong in these request files. Do not update a
request marker until the exact pinned candidate is ready. The workflow checks,
not the request marker, determine qualification status.

## Select the smallest useful qualification

A release request first checks the exact private branch and the existing
DOMEN transport. A failure skips both the expensive source and integrated
jobs; it cannot result in private retention. A successful preflight retains
all previous source, isolated byte comparison, corruption, HTTP and fresh
checkout gates. A source or build result is never product acceptance.

Where manual workflow dispatch is available, the same integration workflow
accepts four explicit modes:

- `transport-only`: exact private receive-pack probe, no source/build jobs.
- `source-only`: source qualification, no full integration and no publication.
- `build-only`: source plus full original-platform build qualification,
  without private publication or retained checkout claim.
- `release` (default and all release-marker pushes): all gates and authorized
  private retention/readback of the exact qualified bytes.

Use transport-only to investigate a changed credential rather than repeating
an entire release. Do not request additional jobs merely to repeat evidence.
The local and CI release procedures use the same final-manifest transform;
both compare one direct and one real npm-dispatched ordinary build.
