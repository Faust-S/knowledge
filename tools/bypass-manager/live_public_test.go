package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeoMatchesObservedIPAndRejectsMismatch(t *testing.T) {
	v, err := decodeGeo("IPAPI", []byte(`{"ip":"9.9.9.9","country_name":"Example Country","region":"Example Region","asn":"AS777"}`), "9.9.9.9")
	if err != nil || !v.GeoMatched || v.Country != "Example Country" || v.Region != "Example Region" {
		t.Fatalf("unexpected %+v %v", v, err)
	}
	if _, err := decodeGeo("IPAPI", []byte(`{"ip":"1.1.1.1","country_name":"Other"}`), "9.9.9.9"); err == nil {
		t.Fatal("different egress must not be identified")
	}
	if _, err := decodeGeo("IPWHOIS", []byte(`{"ip":"9.9.9.9","success":false,"country":"Other"}`), "9.9.9.9"); err == nil {
		t.Fatal("failed lookup accepted")
	}
}
func TestGeoFallbackAndNoUnvalidatedText(t *testing.T) {
	first := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(429) }))
	defer first.Close()
	second := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ip":"9.9.9.9","success":true,"country":"Country","region":"Re\\u0000gion","connection":{"asn":456,"isp":"ISP"}}`))
	}))
	defer second.Close()
	v, err := lookupGeo(context.Background(), "9.9.9.9", first.Client(), []geoEndpoint{{first.URL, "A"}, {second.URL, "B"}})
	if err != nil || v.GeoSource != "B" || v.ASN != "AS456" {
		t.Fatalf("fallback failed: %+v %v", v, err)
	}
	if strings.ContainsAny(cleanGeoText("A\n\r\tB"), "\n\r\t") {
		t.Fatal("control symbols leaked")
	}
}
func TestGeoNeverReportsUnknownIP(t *testing.T) {
	if _, err := decodeGeo("IPAPI", []byte(`{"ip":"9.9.9.9"}`), ""); err == nil {
		t.Fatal("empty consensus accepted")
	}
}
