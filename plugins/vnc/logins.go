package vnc

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/zalando/go-keyring"
)

const keyringService = "utility_framework/vnc"

type Login struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	HasSecret bool   `json:"hasSecret"`
}

type SaveLoginRequest struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Secret     string `json:"secret"`
	SaveSecret bool   `json:"saveSecret"`
}

type loginStore struct {
	mu   sync.Mutex
	path string
	err  error
}

func newLoginStore() *loginStore {
	dir, err := os.UserConfigDir()
	return &loginStore{path: filepath.Join(dir, "utility_framework", "vnc_logins.json"), err: err}
}

func (s *loginStore) read() ([]Login, error) {
	if s.err != nil {
		return nil, fmt.Errorf("finding config directory: %w", s.err)
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return []Login{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading VNC logins: %w", err)
	}
	var logins []Login
	if err := json.Unmarshal(data, &logins); err != nil {
		return nil, fmt.Errorf("reading VNC logins: %w", err)
	}
	return logins, nil
}

func (s *loginStore) write(logins []Login) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("creating VNC login directory: %w", err)
	}
	data, err := json.MarshalIndent(logins, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, data, 0o600); err != nil {
		return fmt.Errorf("saving VNC logins: %w", err)
	}
	return nil
}

func (s *Service) ListLogins() ([]Login, error) {
	s.logins.mu.Lock()
	defer s.logins.mu.Unlock()
	logins, err := s.logins.read()
	if err != nil {
		return nil, err
	}
	sort.Slice(logins, func(i, j int) bool {
		return strings.ToLower(logins[i].Name) < strings.ToLower(logins[j].Name)
	})
	return logins, nil
}

func (s *Service) SaveLogin(req SaveLoginRequest) (Login, error) {
	req.Host = strings.TrimSpace(req.Host)
	if req.Host == "" || strings.ContainsAny(req.Host, " \t\r\n/[]") || req.Port < 1 || req.Port > 65535 {
		return Login{}, errors.New("enter a valid host and port between 1 and 65535")
	}
	s.logins.mu.Lock()
	defer s.logins.mu.Unlock()
	logins, err := s.logins.read()
	if err != nil {
		return Login{}, err
	}
	index := -1
	for i := range logins {
		if logins[i].ID == req.ID && req.ID != "" {
			index = i
			break
		}
	}
	if req.ID != "" && index == -1 {
		return Login{}, errors.New("VNC login not found")
	}
	if req.ID == "" {
		req.ID = uuid.NewString()
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = fmt.Sprintf("%s:%d", req.Host, req.Port)
	}
	login := Login{ID: req.ID, Name: name, Host: req.Host, Port: req.Port}
	if req.SaveSecret && req.Secret != "" {
		if err := keyring.Set(keyringService, req.ID, req.Secret); err != nil {
			return Login{}, fmt.Errorf("saving VNC password: %w", err)
		}
		login.HasSecret = true
	} else if req.SaveSecret && index >= 0 {
		login.HasSecret = logins[index].HasSecret
	} else if !req.SaveSecret && index >= 0 && logins[index].HasSecret {
		if err := keyring.Delete(keyringService, req.ID); err != nil && !errors.Is(err, keyring.ErrNotFound) {
			return Login{}, fmt.Errorf("removing VNC password: %w", err)
		}
	}
	if index >= 0 {
		logins[index] = login
	} else {
		logins = append(logins, login)
	}
	if err := s.logins.write(logins); err != nil {
		return Login{}, err
	}
	return login, nil
}

func (s *Service) DeleteLogin(id string) error {
	s.logins.mu.Lock()
	defer s.logins.mu.Unlock()
	logins, err := s.logins.read()
	if err != nil {
		return err
	}
	for i, login := range logins {
		if login.ID != id {
			continue
		}
		if login.HasSecret {
			if err := keyring.Delete(keyringService, id); err != nil && !errors.Is(err, keyring.ErrNotFound) {
				return fmt.Errorf("removing VNC password: %w", err)
			}
		}
		return s.logins.write(append(logins[:i], logins[i+1:]...))
	}
	return errors.New("VNC login not found")
}

// GetLoginPassword supplies a saved password to the local VNC client.
func (s *Service) GetLoginPassword(id string) (string, error) {
	s.logins.mu.Lock()
	defer s.logins.mu.Unlock()
	logins, err := s.logins.read()
	if err != nil {
		return "", err
	}
	for _, login := range logins {
		if login.ID == id && login.HasSecret {
			secret, err := keyring.Get(keyringService, id)
			if err != nil {
				return "", fmt.Errorf("reading VNC password: %w", err)
			}
			return secret, nil
		}
	}
	return "", errors.New("saved VNC password not found")
}
