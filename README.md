# IWXA Knowledge - public tooling

This repository contains a publicly reproducible data-only knowledge import, validation, packaging and offline retrieval pilot. It does not contain private IWXA product source. Development uses separate `work/*` branches and no `main` branch.

First source snapshot is preserved in `bootstrap/seed.part*.b64` (XZ-compressed tar of 18 text files). Recover with `python bootstrap/restore_public_source.py --target restored` then run `cd restored && python tools/run_pilot.py --out build`. The restore script checks archive and core SHA-256 and the exact file inventory. This bootstrap stage is a temporary transport: code is to be promoted to ordinary public files after workflow validation.

This is a candidate, **not a production release**. The first reviewer is the building assistant; any independent review belongs to a later stage. No code in the pilot executes imported skills or external agents; no models are invoked.
