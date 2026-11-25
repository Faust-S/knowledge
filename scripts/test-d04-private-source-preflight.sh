#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "$0")" && pwd)"
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
mkdir "$root/bin" "$root/temp"
export RUNNER_TEMP="$root/temp" PATH="$root/bin:$PATH" MOCK_CALLS="$root/calls"
cat > "$root/bin/gh" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$2" >> "$MOCK_CALLS"
count="$(wc -l < "$MOCK_CALLS")"
case "$MOCK_MODE" in
  retry) if [ "$count" -gt 2 ]; then echo 123; exit 0; fi; printf 'hidden-fixture HTTP 503\n' >&2;;
  denied) printf 'hidden-fixture HTTP 403\n' >&2;;
  unknown) printf 'hidden-fixture transport failure\n' >&2;;
  *) echo 123; exit 0;;
esac
exit 1
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$root/bin/sleep"
chmod +x "$root/bin/gh" "$root/bin/sleep"
check(){
  local label="$1" mode="$2" token="$3" expected="$4" calls="$5" needle="$6"
  : > "$MOCK_CALLS"
  local out status=0
  out="$(MOCK_MODE="$mode" GH_TOKEN="$token" bash "$here/d04-private-source-preflight.sh" D04_TEST Faust-S/bazmed.ru Faust-S/T2)" || status=$?
  test "$status" -eq "$expected"
  test "$(wc -l < "$MOCK_CALLS")" -eq "$calls"
  grep -Fq "$needle" <<< "$out"
  if grep -Fq 'hidden-fixture' <<< "$out" || grep -Fq 'token-fixture' <<< "$out"; then exit 1; fi
  test -z "$(find "$RUNNER_TEMP" -mindepth 1 -print -quit)"
  printf '%s=PASS\n' "$label"
}
check absent ok '' 1 0 'D04_TEST=UNAVAILABLE'
check permitted ok token-fixture 0 2 'D04_TEST=PASS'
check transient retry token-fixture 0 4 'status=HTTP 503'
check persistent denied token-fixture 1 4 'D04_TEST=DENIED repo=Faust-S/bazmed.ru'
check transport unknown token-fixture 1 4 'status=UNKNOWN'
