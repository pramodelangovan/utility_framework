package ssh

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ConnectRequest holds the system details entered in the UI.
type ConnectRequest struct {
	Host           string `json:"host"`
	Port           int    `json:"port"`
	Username       string `json:"username"`
	AuthMethod     string `json:"authMethod"` // "password" or "key"
	Password       string `json:"password"`
	PrivateKeyPath string `json:"privateKeyPath"`
	Passphrase     string `json:"passphrase"`
	Cols           int    `json:"cols"`
	Rows           int    `json:"rows"`
	// SavedID, when set, loads the stored password/passphrase from the credential store.
	SavedID string `json:"savedId"`
	// StartupCommand is typed into the shell right after connecting.
	StartupCommand string `json:"startupCommand"`
}

type session struct {
	client *gossh.Client
	sess   *gossh.Session
	stdin  io.WriteCloser
}

// Service is the set of methods exposed to the frontend.
type Service struct {
	ctx      context.Context
	mu       sync.Mutex
	sessions map[string]*session
	browsers map[string]*browserSession
	closed   bool
	hosts    *hostKeys
	logins   *loginStore
}

func newService() *Service {
	return &Service{sessions: map[string]*session{}, browsers: map[string]*browserSession{}, hosts: newHostKeys(), logins: newLoginStore()}
}

// ListLogins returns saved logins (without secrets).
func (s *Service) ListLogins() []Login { return s.logins.list() }

// SaveLogin creates or updates a saved login.
func (s *Service) SaveLogin(req SaveLoginRequest) (Login, error) { return s.logins.save(req) }

// DeleteLogin removes a saved login and its stored secret.
func (s *Service) DeleteLogin(id string) error { return s.logins.delete(id) }

func authMethods(req ConnectRequest) ([]gossh.AuthMethod, error) {
	if req.AuthMethod == "key" {
		pem, err := os.ReadFile(req.PrivateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("reading private key: %w", err)
		}
		var signer gossh.Signer
		if req.Passphrase != "" {
			signer, err = gossh.ParsePrivateKeyWithPassphrase(pem, []byte(req.Passphrase))
		} else {
			signer, err = gossh.ParsePrivateKey(pem)
		}
		if err != nil {
			return nil, fmt.Errorf("parsing private key: %w", err)
		}
		return []gossh.AuthMethod{gossh.PublicKeys(signer)}, nil
	}
	return []gossh.AuthMethod{
		gossh.Password(req.Password),
		gossh.KeyboardInteractive(func(_, _ string, qs []string, _ []bool) ([]string, error) {
			answers := make([]string, len(qs))
			for i := range answers {
				answers[i] = req.Password
			}
			return answers, nil
		}),
	}, nil
}

func (s *Service) dial(req ConnectRequest) (*gossh.Client, error) {
	if req.Host == "" || req.Username == "" {
		return nil, errors.New("host and username are required")
	}
	if req.Port == 0 {
		req.Port = 22
	}
	if req.SavedID != "" {
		secret := secretFor(req.SavedID)
		if req.AuthMethod == "key" && req.Passphrase == "" {
			req.Passphrase = secret
		} else if req.AuthMethod != "key" && req.Password == "" {
			req.Password = secret
		}
	}

	auth, err := authMethods(req)
	if err != nil {
		return nil, err
	}
	cfg := &gossh.ClientConfig{
		User:            req.Username,
		Auth:            auth,
		HostKeyCallback: s.hosts.callback,
		Timeout:         15 * time.Second,
	}
	addr := net.JoinHostPort(req.Host, strconv.Itoa(req.Port))
	return gossh.Dial("tcp", addr, cfg)
}

// Connect opens an interactive shell. The frontend supplies the session id so it
// can subscribe to "ssh:data:<id>" and "ssh:closed:<id>" before output arrives.
func (s *Service) Connect(id string, req ConnectRequest) error {
	if id == "" {
		return errors.New("session id is required")
	}
	if req.Cols <= 0 || req.Rows <= 0 {
		req.Cols, req.Rows = 80, 24
	}
	s.mu.Lock()
	if _, exists := s.sessions[id]; exists {
		s.mu.Unlock()
		return errors.New("session already exists")
	}
	s.mu.Unlock()
	client, err := s.dial(req)
	if err != nil {
		return err
	}
	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		return err
	}
	modes := gossh.TerminalModes{gossh.ECHO: 1, gossh.TTY_OP_ISPEED: 14400, gossh.TTY_OP_OSPEED: 14400}
	if err := sess.RequestPty("xterm-256color", req.Rows, req.Cols, modes); err != nil {
		client.Close()
		return err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		client.Close()
		return err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		client.Close()
		return err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		client.Close()
		return err
	}
	if err := sess.Shell(); err != nil {
		client.Close()
		return err
	}

	s.mu.Lock()
	s.sessions[id] = &session{client: client, sess: sess, stdin: stdin}
	s.mu.Unlock()

	if cmd := strings.TrimSpace(req.StartupCommand); cmd != "" {
		io.WriteString(stdin, cmd+"\n")
	}

	var wg sync.WaitGroup
	for _, r := range []io.Reader{stdout, stderr} {
		wg.Add(1)
		go func(r io.Reader) {
			defer wg.Done()
			s.pump(id, r)
		}(r)
	}
	go func() {
		wg.Wait()
		sess.Wait()
		s.remove(id)
		runtime.EventsEmit(s.ctx, "ssh:closed:"+id)
	}()
	return nil
}

// pump forwards output as base64 so arbitrary bytes survive the JSON event bridge.
func (s *Service) pump(id string, r io.Reader) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			runtime.EventsEmit(s.ctx, "ssh:data:"+id, base64.StdEncoding.EncodeToString(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

func (s *Service) get(id string) *session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[id]
}

func (s *Service) remove(id string) {
	s.mu.Lock()
	sess := s.sessions[id]
	delete(s.sessions, id)
	s.mu.Unlock()
	if sess != nil {
		sess.client.Close()
	}
}

// Write sends user keystrokes to the remote shell.
func (s *Service) Write(id, data string) error {
	sess := s.get(id)
	if sess == nil {
		return errors.New("no such session")
	}
	_, err := io.WriteString(sess.stdin, data)
	return err
}

// Resize updates the remote pty size.
func (s *Service) Resize(id string, cols, rows int) error {
	sess := s.get(id)
	if sess == nil {
		return errors.New("no such session")
	}
	return sess.sess.WindowChange(rows, cols)
}

// Disconnect closes a session.
func (s *Service) Disconnect(id string) {
	s.remove(id)
}

func (s *Service) closeAll() {
	s.mu.Lock()
	s.closed = true
	ids := make([]string, 0, len(s.sessions))
	for id := range s.sessions {
		ids = append(ids, id)
	}
	browserIDs := make([]string, 0, len(s.browsers))
	for id := range s.browsers {
		browserIDs = append(browserIDs, id)
	}
	s.mu.Unlock()
	for _, id := range ids {
		s.remove(id)
	}
	for _, id := range browserIDs {
		s.DisconnectBrowser(id)
	}
}
