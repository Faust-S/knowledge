package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// The Windows ZIP includes unmodified, hash-pinned files inside "engine".
// Copy them to the private runtime directory atomically without contacting
// any remote service. A partial or modified bundle is a hard error, not a
// signal to silently fetch different binaries from the internet.
func installPinnedBundle(ctx context.Context, source, target string, files map[string]string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if len(files) == 0 {
		return errors.New("empty offline engine manifest")
	}
	if existing, err := os.Stat(target); err == nil && existing.IsDir() {
		return errors.New("engine destination already exists; manual repair required")
	} else if err == nil {
		return errors.New("engine destination is not a directory")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	// Validate every single original file before touching the runtime location.
	buffers := make(map[string][]byte, len(files))
	for name, want := range files {
		if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "..") || filepath.Clean(name) == "." {
			return errors.New("invalid bundled engine path")
		}
		file := filepath.Join(source, filepath.FromSlash(name))
		f, err := os.Open(file)
		if err != nil {
			return fmt.Errorf("offline engine incomplete: %s: %w", name, err)
		}
		data, readErr := io.ReadAll(io.LimitReader(f, (10<<20)+1))
		closeErr := f.Close()
		if readErr != nil {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		if len(data) == 0 || len(data) > (10<<20) || githubBlobHash(data) != want {
			return fmt.Errorf("offline engine hash mismatch: %s", name)
		}
		buffers[name] = data
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	parent := filepath.Dir(target)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(parent, ".bypass-offline-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	for name, data := range buffers {
		if err := ctx.Err(); err != nil {
			return err
		}
		dest := filepath.Join(stage, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		if err := os.WriteFile(dest, data, 0600); err != nil {
			return err
		}
	}
	note := "Source: https://github.com/bol-van/zapret-win-bundle\nCommit: " + upstreamCommit + "\nBundled unmodified original engine files verified with pinned Git blob hashes.\nThird-party license notices distributed beside the Windows application.\n"
	if err := os.WriteFile(filepath.Join(stage, "UPSTREAM-ORIGIN.txt"), []byte(note), 0600); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(stage, target)
}

func installOfflineEngine(ctx context.Context, target string) (bool, error) {
	exe, err := os.Executable()
	if err != nil {
		return false, err
	}
	dir := filepath.Join(filepath.Dir(exe), "engine")
	if st, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	} else if !st.IsDir() {
		return false, errors.New("bundled engine path is not a directory")
	}
	if err := installPinnedBundle(ctx, dir, target, upstreamBlobs); err != nil {
		return true, err
	}
	return true, nil
}
