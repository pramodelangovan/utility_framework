package vnc

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Tunnel struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

type Service struct {
	ctx      context.Context
	mu       sync.Mutex
	sessions map[string]*tunnel
	closed   bool
}

type tunnel struct {
	service  *Service
	id       string
	target   net.Conn
	listener net.Listener
	server   *http.Server
	timer    *time.Timer
	mu       sync.Mutex
	ws       *websocket.Conn
	claimed  bool
	closed   bool
}

func newService() *Service {
	return &Service{sessions: make(map[string]*tunnel)}
}

// Start opens the VNC connection and a one-use, loopback-only WebSocket bridge.
func (s *Service) Start(host string, port int) (Tunnel, error) {
	host = strings.TrimSpace(host)
	if host == "" || strings.ContainsAny(host, " \t\r\n/[]") || port < 1 || port > 65535 {
		return Tunnel{}, errors.New("enter a valid host and port between 1 and 65535")
	}

	target, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 10*time.Second)
	if err != nil {
		return Tunnel{}, fmt.Errorf("connecting to VNC server: %w", err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		target.Close()
		return Tunnel{}, fmt.Errorf("starting VNC bridge: %w", err)
	}
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		target.Close()
		listener.Close()
		return Tunnel{}, fmt.Errorf("creating VNC bridge token: %w", err)
	}
	id := base64.RawURLEncoding.EncodeToString(token)
	t := &tunnel{service: s, id: id, target: target, listener: listener}
	t.server = &http.Server{Handler: http.HandlerFunc(t.serve), ReadHeaderTimeout: 5 * time.Second}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		target.Close()
		listener.Close()
		return Tunnel{}, errors.New("VNC service has shut down")
	}
	s.sessions[id] = t
	t.timer = time.AfterFunc(30*time.Second, t.close)
	s.mu.Unlock()

	go func() {
		if err := t.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, net.ErrClosed) {
			log.Printf("VNC bridge failed: %v", err)
			t.close()
		}
	}()
	return Tunnel{ID: id, URL: "ws://" + listener.Addr().String() + "/" + id}, nil
}

func (s *Service) Stop(id string) {
	s.mu.Lock()
	t := s.sessions[id]
	s.mu.Unlock()
	if t != nil {
		t.close()
	}
}

func (s *Service) closeAll() {
	s.mu.Lock()
	s.closed = true
	sessions := make([]*tunnel, 0, len(s.sessions))
	for _, t := range s.sessions {
		sessions = append(sessions, t)
	}
	s.mu.Unlock()
	for _, t := range sessions {
		t.close()
	}
}

func (t *tunnel) serve(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/"+t.id {
		http.NotFound(w, r)
		return
	}
	t.mu.Lock()
	if t.closed || t.claimed {
		t.mu.Unlock()
		http.Error(w, "VNC bridge is unavailable", http.StatusGone)
		return
	}
	t.claimed = true
	t.mu.Unlock()

	// The unguessable, one-use URL authorizes this connection, including in Wails dev mode.
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		t.close()
		return
	}
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		ws.Close()
		return
	}
	t.ws = ws
	t.timer.Stop()
	t.mu.Unlock()
	t.listener.Close()
	defer t.close()

	ws.SetReadLimit(16 << 20)
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := t.target.Read(buf)
			if n > 0 {
				if writeErr := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); writeErr != nil {
					t.close()
					return
				}
			}
			if err != nil {
				t.close()
				return
			}
		}
	}()
	for {
		kind, reader, err := ws.NextReader()
		if err != nil {
			return
		}
		if kind != websocket.BinaryMessage {
			return
		}
		if _, err := io.Copy(t.target, reader); err != nil {
			return
		}
	}
}

func (t *tunnel) close() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.closed = true
	t.timer.Stop()
	ws := t.ws
	t.mu.Unlock()
	t.server.Close()
	t.listener.Close()
	t.target.Close()
	if ws != nil {
		ws.Close()
	}
	t.service.mu.Lock()
	delete(t.service.sessions, t.id)
	t.service.mu.Unlock()
}
