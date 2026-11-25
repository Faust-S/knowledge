# D06: grouped T3 qualification

The release gate is triggered ONLY by an explicit commit of
`.github/d06/t3-release-request.json` on `test/2026-11-24-d06-t3-preparation`.
Use the example JSON after checking the exact owner and site revisions.
The example itself is not a request. Increase `attempt` only for a
deliberately requested rerun. Editing source, workflows, or documentation
does not start D06 T3 runners on this branch.

## Release sequence

- Windows: canonical purchase witnesses, pinned assistant/projection and
  upgrade, then the unchanged mandatory `npm run build:static:check`.
  Do not repeat its constituent site checks in a separate Windows job.
- Linux, after the Windows gate succeeds: canonical witnesses and Linux
  targeted checks, original T3 loopback build and offline/native transfer,
  then the two production-origin builds from retained inputs, corruption
  rejection and public assistant smoke.
- One site dependency installation per OS. Preserve distinct HTTPS origins.
- All D06 T3 workflows share one concurrency group on this branch. Running
  work is not canceled; do not issue multiple pending requests.
- Individual diagnostic workflows remain available by explicitly committing
  `.github/d06/diagnostic-requests/<workflow-name>.request` after verifying
  their pinned inputs. Do not trigger a diagnostic while a full release
  request is pending. Updating a diagnostic workflow alone starts no run.
- Real local-model generation, permanent input retention, and independent
  acceptance still require their own evidence. No deployment is authorized.
- No private source/log/dist uploads, and no Actions in private repositories.

This change does not retroactively cancel runs created before the new
concurrency policy. Cancel obsolete queued revisions in the GitHub UI.
Freeze a candidate only after local and already available evidence has
been reviewed. A failed mandatory gate remains a failed qualification.
