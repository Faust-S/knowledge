"""Retain only verified D01 assembly inputs in the same authorized private repo.
No public plaintext/ciphertext handoff, workflow artifact, new token or force push.
A read-only CI credential is an explicit blocker, not a reason to widen access.
"""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

REPO = "Faust-S/learn.iwxa.ru"
URL = "https://github.com/" + REPO + ".git"
ROOT = Path.cwd()
PIN = Path("runtime/t3-platform/0.3.1-rc.1")
ARCHIVE = PIN / "platform-inputs.zip"
HOST = PIN / "learn-host"
HEAD = os.environ["D01_SITE_REVISION"]
TOKEN = os.environ.pop("D01_SITE_TOKEN", "")
BASE_ENV = dict(os.environ, GIT_TERMINAL_PROMPT="0")
BASE_ENV.pop("GIT_TRACE", None)
BASE_ENV.pop("GIT_CURL_VERBOSE", None)

def require(ok, code):
    if not ok:
        raise ValueError(code)

def git(*args, auth=False, allow_empty=False):
    env = dict(BASE_ENV)
    if auth:
        basic = base64.b64encode(("x-access-token:" + TOKEN).encode()).decode()
        env.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
                   GIT_CONFIG_VALUE_0="AUTHORIZATION: basic " + basic)
    result = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", *args],
                            cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Report the failed command and a fixed category, never the raw output,
        # token, private file names or remote response details.
        command = next((x for x in args if x in {"rev-parse", "ls-remote", "add", "diff", "hash-object", "write-tree", "commit-tree", "push", "reset"}), "other")
        err = result.stderr.decode("utf-8", errors="replace").lower()
        category = ("ACCESS_DENIED" if any(x in err for x in ("403", "permission denied", "authentication failed", "write access", "not authorized", "repository not found")) else
                    "FILE_SIZE_LIMIT" if any(x in err for x in ("file size limit", "large files detected", "gh001", "exceeds")) else
                    "REPOSITORY_POLICY" if any(x in err for x in ("protected branch", "repository rule", "gh013", "pre-receive hook declined")) else
                    "IGNORED_INPUT" if "ignored" in err else
                    "SHALLOW_HISTORY" if "shallow" in err else
                    "TRANSPORT" if any(x in err for x in ("rpc failed", "http/2", "connection", "could not resolve", "remote end hung up", "timed out")) else
                    "OTHER")
        raise ValueError("GIT_" + command.upper().replace("-", "_") + "_" + category)
    out = result.stdout
    require(allow_empty or bool(out.strip()), "EMPTY_GIT_RESULT")
    return out

def main():
    require(re.fullmatch(r"[a-f0-9]{40}", HEAD), "BAD_SITE_REVISION")
    require(git("rev-parse", "HEAD").decode().strip() == HEAD, "SITE_HEAD_MISMATCH")
    require(bool(TOKEN), "NO_EXISTING_CREDENTIAL")
    req = urllib.request.Request("https://api.github.com/repos/" + REPO,
        headers={"Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json"})
    # Only use the credential for its existing granted private-repository access.
    with urllib.request.urlopen(req, timeout=20) as response:
        meta = json.load(response)
    require(meta.get("private") is True and meta.get("full_name") == REPO, "NOT_EXACT_PRIVATE_REPOSITORY")
    if meta.get("permissions", {}).get("push") is not True:
        print("D01_PRIVATE_RETENTION=BLOCKED_READ_ONLY_CREDENTIAL")
        return
    require(ARCHIVE.is_file() and HOST.is_dir(), "RETAINED_INPUTS_MISSING")
    expected = [ARCHIVE] + [p for p in HOST.rglob("*") if p.is_file()]
    require(len(expected) > 2, "EMPTY_HOST")
    for path in expected:
        require(not path.is_symlink() and path.stat().st_size < 95 * 1024 * 1024, "UNSUPPORTED_INPUT_FILE")
    for path in HOST.rglob("*"):
        require(not path.is_symlink() and (path.is_file() or path.is_dir()), "UNSUPPORTED_INPUT_ENTRY")
    names = {str(p).replace(os.sep, "/") for p in expected}
    # The public runner never changes the live work branch or main. The only
    # new commit is a child of the exact qualified private source revision.
    ref = "refs/heads/inputs/learn-t3/" + HEAD
    existing = git("ls-remote", URL, ref, auth=True, allow_empty=True)
    if existing.strip():
        print("D01_PRIVATE_RETENTION=EXISTING_SNAPSHOT_REQUIRES_READBACK")
        return
    git("add", "--", str(ARCHIVE), str(HOST), allow_empty=True)
    try:
        changed = {x.decode() for x in git("diff", "--cached", "--name-only", "-z", allow_empty=True).split(b"\0") if x}
        require(changed == names, "STAGED_PATH_SCOPE_MISMATCH")
        # Verify that Git will retain the exact previously qualified bytes.
        for path in sorted(names):
            index_blob = git("rev-parse", ":" + path).decode().strip()
            disk_blob = git("hash-object", "--no-filters", "--", path).decode().strip()
            require(index_blob == disk_blob, "STAGED_BYTES_MISMATCH")
        tree = git("write-tree").decode().strip()
        commit = git("-c", "user.name=IWXA retained input qualification",
                     "-c", "user.email=qualification@iwxa.invalid",
                     "commit-tree", tree, "-p", HEAD, "-m",
                     "Retain the exact qualified Learn T3 build inputs [skip ci]").decode().strip()
        require(re.fullmatch(r"[a-f0-9]{40}", commit), "BAD_RETAINED_COMMIT")
        git("push", URL, commit + ":" + ref, auth=True, allow_empty=True)
        remote = git("ls-remote", URL, ref, auth=True).decode().split()
        require(remote == [commit, ref], "PRIVATE_REF_READBACK_MISMATCH")
        print("D01_PRIVATE_RETENTION=PASS")
        print("D01_PRIVATE_RETAINED_COMMIT=" + commit)
        print("D01_PRIVATE_RETAINED_FILES=" + str(len(names)))
    finally:
        git("reset", "--mixed", HEAD, allow_empty=True)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        # Never expose request details, credentials or private file names.
        if not re.fullmatch(r"[A-Z_]{3,100}", code):
            code = type(error).__name__
        print("D01_PRIVATE_RETENTION=FAIL:" + code)
        raise SystemExit(1)
