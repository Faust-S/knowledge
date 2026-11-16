package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

// Shareable, typed diagnostic bundle. There is intentionally NO option to
// include settings.json, private-direct-baseline.json, profiles, local paths,
// native process logs, VPN identities, or raw IP/geo info in this schema.
type SupportReport struct {
	SchemaVersion string             `json:"schema_version"`
	GeneratedUTC  string             `json:"generated_utc"`
	Summary       string             `json:"summary"`
	Available     int                `json:"available_sources"`
	Sources       []SupportSource    `json:"sources"`
	Tuning        []TuningSuggestion `json:"tuning_suggestions,omitempty"`
	Network       *NetworkAudit      `json:"network,omitempty"`
	Path          *PathReport        `json:"path,omitempty"`
	Live          *LiveAudit         `json:"live,omitempty"`
	Stability     *StabilityReport   `json:"stability,omitempty"`
	Guide         *GuideReport       `json:"guide,omitempty"`
	Caveat        string             `json:"caveat"`
}
type SupportSource struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	AgeSeconds int64  `json:"age_s,omitempty"`
}

func readStrictJSON(path string, out any) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	d := json.NewDecoder(io.LimitReader(f, 4*1024*1024))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	var trailing any
	if err := d.Decode(&trailing); err != io.EOF {
		return errors.New("trailing report data")
	}
	return nil
}
func buildSupportReport(folder string, now time.Time) SupportReport {
	s := SupportReport{SchemaVersion: "0.3.3", GeneratedUTC: now.UTC().Format(time.RFC3339), Summary: "READ_ONLY_RECONSTRUCTION", Sources: []SupportSource{}, Caveat: "This export is limited to whitelist-only numeric and status evidence. It contains no raw IP, country, city, ISP, SSID, gateway, local paths, usernames or VPN keys. Results cannot independently prove a native VPN handshake or end-to-end video playback."}
	// Exact constant names; never accept a user-supplied path or arbitrary glob.
	sources := []struct {
		name   string
		target any
	}{
		{"latest-guide.json", &GuideReport{}},
		{"latest-network.json", &NetworkAudit{}},
		{"latest-path.json", &PathReport{}},
		{"latest-speed.json", &LiveAudit{}},
		{"latest-stability.json", &StabilityReport{}},
	}
	for _, entry := range sources {
		path := filepath.Join(folder, entry.name)
		info, statErr := os.Stat(path)
		source := SupportSource{Name: entry.name, Status: "UNAVAILABLE"}
		if statErr == nil && !info.IsDir() && info.Size() < 4*1024*1024 {
			age := now.Sub(info.ModTime())
			if age < 0 {
				age = 0
			}
			source.AgeSeconds = int64(age.Seconds())
			if err := readStrictJSON(path, entry.target); err == nil {
				source.Status = "INCLUDED"
				if age > 72*time.Hour {
					source.Status = "STALE_INCLUDED"
				}
				switch v := entry.target.(type) {
				case *GuideReport:
					s.Guide = v
				case *NetworkAudit:
					s.Network = v
				case *PathReport:
					s.Path = v
				case *LiveAudit:
					s.Live = v
				case *StabilityReport:
					s.Stability = v
				}
				s.Available++
			} else {
				source.Status = "INVALID_OR_OLD_SCHEMA"
			}
		}
		s.Sources = append(s.Sources, source)
	}
	if s.Available == 0 {
		s.Summary = "NO_VALID_REPORTS"
	}
	s.Tuning = tuningSuggestions(s)
	return s
}
func saveSupport(folder string) (string, SupportReport, error) {
	s := buildSupportReport(folder, time.Now())
	path := filepath.Join(folder, "latest-support.json")
	// All exported source objects are unmarshalled into typed allowlists. Reject
	// accidental additions that contain raw egress or private host information.
	b, _ := json.Marshal(s)
	for _, k := range [][]byte{[]byte(`"private_direct_ip"`), []byte(`"vpn_secret"`), []byte(`"ssid"`), []byte(`"gateway_ip"`)} {
		if bytes.Contains(bytes.ToLower(b), k) {
			return "", s, errors.New("unsafe field in diagnostic report")
		}
	}
	err := saveJSON(path, s)
	return path, s, err
}
