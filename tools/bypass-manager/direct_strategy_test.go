package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDirectStrategySpecificHostABSelectionWithoutRestart(t *testing.T) {
	dir := t.TempDir()
	list := filepath.Join(dir, "direct-alternative-hosts.txt")
	journal := directTrialJournal(list)
	if err := writeDirectAlternative(list, []string{"stable.net"}); err != nil { t.Fatal(err) }
	const chosen = "newly-blocked.org"
	n := 0
	ready := func() bool { return true }
	probe := func(_ context.Context, host string) string {
		if host != chosen { t.Fatal("wrong candidate") }
		n++
		if hosts, err := readDirectAlternative(list); err != nil { t.Fatal(err) } else if directContainsHost(hosts, chosen) {
			return "TLS_CONFIRMED"
		}
		return "TLS_FAILED"
	}
	report, err := trialDirectAlternative(context.Background(), chosen, list, probe, ready, func(context.Context) error {
		b, err := os.ReadFile(journal)
		if err != nil || strings.TrimSpace(string(b)) != chosen { t.Fatal("missing crash journal") }
		return nil
	})
	if err != nil || report.State != "ALTERNATIVE_TLS_CANDIDATE" || !report.Retained || report.EffectVerified ||
		report.BaselineFailures != 2 || report.AlternativeSuccesses != 2 || n != 4 {
		t.Fatalf("failed live A/B %+v err=%v n=%d", report, err, n)
	}
	hosts, err := readDirectAlternative(list)
	if err != nil || len(hosts) != 2 || hosts[0] != "stable.net" || hosts[1] != chosen { t.Fatal(hosts, err) }
	if _, err := os.Lstat(journal); !errors.Is(err, os.ErrNotExist) { t.Fatal("trial journal remained") }
	if !validDirectStrategyReport(report) { t.Fatal("valid report rejected") }
	raw, _ := os.ReadFile(list)
	if strings.Contains(report.Caveat, chosen) || strings.Contains(report.State, chosen) { t.Fatal("private hostname leaked into shareable report") }
	if len(raw) == 0 { t.Fatal("selected host not persisted") }
}

func TestDirectStrategyFailedAltRestoresOnlyProvisionalHost(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "direct-alternative-hosts.txt")
	if err := writeDirectAlternative(file, []string{"kept.example.org"}); err != nil { t.Fatal(err) }
	probe := func(ctx context.Context, host string) string {
		if contains, _ := readDirectAlternative(file); directContainsHost(contains, host) { return "TLS_FAILED" }
		return "TCP_FAILED"
	}
	r, err := trialDirectAlternative(context.Background(), "candidate.example.net", file, probe, func() bool { return true }, func(context.Context) error { return nil })
	if err != nil || r.State != "ALTERNATIVE_REVERTED" || r.Retained { t.Fatal(r, err) }
	hosts, err := readDirectAlternative(file)
	if err != nil || len(hosts) != 1 || hosts[0] != "kept.example.org" { t.Fatal(hosts, err) }
	if _, err := os.Stat(directTrialJournal(file)); !errors.Is(err, os.ErrNotExist) { t.Fatal("rollback journal remained") }
}

func TestDirectStrategyInterruptedAfterLiveChangeRollsBack(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "direct-alternative-hosts.txt")
	ready := true
	probe := func(context.Context, string) string { return "TLS_FAILED" }
	r, err := trialDirectAlternative(context.Background(), "site.net", file, probe, func() bool { return ready },
		func(context.Context) error { ready = false; return nil })
	if err != nil || r.State != "TRIAL_CANCELLED" { t.Fatal(r, err) }
	hosts, err := readDirectAlternative(file)
	if err != nil || len(hosts) != 0 { t.Fatal(hosts, err) }
	if _, err := os.Stat(directTrialJournal(file)); !errors.Is(err, os.ErrNotExist) { t.Fatal("pending file not removed") }
}

func TestDirectStrategyRefusesDNSAndInconclusiveBaselines(t *testing.T) {
	for _, first := range []string{"DNS_UNAVAILABLE", "NOT_PUBLIC", "TLS_CONFIRMED"} {
		file := filepath.Join(t.TempDir(), "alternative.txt")
		calls := 0
		r, err := trialDirectAlternative(context.Background(), "service.net", file,
			func(context.Context, string) string { calls++; return first }, func() bool { return true }, func(context.Context) error { return nil })
		if err != nil || r.Retained || calls != 1 { t.Fatal(first, r, err) }
		if _, err := os.Stat(directTrialJournal(file)); !errors.Is(err, os.ErrNotExist) { t.Fatal("unexpected journal") }
	}
}

func TestDirectStrategyCrashRecoveryPreservesExistingChoices(t *testing.T) {
	file := filepath.Join(t.TempDir(), "alternative.txt")
	if err := writeDirectAlternative(file, []string{"old.com", "interrupted.net"}); err != nil { t.Fatal(err) }
	if err := writeDirectPrivateFile(directTrialJournal(file), []byte("interrupted.net\n")); err != nil { t.Fatal(err) }
	recovered, err := recoverDirectStrategyTrial(file)
	if err != nil || !recovered { t.Fatal(recovered, err) }
	hosts, err := readDirectAlternative(file)
	if err != nil || len(hosts) != 1 || hosts[0] != "old.com" { t.Fatal(hosts, err) }
	recovered, err = recoverDirectStrategyTrial(file)
	if err != nil || recovered { t.Fatal("recovery not idempotent") }
}

func TestDirectStrategyFromAutoListOnlyAndPrivateSupport(t *testing.T) {
	dir := t.TempDir()
	learned := filepath.Join(dir, "direct-auto-hosts.txt")
	alternative := filepath.Join(dir, "direct-alternative-hosts.txt")
	if err := os.WriteFile(learned, []byte("# private learned\nnot.local\nfirst.net\nsecond.org\n"), 0600); err != nil { t.Fatal(err) }
	if err := writeDirectAlternative(alternative, []string{"second.org"}); err != nil { t.Fatal(err) }
	seen := map[string]bool{}
	h, err := nextDirectStrategyHost(learned, alternative, seen)
	if err != nil || h != "first.net" { t.Fatal(h, err) }
	h, err = nextDirectStrategyHost(learned, alternative, seen)
	if err != nil || h != "" { t.Fatal(h, err) }
	if err := saveJSON(filepath.Join(dir, "latest-direct-strategy.json"), newDirectStrategyReport("BASELINE_OK")); err != nil { t.Fatal(err) }
	bundle := buildSupportReport(dir, time.Now())
	if bundle.DirectStrategy == nil || bundle.DirectStrategy.State != "BASELINE_OK" { t.Fatal("strategy report missing") }
	b, _ := os.ReadFile(filepath.Join(dir, "latest-direct-strategy.json"))
	for _, secret := range []string{"first.net", "second.org", "not.local"} {
		if strings.Contains(string(b), secret) { t.Fatal("host leaked", secret) }
	}
	report := newDirectStrategyReport("ALTERNATIVE_TLS_CANDIDATE")
	report.Retained = true
	if !validDirectStrategyReport(report) { t.Fatal("retained status rejected") }
	report.State = "https://private-domain.example"
	if validDirectStrategyReport(report) { t.Fatal("host name state accepted") }
}

func TestDirectStrategyScriptHasPriorityAndSafeEmptyList(t *testing.T) {
	s, err := embedded.ReadFile("runtime/Scripts/Start-Direct.ps1")
	if err != nil { t.Fatal(err) }
	text := string(s)
	alt := strings.Index(text, "--hostlist=$alternate")
	auto := strings.Index(text, "--hostlist-auto=$hosts")
	sentinel := strings.Index(text, "--hostlist-domains=iwxa-never-match.invalid")
	newProfile := strings.Index(text, "'--new'")
	if sentinel < 0 || alt <= sentinel || auto <= alt || newProfile <= alt || newProfile >= auto ||
		!strings.Contains(text, "--lua-desync=multidisorder:pos=1,midsld") {
		t.Fatal("alternative profile not first or empty-list fallback is unsafe")
	}
}
