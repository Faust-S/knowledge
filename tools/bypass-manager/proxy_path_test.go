package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestProxyPortsStrictParse(t *testing.T) {
	good := ProxyPorts{SchemaVersion: "0.3.7", Status: "CANDIDATES", Ports: []int{10808, 10809}}
	b, _ := json.Marshal(good)
	got, err := parseProxyPorts(b)
	if err != nil || len(got.Ports) != 2 {
		t.Fatalf("valid: %+v %v", got, err)
	}
	for _, str := range []string{
		`{}`, `null`, `[]`, `{"schema_version":"0.3.7","status":"CANDIDATES","ports":[]}`,
		`{"schema_version":"0.3.7","status":"CANDIDATES","ports":[10808,10808]}`,
		`{"schema_version":"0.3.7","status":"CANDIDATES","ports":[80]}`,
		`{"schema_version":"0.3.7","status":"CANDIDATES","ports":[65536]}`,
		`{"schema_version":"0.3.7","status":"CANDIDATES","ports":[10808],"pid":42}`,
		`{"schema_version":"0.3.7","status":"NO_TRUSTED_LISTENER","ports":[10808]}`,
		`{"schema_version":"0.3.6","status":"CANDIDATES","ports":[10808]}`,
		`{"schema_version":"0.3.7","status":"OBSERVED","ports":[10808]}`,
	} {
		if _, err := parseProxyPorts([]byte(str)); err == nil {
			t.Errorf("accepted %s", str)
		}
	}
	if _, err := proxyClientFor(80, "http", time.Second); err == nil {
		t.Fatal("privileged port accepted")
	}
	if _, err := proxyClientFor(10808, "file", time.Second); err == nil {
		t.Fatal("unsupported proxy accepted")
	}
}

func TestLocalProxyProbeViaActualLoopbackHTTPConnect(t *testing.T) {
	echo := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "9.9.9.9\n") }))
	defer echo.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			http.Error(w, "CONNECT required", http.StatusMethodNotAllowed)
			return
		}
		dst, err := net.DialTimeout("tcp", r.Host, 2*time.Second)
		if err != nil {
			http.Error(w, "unavailable", 502)
			return
		}
		hj, ok := w.(http.Hijacker)
		if !ok {
			dst.Close()
			http.Error(w, "no hijacker", 500)
			return
		}
		client, _, err := hj.Hijack()
		if err != nil {
			dst.Close()
			return
		}
		_, _ = client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = io.Copy(dst, client); _ = dst.Close() }()
		go func() { defer wg.Done(); _, _ = io.Copy(client, dst); _ = client.Close() }()
		wg.Wait()
	}))
	defer proxy.Close()
	host, portStr, _ := net.SplitHostPort(strings.TrimPrefix(proxy.URL, "http://"))
	if host != "127.0.0.1" {
		t.Fatalf("not loopback: %s", host)
	}
	port, _ := strconv.Atoi(portStr)
	roots := x509.NewCertPool()
	roots.AddCert(echo.Certificate())
	factory := func(port int, mode string, timeout time.Duration) (*http.Client, error) {
		c, err := proxyClientFor(port, mode, timeout)
		if err == nil {
			c.Transport.(*http.Transport).TLSClientConfig = &tls.Config{RootCAs: roots}
		}
		return c, err
	}
	urls := []string{echo.URL + "/a", echo.URL + "/b", echo.URL + "/c"}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	found := probeProxyPortsWithClient(ctx, []int{port}, urls, factory)
	if found.State != "OBSERVED" || !found.Agreement || found.Mode != "http" || found.Port != port || found.IP != "9.9.9.9" || found.Sources != 3 {
		t.Fatalf("real CONNECT HTTPS probe: %+v", found)
	}
	if status := proxyStatusCode(found); status != "LOCAL_PROXY_HTTPS_EGRESS_OBSERVED" {
		t.Fatal(status)
	}
	if public := proxyStatusCode(LocalProxyEvidence{State: "NO_PROXY_EGRESS"}); public != "LOCAL_PROXY_HTTPS_UNAVAILABLE" {
		t.Fatal(public)
	}
}

func TestProxyProbeDoesNotSilentlyUseDirectRoute(t *testing.T) {
	echo := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = fmt.Fprint(w, "9.9.9.9") }))
	defer echo.Close()
	unused, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := unused.Addr().(*net.TCPAddr).Port
	_ = unused.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// If proxy is unavailable, an HTTPS service reachable directly MUST NOT
	// be mistaken for an observed Amnezia proxy transport.
	found := probeProxyPorts(ctx, []int{port}, []string{echo.URL, echo.URL + "/a"})
	if found.State == "OBSERVED" {
		t.Fatalf("direct fallback misclassified: %+v", found)
	}
}

// A full SOCKS5 greeting and CONNECT is exercised over real loopback TCP;
// only the external HTTPS echo is synthetic.
func TestLocalProxyProbeViaActualLoopbackSOCKS5(t *testing.T) {
	echo := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "9.9.9.9") }))
	defer echo.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(5 * time.Second))
				hello := make([]byte, 2)
				if _, err := io.ReadFull(c, hello); err != nil || hello[0] != 5 {
					return
				}
				methods := make([]byte, int(hello[1]))
				if _, err = io.ReadFull(c, methods); err != nil {
					return
				}
				_, _ = c.Write([]byte{5, 0})
				head := make([]byte, 4)
				if _, err = io.ReadFull(c, head); err != nil || head[0] != 5 || head[1] != 1 {
					return
				}
				var addr string
				switch head[3] {
				case 1:
					b := make([]byte, 4)
					if _, err = io.ReadFull(c, b); err != nil {
						return
					}
					addr = net.IP(b).String()
				case 3:
					b := make([]byte, 1)
					if _, err = io.ReadFull(c, b); err != nil {
						return
					}
					host := make([]byte, int(b[0]))
					if _, err = io.ReadFull(c, host); err != nil {
						return
					}
					addr = string(host)
				case 4:
					b := make([]byte, 16)
					if _, err = io.ReadFull(c, b); err != nil {
						return
					}
					addr = net.IP(b).String()
				default:
					return
				}
				pb := make([]byte, 2)
				if _, err = io.ReadFull(c, pb); err != nil {
					return
				}
				dst, err := net.DialTimeout("tcp", net.JoinHostPort(addr, strconv.Itoa(int(pb[0])<<8|int(pb[1]))), 2*time.Second)
				if err != nil {
					_, _ = c.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
					return
				}
				defer dst.Close()
				_, _ = c.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 0})
				go func() { _, _ = io.Copy(dst, c); _ = dst.Close() }()
				_, _ = io.Copy(c, dst)
			}(conn)
		}
	}()
	roots := x509.NewCertPool()
	roots.AddCert(echo.Certificate())
	factory := func(port int, scheme string, timeout time.Duration) (*http.Client, error) {
		c, err := proxyClientFor(port, scheme, timeout)
		if err == nil {
			c.Transport.(*http.Transport).TLSClientConfig = &tls.Config{RootCAs: roots}
		}
		return c, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	found := probeProxyPortsWithClient(ctx, []int{port}, []string{echo.URL + "/a", echo.URL + "/b", echo.URL + "/c"}, factory)
	if found.State != "OBSERVED" || found.Mode != "socks5" || found.Sources != 3 || found.Port != port {
		t.Fatalf("genuine SOCKS5 CONNECT not verified: %+v", found)
	}
}
