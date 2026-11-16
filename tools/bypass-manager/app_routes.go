package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Raw local-only process information must never be copied to the shareable report.
// A bound TCP source address is evidence of an interface, not proof of the
// application's public egress, especially with split tunnels and local proxies.
type AppSocketLocal struct {
	Name          string `json:"name"`
	Category      string `json:"category"`
	VPNBound      int    `json:"vpn_bound"`
	PhysicalBound int    `json:"physical_bound"`
	Loopback      int    `json:"loopback"`
	Uncertain     int    `json:"uncertain"`
	UDPBound      int    `json:"udp_bound"`
}

type AppSocketCapture struct {
	SchemaVersion string           `json:"schema_version"`
	Checked       bool             `json:"checked"`
	TCPChecked    bool             `json:"tcp_checked"`
	UDPChecked    bool             `json:"udp_checked"`
	Programs      []AppSocketLocal `json:"programs"`
	// Count fields include all observed processes, including beyond the local
	// display list; no process identifier or remote IP is ever exported.
	ProcessCount  int `json:"process_count"`
	VPNBound      int `json:"vpn_bound"`
	PhysicalBound int `json:"physical_bound"`
	Loopback      int `json:"loopback"`
	Uncertain     int `json:"uncertain"`
	UDPBound      int `json:"udp_bound"`
}

type AppCategoryCount struct {
	Category      string `json:"category"`
	Processes     int    `json:"processes"`
	VPNBound      int    `json:"vpn_bound"`
	PhysicalBound int    `json:"physical_bound"`
	Uncertain     int    `json:"uncertain"`
	UDPBound      int    `json:"udp_bound"`
}

type AppAudit struct {
	SchemaVersion string             `json:"schema_version"`
	CompletedUTC  string             `json:"completed_utc"`
	State         string             `json:"state"`
	TCPChecked    bool               `json:"tcp_checked"`
	UDPChecked    bool               `json:"udp_checked"`
	ProcessCount  int                `json:"process_count"`
	VPNBound      int                `json:"vpn_bound"`
	PhysicalBound int                `json:"physical_bound"`
	Loopback      int                `json:"loopback"`
	Uncertain     int                `json:"uncertain"`
	UDPBound      int                `json:"udp_bound"`
	Categories    []AppCategoryCount `json:"categories"`
	Findings      []string           `json:"findings"`
	Caveat        string             `json:"caveat"`
}

const appAuditCaveat = "Active TCP local binding only, not per-app public IP or VPN tunnel proof. UDP endpoint inventory does not expose remote destination. Proxy, browser extension, local relay and split tunneling may change effective egress. Read-only; process names and addresses are never exported."

var safeProcessName = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

func parseAppSocketCapture(b []byte) (AppSocketCapture, error) {
	var c AppSocketCapture
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return AppSocketCapture{}, errors.New("invalid app inventory")
	}
	var more any
	if d.Decode(&more) != io.EOF {
		return AppSocketCapture{}, errors.New("extra app inventory content")
	}
	if c.SchemaVersion != "0.3.4" || !c.Checked || !c.TCPChecked || c.ProcessCount < 0 || c.ProcessCount > 100000 || len(c.Programs) > 2500 {
		return AppSocketCapture{}, errors.New("invalid app inventory header")
	}
	for _, n := range []int{c.VPNBound, c.PhysicalBound, c.Loopback, c.Uncertain, c.UDPBound} {
		if n < 0 || n > 100000 {
			return AppSocketCapture{}, errors.New("invalid app inventory total")
		}
	}
	if len(c.Programs) > c.ProcessCount {
		return AppSocketCapture{}, errors.New("invalid program count")
	}
	for i := range c.Programs {
		p := &c.Programs[i]
		if !safeProcessName.MatchString(p.Name) {
			p.Name = "[hidden]"
		}
		if p.Category != "BROWSER" && p.Category != "VPN_CLIENT" && p.Category != "OTHER" {
			return AppSocketCapture{}, errors.New("invalid app category")
		}
		for _, n := range []int{p.VPNBound, p.PhysicalBound, p.Loopback, p.Uncertain, p.UDPBound} {
			if n < 0 || n > 100000 {
				return AppSocketCapture{}, errors.New("invalid app counts")
			}
		}
	}
	return c, nil
}

func summarizeAppSockets(c AppSocketCapture, now time.Time) AppAudit {
	a := AppAudit{SchemaVersion: "0.3.4", CompletedUTC: now.UTC().Format(time.RFC3339), State: "OBSERVED_NOT_VERIFIED", TCPChecked: c.TCPChecked, UDPChecked: c.UDPChecked, ProcessCount: c.ProcessCount, VPNBound: c.VPNBound, PhysicalBound: c.PhysicalBound, Loopback: c.Loopback, Uncertain: c.Uncertain, UDPBound: c.UDPBound, Findings: []string{}, Categories: []AppCategoryCount{}, Caveat: appAuditCaveat}
	if !c.UDPChecked {
		a.Findings = append(a.Findings, "UDP_INVENTORY_UNAVAILABLE")
	}
	if c.PhysicalBound > 0 {
		a.Findings = append(a.Findings, "PHYSICAL_BINDING_OBSERVED")
	}
	if c.VPNBound > 0 {
		a.Findings = append(a.Findings, "VPN_BINDING_OBSERVED_NOT_PROOF")
	}
	if c.Uncertain > 0 {
		a.Findings = append(a.Findings, "PROCESS_ROUTE_UNCERTAIN")
	}
	if c.ProcessCount == 0 {
		a.Findings = append(a.Findings, "NO_ACTIVE_APPLICATION_SOCKETS")
	}
	if c.UDPBound > 0 {
		a.Findings = append(a.Findings, "UDP_REMOTE_UNKNOWN")
	}
	if len(c.Programs) < c.ProcessCount {
		a.Findings = append(a.Findings, "APPLICATION_LIST_PARTIAL")
	}
	byCat := map[string]*AppCategoryCount{}
	for _, p := range c.Programs {
		g := byCat[p.Category]
		if g == nil {
			g = &AppCategoryCount{Category: p.Category}
			byCat[p.Category] = g
		}
		g.Processes++
		g.VPNBound += p.VPNBound
		g.PhysicalBound += p.PhysicalBound
		g.Uncertain += p.Uncertain
		g.UDPBound += p.UDPBound
	}
	for _, cat := range []string{"BROWSER", "VPN_CLIENT", "OTHER"} {
		if g := byCat[cat]; g != nil {
			a.Categories = append(a.Categories, *g)
		}
	}
	return a
}

// Local UI view only: NEVER serialize these process names into SupportReport.
func appSocketLocalLines(c AppSocketCapture) []string {
	rows := append([]AppSocketLocal(nil), c.Programs...)
	sort.Slice(rows, func(i, j int) bool { return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name) })
	if len(rows) > 12 {
		rows = rows[:12]
	}
	out := make([]string, 0, len(rows))
	for _, p := range rows {
		out = append(out, p.Name+" ["+p.Category+"]: TCP-VPN="+itoa(p.VPNBound)+", physical="+itoa(p.PhysicalBound)+", unknown="+itoa(p.Uncertain)+", UDP-bind="+itoa(p.UDPBound))
	}
	return out
}

func itoa(x int) string { return strconv.Itoa(x) }
