# Exact original Kernel candidate staging

Qualification 45596499435 proved source revision 4e4ad5c5e566a74f24243b9d0744a6d64652a199 on Windows and Linux, including 43 source regressions and two actual runtime cross-product checks on each OS. The four build hashes matched on both platforms. The private direct successor c28e01876f3230307b7f20449f7ef54374367c93 adds only deterministic candidate ZIP staging and its eleven tests.

The ci(stage): push prefix selects one Linux job. It checks exact source ancestry and changed paths, reconstructs and builds the original candidate, checks all pinned bytes and runs the archive tests, then stages the private candidate archive and emits only its immutable identity and digest. Previously passed source and cross-product evidence is reused only for that identical source. No archive, private source, credentials or raw evidence is uploaded.

The archive is explicitly unaccepted. No product may relabel it as the previous accepted artifact. Candidate admission and installed GUI qualification remain separate gates. Other pushes retain the complete two-platform source/runtime witness.
