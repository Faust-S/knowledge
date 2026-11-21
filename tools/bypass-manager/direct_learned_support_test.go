package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// The native CLI dry-run validates the original engine on Windows CI.
// This guard also ensures the actual embedded filter did not silently lose
// the server replies needed for auto-hostlist failure classification.
func TestDirectAutoHostlistNativeFilterReceivesServerTLS(t *testing.T) {
	source, err := embedded.ReadFile("runtime/Scripts/Start-Direct.ps1")
	if err != nil { t.Fatal(err) }
	match := regexp.MustCompile("(?m)\\$raw='([^']+)'").FindSubmatch(source)
	if len(match) != 2 { t.Fatal("native Windows filter not found") }
	filter := string(match[1])
	for _, clause := range []string{
		"outbound&&tcp.DstPort==443&&(tcp.PayloadLength>0||tcp.Syn||tcp.Fin||tcp.Rst)",
		"inbound&&tcp.SrcPort==443&&(tcp.PayloadLength>0||tcp.Syn||tcp.Fin||tcp.Rst)",
	} {
		if !strings.Contains(filter, clause) { t.Fatalf("hostlist sees only one direction: missing %s", clause) }
	}
	if strings.Contains(strings.ToLower(filter), "udp.") || strings.Contains(filter, "DstPort==80") {
		t.Fatal("unexpected additional protocol interception")
	}
}

func TestDirectLearnedSupportExportsOnlyAggregateResults(t *testing.T) {
	root := t.TempDir()
	r := DirectLearnedReport{SchemaVersion:"1.0",CheckedUTC:utc(),State:"TLS_SAMPLED",Learned:3,Probed:2,TLSConfirmed:1,TLSFailed:1,Caveat:directLearnedCaveat}
	if err:=saveJSON(filepath.Join(root,"latest-direct-learned.json"),r);err!=nil {t.Fatal(err)}
	support:=buildSupportReport(root,time.Now())
	if support.DirectLearned==nil || support.DirectLearned.Probed!=2 { t.Fatal("aggregate missing") }
	p,_,err:=saveSupport(root);if err!=nil {t.Fatal(err)}
	b,err:=os.ReadFile(p);if err!=nil {t.Fatal(err)}
	for _,secret:=range []string{"example.org","private.example","direct-auto-hosts.txt","192.168.1.1"} {
		if strings.Contains(string(b),secret){t.Fatalf("private field in shareable report: %s",secret)}
	}
	if err:=os.WriteFile(filepath.Join(root,"latest-direct-learned.json"),[]byte("{\"schema_version\":\"1.0\",\"state\":\"TLS_SAMPLED\",\"host\":\"private.example.org\"}"),0600);err!=nil {t.Fatal(err)}
	invalid:=buildSupportReport(root,time.Now())
	if invalid.DirectLearned!=nil {t.Fatal("invalid host field was exported")}
}
