package vnc

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestTunnelForwardsAndCloses(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	s := newService()
	defer s.closeAll()
	host, portText, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	bridge, err := s.Start(host, port)
	if err != nil {
		t.Fatal(err)
	}
	target, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	target.SetDeadline(time.Now().Add(5 * time.Second))

	u, _ := url.Parse(bridge.URL)
	u.Scheme = "http"
	u.Path = "/wrong-token"
	response, err := http.Get(u.String())
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("wrong token: got status %d", response.StatusCode)
	}

	ws, _, err := websocket.DefaultDialer.Dial(bridge.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := ws.WriteMessage(websocket.BinaryMessage, []byte("client")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, len("client"))
	if _, err := io.ReadFull(target, buf); err != nil || string(buf) != "client" {
		t.Fatalf("client to server: %q, %v", buf, err)
	}
	if _, err := target.Write([]byte("server")); err != nil {
		t.Fatal(err)
	}
	kind, data, err := ws.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || string(data) != "server" {
		t.Fatalf("server to client: %d %q %v", kind, data, err)
	}
	s.Stop(bridge.ID)
	if _, _, err := ws.ReadMessage(); err == nil {
		t.Fatal("websocket remained open after Stop")
	}
	if _, err := target.Read(buf); err == nil {
		t.Fatal("VNC connection remained open after Stop")
	}
}

func TestStartRejectsInvalidConnection(t *testing.T) {
	s := newService()
	for _, tc := range []struct {
		host string
		port int
	}{{"", 5900}, {"example.com/path", 5900}, {"localhost", 0}, {"localhost", 65536}} {
		if _, err := s.Start(tc.host, tc.port); err == nil {
			t.Errorf("accepted invalid host %q and port %d", tc.host, tc.port)
		}
	}
	if _, err := s.Start("invalid host", 5900); err == nil || !strings.Contains(err.Error(), "valid host") {
		t.Errorf("expected connection error, got %v", err)
	}
}

func TestShutdownClosesUnusedTunnel(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	s := newService()
	host, portText, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	bridge, err := s.Start(host, port)
	if err != nil {
		t.Fatal(err)
	}
	target, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	target.SetReadDeadline(time.Now().Add(5 * time.Second))
	s.closeAll()
	if _, err := target.Read(make([]byte, 1)); err == nil {
		t.Fatal("VNC connection remained open after shutdown")
	}
	if _, _, err := websocket.DefaultDialer.Dial(bridge.URL, nil); err == nil {
		t.Fatal("bridge remained open after shutdown")
	}
}
