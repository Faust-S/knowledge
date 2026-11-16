package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// PublicView is for display on THIS computer only. Never include this struct
// in the shareable diagnostics: addresses and geo information can identify a user.
type PublicView struct {
	IP           string
	Consensus    bool
	Country      string
	Region       string
	City         string
	ASN          string
	Organisation string
	GeoSource    string
	GeoMatched   bool
	CheckedUTC   string
}

type geoEndpoint struct {
	URL    string
	Source string
}

var geoEndpoints = []geoEndpoint{
	{"https://ipapi.co/json/", "IPAPI"},
	{"https://ipwho.is/", "IPWHOIS"},
}

// validate server-derived text before it is displayed in a Win32 control.
func cleanGeoText(value string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(value) {
		if b.Len() >= 120 {
			break
		}
		if unicode.IsControl(r) || (unicode.Is(unicode.Cf, r)) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func decodeGeo(provider string, body []byte, expectedIPv4 string) (PublicView, error) {
	if !validIPv4(expectedIPv4) {
		return PublicView{}, errors.New("no reliable public IPv4")
	}
	var d struct {
		IP          string `json:"ip"`
		Success     *bool  `json:"success"`
		Error       bool   `json:"error"`
		CountryName string `json:"country_name"`
		Country     string `json:"country"`
		Region      string `json:"region"`
		City        string `json:"city"`
		ASN         string `json:"asn"`
		Org         string `json:"org"`
		Connection  struct {
			ASN int    `json:"asn"`
			ISP string `json:"isp"`
			Org string `json:"org"`
		} `json:"connection"`
	}
	if err := json.Unmarshal(body, &d); err != nil || d.IP != expectedIPv4 || d.Error || (d.Success != nil && !*d.Success) {
		return PublicView{}, errors.New("geo result disagrees with independent IPv4 consensus")
	}
	country := d.CountryName
	if country == "" {
		country = d.Country
	}
	asn := d.ASN
	if asn == "" && d.Connection.ASN > 0 {
		asn = "AS" + strconv.Itoa(d.Connection.ASN)
	}
	org := d.Org
	if org == "" {
		org = d.Connection.ISP
	}
	return PublicView{IP: expectedIPv4, Consensus: true, Country: cleanGeoText(country), Region: cleanGeoText(d.Region), City: cleanGeoText(d.City), ASN: cleanGeoText(asn), Organisation: cleanGeoText(org), GeoSource: provider, GeoMatched: true}, nil
}

func lookupGeo(ctx context.Context, expectedIPv4 string, client *http.Client, endpoints []geoEndpoint) (PublicView, error) {
	if !validIPv4(expectedIPv4) {
		return PublicView{}, errors.New("IPv4 consensus unavailable")
	}
	for _, endpoint := range endpoints {
		req, err := http.NewRequestWithContext(ctx, "GET", endpoint.URL, nil)
		if err != nil || req.URL.Scheme != "https" {
			continue
		}
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 8193))
		resp.Body.Close()
		if err != nil || len(body) > 8192 {
			continue
		}
		if v, err := decodeGeo(endpoint.Source, body, expectedIPv4); err == nil {
			return v, nil
		}
	}
	return PublicView{}, errors.New("no independently matching location service")
}

func inspectPublicView(ctx context.Context, m *Manager) (PublicView, EgressResult) {
	result := m.egress(ctx)
	view := PublicView{CheckedUTC: utc()}
	if !result.Agreement || !validIPv4(result.IP) {
		return view, result
	}
	view.Consensus = true
	view.IP = result.IP
	geoCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if geo, err := lookupGeo(geoCtx, result.IP, httpClient(8*time.Second), geoEndpoints); err == nil {
		geo.CheckedUTC = view.CheckedUTC
		view = geo
	}
	return view, result
}
