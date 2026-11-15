package ssh

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

func startHTMLPreview(files *sftp.Client, remote string) (*http.Server, string, error) {
	original, err := files.Lstat(remote)
	if err != nil {
		return nil, "", fmt.Errorf("reading HTML file information: %w", err)
	}
	if original.Mode()&os.ModeSymlink != 0 {
		return nil, "", errors.New("symbolic links cannot be previewed")
	}
	resolved, err := files.RealPath(remote)
	if err != nil {
		return nil, "", fmt.Errorf("resolving HTML file: %w", err)
	}
	info, err := files.Stat(resolved)
	if err != nil {
		return nil, "", fmt.Errorf("reading HTML file information: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, "", errors.New("only regular files can be previewed")
	}
	file, err := files.Open(resolved)
	if err != nil {
		return nil, "", fmt.Errorf("opening HTML file: %w", err)
	}
	file.Close()

	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return nil, "", fmt.Errorf("creating HTML preview token: %w", err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, "", fmt.Errorf("starting HTML preview: %w", err)
	}
	prefix := "/" + hex.EncodeToString(token) + "/"
	root := path.Dir(resolved)
	server := &http.Server{
		ReadHeaderTimeout: 10 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != listener.Addr().String() || !strings.HasPrefix(r.URL.Path, prefix) {
				http.NotFound(w, r)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			name := strings.TrimPrefix(r.URL.Path, prefix)
			if name == "" || strings.ContainsAny(name, "\\\x00") {
				http.NotFound(w, r)
				return
			}
			target := path.Join(root, name)
			if !withinPreviewRoot(root, target) {
				http.NotFound(w, r)
				return
			}
			currentPath := root
			relative := strings.TrimPrefix(strings.TrimPrefix(target, root), "/")
			for _, component := range strings.Split(relative, "/") {
				currentPath = path.Join(currentPath, component)
				info, err := files.Lstat(currentPath)
				if err != nil {
					if !errors.Is(err, os.ErrNotExist) {
						log.Printf("checking HTML preview resource: %v", err)
						http.Error(w, "could not check preview resource", http.StatusInternalServerError)
					} else {
						http.NotFound(w, r)
					}
					return
				}
				if info.Mode()&os.ModeSymlink != 0 {
					http.NotFound(w, r)
					return
				}
			}
			target, err := files.RealPath(target)
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					http.NotFound(w, r)
				} else {
					log.Printf("resolving HTML preview resource: %v", err)
					http.Error(w, "could not resolve preview resource", http.StatusInternalServerError)
				}
				return
			}
			if !withinPreviewRoot(root, target) {
				http.NotFound(w, r)
				return
			}
			source, err := files.Open(target)
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					http.NotFound(w, r)
					return
				}
				http.Error(w, "could not open preview resource", http.StatusInternalServerError)
				log.Printf("opening HTML preview resource: %v", err)
				return
			}
			defer source.Close()
			current, err := source.Stat()
			if err != nil {
				http.Error(w, "could not read preview resource information", http.StatusInternalServerError)
				log.Printf("reading HTML preview resource information: %v", err)
				return
			}
			if !current.Mode().IsRegular() {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			if r.Header.Get("Origin") == "null" {
				w.Header().Set("Access-Control-Allow-Origin", "null")
			}
			http.ServeContent(w, r, path.Base(target), current.ModTime(), source)
		}),
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("HTML preview stopped unexpectedly: %v", err)
		}
	}()
	return server, "http://" + listener.Addr().String() + prefix + url.PathEscape(path.Base(resolved)), nil
}

func withinPreviewRoot(root, target string) bool {
	return target == root || strings.HasPrefix(target, strings.TrimSuffix(root, "/")+"/")
}

// StartHTMLPreview serves a remote HTML file and its directory to an isolated local preview.
func (s *Service) StartHTMLPreview(id, remote string) (string, error) {
	s.mu.Lock()
	session := s.browsers[id]
	if session == nil || session.sftp == nil {
		s.mu.Unlock()
		return "", errors.New("file browser session is not connected")
	}
	files := session.sftp
	s.mu.Unlock()
	server, address, err := startHTMLPreview(files, remote)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.browsers[id] != session {
		server.Close()
		return "", errors.New("file browser session was closed")
	}
	if session.previews == nil {
		session.previews = make(map[string]*http.Server)
	}
	session.previews[address] = server
	return address, nil
}

// StopHTMLPreview closes a preview started by this file browser session.
func (s *Service) StopHTMLPreview(id, address string) {
	s.mu.Lock()
	session := s.browsers[id]
	var server *http.Server
	if session != nil {
		server = session.previews[address]
		delete(session.previews, address)
	}
	s.mu.Unlock()
	if server != nil {
		server.Close()
	}
}
