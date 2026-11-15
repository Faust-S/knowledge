package main

import (
	"archive/zip"
	"bytes"
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

// Official upstream repository, pinned to a known immutable Git commit. The
// executable fetches files directly from GitHub only after explicit consent.
// Download is optional; no engine binary is repackaged by this project.
const upstreamCommit = "6b4375fa04f6bd7017eec379e16e462d3ea8df66"
const upstreamURL = "https://codeload.github.com/bol-van/zapret-win-bundle/zip/" + upstreamCommit

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
	for name := range upstreamBlobs {
		if st, err := os.Stat(filepath.Join(root, filepath.FromSlash(name))); err != nil || st.IsDir() || st.Size() == 0 {
			return false
		}
	}
	return true
}
func selectedUpstreamArchive(body []byte) (map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return nil, err
	}
	entries := map[string][]byte{}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		marker := "/zapret-winws/"
		i := strings.Index(f.Name, marker)
		if i < 0 {
			continue
		}
		suffix := f.Name[i+len(marker):]
		want, ok := upstreamBlobs[suffix]
		if !ok {
			continue
		}
		if f.UncompressedSize64 > 10<<20 {
			return nil, fmt.Errorf("размер %s превышает ожидаемый", suffix)
		}
		r, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(r, 10<<20))
		r.Close()
		if err != nil {
			return nil, err
		}
		if githubBlobHash(data) != want {
			return nil, fmt.Errorf("файл %s не совпал с SHA-1 Git blob в закреплённом upstream commit", suffix)
		}
		if _, exists := entries[suffix]; exists {
			return nil, fmt.Errorf("дубликат %s", suffix)
		}
		entries[suffix] = data
	}
	if len(entries) != len(upstreamBlobs) {
		return nil, fmt.Errorf("неполный официальный архив: получено %d из %d необходимых файлов", len(entries), len(upstreamBlobs))
	}
	return entries, nil
}
func installUpstream(ctx context.Context, target string, ask func(string) (string, error), out io.Writer) error {
	if enginePresent(target) {
		return nil
	}
	if _, err := os.Stat(target); err == nil {
		return fmt.Errorf("каталог %q существует, но неполон; автоматическое вмешательство в имеющиеся файлы запрещено", target)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	choice, err := ask("Отсутствует оригинальный winws2. Скачать с GitHub закреплённую официальную сборку и локально установить только 7 необходимых файлов? [д/н]")
	if err != nil {
		return err
	}
	if choice != "д" && strings.ToLower(choice) != "y" {
		return errors.New("пользователь отклонил загрузку официального движка")
	}
	fmt.Fprintln(out, "Загружаю исходный Windows-bundle bol-van из GitHub на закреплённом commit", upstreamCommit[:12])
	client := &http.Client{Timeout: 85 * time.Second, CheckRedirect: func(req *http.Request, prev []*http.Request) error {
		if req.URL.Scheme != "https" {
			return errors.New("небезопасное перенаправление")
		}
		if len(prev) > 4 {
			return errors.New("слишком много перенаправлений")
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, "GET", upstreamURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("официальная загрузка недоступна (%w); скачайте bundle заранее по README", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("GitHub вернул HTTP %d; ручная установка доступна по README", resp.StatusCode)
	}
	if resp.ContentLength > 40<<20 {
		return errors.New("неожиданно большой архив; загрузка отменена")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 40<<20))
	if err != nil {
		return err
	}
	selected, err := selectedUpstreamArchive(body)
	if err != nil {
		return err
	}
	parent := filepath.Dir(target)
	if err = os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	dir, err := os.MkdirTemp(parent, ".zapret-pinned-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	for filename, data := range selected {
		dest := filepath.Join(dir, filepath.FromSlash(filename))
		if err = os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		if err = os.WriteFile(dest, data, 0600); err != nil {
			return err
		}
	}
	note := "Original files from: https://github.com/bol-van/zapret-win-bundle\nCommit: " + upstreamCommit + "\nFiles verified by Git blob SHA-1. No service installed.\n"
	if err = os.WriteFile(filepath.Join(dir, "UPSTREAM-ORIGIN.txt"), []byte(note), 0600); err != nil {
		return err
	}
	if err = os.Rename(dir, target); err != nil {
		return err
	}
	fmt.Fprintln(out, "Официальные компоненты установлены и проверены:", target)
	return nil
}
