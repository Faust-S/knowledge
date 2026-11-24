#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
transport="$here/d07-private-git-transport.sh"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
check(){
 printf '%s\n' "$1" > "$temp/message"
 [[ "$(bash "$transport" classify "$temp/message")" == "$2" ]]
}
check 'remote: GH001: Large files detected.' FILE_SIZE
check 'remote: GH013: Repository rule violations found.' BRANCH_RULE
check 'rejected non-fast-forward' HEAD_CONFLICT
check 'fatal: Authentication failed' AUTHENTICATION
check 'remote: Write access to repository not granted. HTTP 403' WRITE_PERMISSION
check 'remote: Repository not found.' REPOSITORY_ACCESS
check 'fatal: Could not resolve host' NETWORK
check 'unexpected private details never printed' UNCLASSIFIED
echo D07_T3_TRANSPORT_CLASSIFICATION=8/8
