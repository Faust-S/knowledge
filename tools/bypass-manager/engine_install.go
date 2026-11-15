package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The original Windows driver and Lua files are retrieved from one immutable
// upstream commit; this application neither patches nor redistributes them.
const upstreamCommit = "6b4375fa04f6bd7017eec379e16e462d3ea8df66"
const upstreamRawBase = "https://raw.githubusercontent.com/bol-van/zapret-win-bundle/" + upstreamCommit + "/zapret-winws/"

var upstreamBlobs = map[string]string{
	"winws2.exe":             "44f7d2400bdf9fbfb3b66d860fd11e8d9a1c9690",
	"WinDivert.dll":          "2c55eeb6921351a6cad292a900f4b8d7d41c4bcc",
	"WinDivert64.sys":        "218ccaf423ef0a67696226f9ef3a09149e4441d0",
	"cygwin1.dll":            "1bb2e05c6d5458ad7987859a17172b635e87b9c5",
	"lua/zapret-lib.lua":     "de290a71e2a02774494253d32279b44ad18ec387",
	"lua/zapret-antidpi.lua": "b768277b01114246503819d15a8ed1bb15011b5c",
	"lua/zapret-auto.lua":    "2eb416f86d18f5854e1d29d17121340051430efa",
}

func githubBlobHash(data []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(data))
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}
func enginePresent(root string) bool {
	for name, expected := range upstreamBlobs {
		path := filepath.Join(root, filepath.FromSlash(name))
		st, err := os.Stat(path)
		if err != nil || st.IsDir() || st.Size() == 0 || st.Size() > 10<<20 {
			return false
		}
		data, err := os.ReadFile(path)
		if err != nil || githubBlobHash(data) != expected {
			return false
		}
	}
	return true
}

// One file at a time avoids the huge source bundle. Every file is verified
// before a single file can be promoted into the live engine directory.
func fetchPinnedFiles(ctx context.Context, client *http.Client, base string, expected map[string]string) (map[string][]byte, error) {
	out := make(map[string][]byte, len(expected))
	for path, sha := range expected {
		if strings.HasPrefix(path, "/") || strings.Contains(path, "\\") || strings.Contains(path, "..") || !strings.HasPrefix(base, "https://") && !strings.HasPrefix(base, "http://127.0.0.1:") {
			return nil, errors.New("invalid pinned source/path")
		}
		req, err := http.NewRequestWithContext(ctx, "GET", base+path, nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("official source %s: %w", path, err)
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			return nil, fmt.Errorf("original file %s: HTTP %d", path, resp.StatusCode)
		}
		if resp.ContentLength > 10<<20 {
			resp.Body.Close()
			return nil, fmt.Errorf("original file %s exceeds limit", path)
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, (10<<20)+1))
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if len(data) == 0 || len(data) > 10<<20 {
			return nil, fmt.Errorf("unexpected file size: %s", path)
		}
		if githubBlobHash(data) != sha {
			return nil, fmt.Errorf("original file %s did not match pinned Git blob SHA-1", path)
		}
		out[path] = data
	}
	return out, nil
}

func installUpstream(ctx context.Context, target string, ask func(string) (string, error), out io.Writer) error {
	if enginePresent(target) {
		return nil
	}
	if _, err := os.Stat(target); err == nil {
		return fmt.Errorf("engine path %q exists but is incomplete; user action required", target)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	choice, err := ask("Оригинальный winws2 отсутствует. Скачать только семь необходимых файлов из официального закреплённого коммита с проверкой контрольных сумм? [д/н]")
	if err != nil {
		return err
	}
	if choice != "д" && strings.ToLower(choice) != "y" {
		return errors.New("official download declined")
	}
	fmt.Fprintln(out, "Загружаю 7 файлов из оригинального репозитория. Коммит:", upstreamCommit[:12])
	client := &http.Client{Timeout: 35 * time.Second, CheckRedirect: func(req *http.Request, previous []*http.Request) error {
		if req.URL.Scheme != "https" {
			return errors.New("insecure redirect refused")
		}
		if len(previous) > 4 {
			return errors.New("too many redirects")
		}
		return nil
	}}
	files, err := fetchPinnedFiles(ctx, client, upstreamRawBase, upstreamBlobs)
	if err != nil {
		return fmt.Errorf("official source unavailable: %w", err)
	}
	parent := filepath.Dir(target)
	if err = os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(parent, ".bypass-pinned-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	for name, data := range files {
		dest := filepath.Join(tmp, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		if err = os.WriteFile(dest, data, 0600); err != nil {
			return err
		}
	}
	note := "Source: https://github.com/bol-van/zapret-win-bundle\nCommit: " + upstreamCommit + "\nEach original file verified with Git blob SHA-1. No Windows service installed.\n"
	if err = os.WriteFile(filepath.Join(tmp, "UPSTREAM-ORIGIN.txt"), []byte(note), 0600); err != nil {
		return err
	}
	if err = os.Rename(tmp, target); err != nil {
		return err
	}
	fmt.Fprintln(out, "Оригинальные компоненты проверены и установлены:", target)
	return nil
}
