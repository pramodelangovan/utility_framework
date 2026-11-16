package ssh

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"time"

	"github.com/pkg/sftp"
)

func findVLC() (string, bool) {
	if executable, err := exec.LookPath("vlc"); err == nil {
		return executable, true
	}
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		for _, variable := range []string{"ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"} {
			if dir := os.Getenv(variable); dir != "" {
				candidates = append(candidates, filepath.Join(dir, "VideoLAN", "VLC", "vlc.exe"))
			}
		}
	case "darwin":
		candidates = append(candidates, "/Applications/VLC.app/Contents/MacOS/VLC")
		if home, err := os.UserHomeDir(); err == nil {
			candidates = append(candidates, filepath.Join(home, "Applications", "VLC.app", "Contents", "MacOS", "VLC"))
		}
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, true
		}
	}
	return "", false
}

func findPotPlayer() (string, bool) {
	if runtime.GOOS != "windows" {
		return "", false
	}
	names := []string{"PotPlayerMini64.exe", "PotPlayerMini.exe", "PotPlayer64.exe", "PotPlayer.exe"}
	for _, name := range names {
		if executable, err := exec.LookPath(name); err == nil {
			return executable, true
		}
	}
	locations := []string{
		filepath.Join("DAUM", "PotPlayer"), "PotPlayer",
		filepath.Join("Programs", "DAUM", "PotPlayer"), filepath.Join("Programs", "PotPlayer"),
	}
	for _, variable := range []string{"ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA"} {
		if dir := os.Getenv(variable); dir != "" {
			for _, location := range locations {
				for _, name := range names {
					candidate := filepath.Join(dir, location, name)
					if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
						return candidate, true
					}
				}
			}
		}
	}
	return "", false
}

func startVideoStream(files *sftp.Client, remote string) (*http.Server, string, error) {
	file, err := files.Open(remote)
	if err != nil {
		return nil, "", fmt.Errorf("opening remote video: %w", err)
	}
	info, err := file.Stat()
	file.Close()
	if err != nil {
		return nil, "", fmt.Errorf("reading remote video information: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, "", errors.New("only regular files can be played")
	}

	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return nil, "", fmt.Errorf("creating video stream token: %w", err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, "", fmt.Errorf("starting video stream: %w", err)
	}
	streamPath := "/" + hex.EncodeToString(token)
	server := &http.Server{
		ReadHeaderTimeout: 10 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != listener.Addr().String() || r.URL.Path != streamPath {
				http.NotFound(w, r)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			source, err := files.Open(remote)
			if err != nil {
				log.Printf("opening remote video stream: %v", err)
				http.Error(w, "could not open remote video", http.StatusInternalServerError)
				return
			}
			defer source.Close()
			current, err := source.Stat()
			if err != nil {
				log.Printf("reading remote video stream information: %v", err)
				http.Error(w, "could not read remote video information", http.StatusInternalServerError)
				return
			}
			if !current.Mode().IsRegular() {
				http.Error(w, "remote video is not a regular file", http.StatusBadRequest)
				return
			}
			http.ServeContent(w, r, path.Base(remote), current.ModTime(), source)
		}),
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("video stream stopped unexpectedly: %v", err)
		}
	}()
	return server, "http://" + listener.Addr().String() + streamPath, nil
}

// PlayVideo streams a remote file to VLC. It returns false when VLC is not installed.
func (s *Service) PlayVideo(id, remote string) (bool, error) {
	return s.playVideo(id, remote, "VLC", findVLC)
}

// PlayVideoInPotPlayer streams a remote file to PotPlayer. It returns false when PotPlayer is not installed.
func (s *Service) PlayVideoInPotPlayer(id, remote string) (bool, error) {
	return s.playVideo(id, remote, "PotPlayer", findPotPlayer)
}

func (s *Service) playVideo(id, remote, player string, findPlayer func() (string, bool)) (bool, error) {
	s.mu.Lock()
	session := s.browsers[id]
	if session == nil || session.sftp == nil {
		s.mu.Unlock()
		return false, errors.New("file browser session is not connected")
	}
	files := session.sftp
	s.mu.Unlock()
	executable, found := findPlayer()
	if !found {
		return false, nil
	}

	server, url, err := startVideoStream(files, remote)
	if err != nil {
		return false, err
	}
	s.mu.Lock()
	if s.browsers[id] != session {
		s.mu.Unlock()
		server.Close()
		return false, errors.New("file browser session was closed")
	}
	cmd := exec.Command(executable, url)
	if err := cmd.Start(); err != nil {
		s.mu.Unlock()
		server.Close()
		return false, fmt.Errorf("starting %s: %w", player, err)
	}
	session.streams = append(session.streams, server)
	s.mu.Unlock()
	go func() {
		if err := cmd.Wait(); err != nil {
			log.Printf("%s exited with an error: %v", player, err)
		}
	}()
	return true, nil
}
