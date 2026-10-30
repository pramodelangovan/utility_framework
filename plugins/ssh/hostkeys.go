package ssh

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"

	gossh "golang.org/x/crypto/ssh"
)

// hostKeys implements trust-on-first-use: unknown hosts are remembered,
// and a changed key for a known host is rejected.
type hostKeys struct {
	mu    sync.Mutex
	path  string
	known map[string]string
}

func newHostKeys() *hostKeys {
	h := &hostKeys{known: map[string]string{}}
	if dir, err := os.UserConfigDir(); err == nil {
		h.path = filepath.Join(dir, "utility_framework", "ssh_known_hosts.json")
		if data, err := os.ReadFile(h.path); err == nil {
			json.Unmarshal(data, &h.known)
		}
	}
	return h
}

func (h *hostKeys) callback(hostname string, _ net.Addr, key gossh.PublicKey) error {
	fp := gossh.FingerprintSHA256(key)
	h.mu.Lock()
	defer h.mu.Unlock()
	if saved, ok := h.known[hostname]; ok {
		if saved != fp {
			return fmt.Errorf("host key for %s changed (expected %s, got %s); possible man-in-the-middle", hostname, saved, fp)
		}
		return nil
	}
	h.known[hostname] = fp
	if h.path != "" {
		if err := os.MkdirAll(filepath.Dir(h.path), 0o700); err == nil {
			if data, err := json.MarshalIndent(h.known, "", "  "); err == nil {
				os.WriteFile(h.path, data, 0o600)
			}
		}
	}
	return nil
}
