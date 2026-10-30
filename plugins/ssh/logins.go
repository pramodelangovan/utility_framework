package ssh

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/zalando/go-keyring"
)

const keyringService = "utility_framework/ssh"

// Login is a saved connection. Secrets are never stored in the JSON file;
// they live in the OS credential store keyed by the login id.
type Login struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	Username       string `json:"username"`
	AuthMethod     string `json:"authMethod"`
	PrivateKeyPath string `json:"privateKeyPath"`
	StartupCommand string `json:"startupCommand"`
	HasSecret      bool   `json:"hasSecret"`
}

// SaveLoginRequest is a Login plus the secret to store (password or key passphrase).
type SaveLoginRequest struct {
	Login
	Secret     string `json:"secret"`
	SaveSecret bool   `json:"saveSecret"`
}

type loginStore struct {
	mu     sync.Mutex
	path   string
	logins []Login
}

func newLoginStore() *loginStore {
	s := &loginStore{}
	if dir, err := os.UserConfigDir(); err == nil {
		s.path = filepath.Join(dir, "utility_framework", "ssh_logins.json")
		if data, err := os.ReadFile(s.path); err == nil {
			json.Unmarshal(data, &s.logins)
		}
	}
	return s
}

func (s *loginStore) persist() error {
	if s.path == "" {
		return errors.New("no config directory available")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.logins, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o600)
}

func (s *loginStore) list() []Login {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]Login{}, s.logins...)
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

func (s *loginStore) find(id string) (Login, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, l := range s.logins {
		if l.ID == id {
			return l, true
		}
	}
	return Login{}, false
}

func (s *loginStore) save(req SaveLoginRequest) (Login, error) {
	l := req.Login
	if l.Host == "" || l.Username == "" {
		return l, errors.New("host and username are required")
	}
	if l.Port == 0 {
		l.Port = 22
	}
	if l.Name == "" {
		l.Name = l.Username + "@" + l.Host
	}
	if l.ID == "" {
		l.ID = uuid.NewString()
	}

	if req.SaveSecret && req.Secret != "" {
		if err := keyring.Set(keyringService, l.ID, req.Secret); err != nil {
			return l, err
		}
		l.HasSecret = true
	} else if !req.SaveSecret {
		keyring.Delete(keyringService, l.ID)
		l.HasSecret = false
	} else if old, ok := s.find(l.ID); ok {
		// Editing without retyping the secret keeps the stored one.
		l.HasSecret = old.HasSecret
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	replaced := false
	for i := range s.logins {
		if s.logins[i].ID == l.ID {
			s.logins[i] = l
			replaced = true
			break
		}
	}
	if !replaced {
		s.logins = append(s.logins, l)
	}
	return l, s.persist()
}

func (s *loginStore) delete(id string) error {
	keyring.Delete(keyringService, id)
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.logins {
		if s.logins[i].ID == id {
			s.logins = append(s.logins[:i], s.logins[i+1:]...)
			break
		}
	}
	return s.persist()
}

func secretFor(id string) string {
	v, err := keyring.Get(keyringService, id)
	if err != nil {
		return ""
	}
	return v
}
