package vnc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestSavedLoginsAndPasswords(t *testing.T) {
	keyring.MockInit()
	s := newService()
	s.logins.path = filepath.Join(t.TempDir(), "logins.json")
	login, err := s.SaveLogin(SaveLoginRequest{Host: "example.test", Port: 5901, Secret: "test-secret", SaveSecret: true})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(s.logins.path)
	if err != nil || strings.Contains(string(data), "test-secret") {
		t.Fatalf("secret persisted in login metadata: %s (%v)", data, err)
	}
	secret, err := s.GetLoginPassword(login.ID)
	if err != nil || secret != "test-secret" {
		t.Fatalf("saved password: %q, %v", secret, err)
	}
	updated, err := s.SaveLogin(SaveLoginRequest{ID: login.ID, Name: "Updated", Host: login.Host, Port: login.Port, SaveSecret: true})
	if err != nil || !updated.HasSecret {
		t.Fatalf("preserving saved password: %+v, %v", updated, err)
	}
	secret, err = s.GetLoginPassword(login.ID)
	if err != nil || secret != "test-secret" {
		t.Fatalf("password changed on edit: %q, %v", secret, err)
	}
	logins, err := s.ListLogins()
	if err != nil || len(logins) != 1 || logins[0].Name != "Updated" {
		t.Fatalf("list after edit: %+v, %v", logins, err)
	}
	updated, err = s.SaveLogin(SaveLoginRequest{ID: login.ID, Host: login.Host, Port: login.Port})
	if err != nil || updated.HasSecret {
		t.Fatalf("turning off remembered password: %+v, %v", updated, err)
	}
	if _, err := keyring.Get(keyringService, login.ID); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("password not removed when disabled: %v", err)
	}
	if _, err := s.SaveLogin(SaveLoginRequest{ID: login.ID, Host: login.Host, Port: login.Port, Secret: "test-secret", SaveSecret: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteLogin(login.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := keyring.Get(keyringService, login.ID); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("password not deleted: %v", err)
	}
	logins, err = s.ListLogins()
	if err != nil || len(logins) != 0 {
		t.Fatalf("list after deletion: %+v, %v", logins, err)
	}
}

func TestSavedLoginErrors(t *testing.T) {
	keyring.MockInit()
	s := newService()
	s.logins.path = filepath.Join(t.TempDir(), "logins.json")
	if _, err := s.SaveLogin(SaveLoginRequest{Host: "host", Port: 0}); err == nil {
		t.Fatal("accepted invalid port")
	}
	if _, err := s.GetLoginPassword("missing"); err == nil {
		t.Fatal("returned password for missing login")
	}
	keyring.MockInitWithError(errors.New("credential store unavailable"))
	if _, err := s.SaveLogin(SaveLoginRequest{Host: "host", Port: 5900, Secret: "secret", SaveSecret: true}); err == nil {
		t.Fatal("ignored credential store failure")
	}
	keyring.MockInit()
	if err := os.WriteFile(s.logins.path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ListLogins(); err == nil {
		t.Fatal("ignored invalid login data")
	}
}
