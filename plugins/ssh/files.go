package ssh

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/zalando/go-keyring"
	gossh "golang.org/x/crypto/ssh"
)

type browserSession struct {
	client   *gossh.Client
	sftp     *sftp.Client
	streams  []*http.Server
	previews map[string]*http.Server
}

type FileEntry struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	Modified    string `json:"modified"`
	IsDir       bool   `json:"isDir"`
	Owner       string `json:"owner"`
	Permissions string `json:"permissions"`
}

type Directory struct {
	Path         string      `json:"path"`
	Entries      []FileEntry `json:"entries"`
	OwnerWarning string      `json:"ownerWarning"`
}

type TextChunk struct {
	Text       string `json:"text"`
	Offset     int64  `json:"offset"`
	NextOffset int64  `json:"nextOffset"`
	Size       int64  `json:"size"`
}

// ReadImage reads a remote image as base64 for the image viewer.
func (s *Service) ReadImage(id, remote string) (string, error) {
	files, err := s.browser(id)
	if err != nil {
		return "", err
	}
	return readImage(files, remote)
}

func readImage(files *sftp.Client, remote string) (string, error) {
	const maxImageSize = 64 << 20
	file, err := files.Open(remote)
	if err != nil {
		return "", fmt.Errorf("opening remote image: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", fmt.Errorf("reading remote image information: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("only regular files can be viewed")
	}
	if info.Size() > maxImageSize {
		return "", errors.New("image exceeds the 64 MiB viewer limit")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxImageSize+1))
	if err != nil {
		return "", fmt.Errorf("reading remote image: %w", err)
	}
	if len(data) > maxImageSize {
		return "", errors.New("image exceeds the 64 MiB viewer limit")
	}
	if int64(len(data)) != info.Size() {
		return "", errors.New("remote image changed while reading; reopen the file")
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// ReadTextChunk reads a bounded, UTF-8-aligned page of a remote regular file.
func (s *Service) ReadTextChunk(id, remote string, offset int64) (TextChunk, error) {
	files, err := s.browser(id)
	if err != nil {
		return TextChunk{}, err
	}
	return readTextChunk(files, remote, offset)
}

func readTextChunk(files *sftp.Client, remote string, offset int64) (TextChunk, error) {
	const chunkSize = 64 << 10
	file, err := files.Open(remote)
	if err != nil {
		return TextChunk{}, fmt.Errorf("opening remote file: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return TextChunk{}, fmt.Errorf("reading remote file information: %w", err)
	}
	if !info.Mode().IsRegular() {
		return TextChunk{}, errors.New("only regular files can be viewed")
	}
	if offset < 0 || offset > info.Size() {
		return TextChunk{}, errors.New("file position is no longer valid; reopen the file")
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return TextChunk{}, fmt.Errorf("seeking remote file: %w", err)
	}
	buf := make([]byte, chunkSize)
	n, err := io.ReadFull(file, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return TextChunk{}, fmt.Errorf("reading remote file: %w", err)
	}
	buf = buf[:n]
	if offset+int64(n) < info.Size() && n < chunkSize {
		return TextChunk{}, errors.New("remote file changed while reading; reopen the file")
	}
	end := 0
	for end < len(buf) {
		if !utf8.FullRune(buf[end:]) && offset+int64(n) < info.Size() {
			break
		}
		r, width := utf8.DecodeRune(buf[end:])
		if r == utf8.RuneError && width == 1 || r == 0 {
			return TextChunk{}, errors.New("file is not UTF-8 text or contains binary data")
		}
		end += width
	}
	return TextChunk{Text: string(buf[:end]), Offset: offset, NextOffset: offset + int64(end), Size: info.Size()}, nil
}

func remoteOwners(files *sftp.Client) (map[uint32]string, error) {
	const maxPasswdSize = 4 << 20
	file, err := files.Open("/etc/passwd")
	if err != nil {
		return nil, fmt.Errorf("opening remote /etc/passwd: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxPasswdSize+1))
	if err != nil {
		return nil, fmt.Errorf("reading remote /etc/passwd: %w", err)
	}
	if len(data) > maxPasswdSize {
		return nil, errors.New("remote /etc/passwd exceeds the size limit")
	}
	owners := make(map[uint32]string)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) < 7 || fields[0] == "" {
			continue
		}
		uid, err := strconv.ParseUint(fields[2], 10, 32)
		if err != nil {
			continue
		}
		if _, exists := owners[uint32(uid)]; !exists {
			owners[uint32(uid)] = fields[0]
		}
	}
	return owners, nil
}

func resolveOwner(entry *FileEntry, info os.FileInfo, owners map[uint32]string) {
	stat, ok := info.Sys().(*sftp.FileStat)
	if !ok || stat == nil {
		return
	}
	if name, ok := owners[stat.UID]; ok {
		if stat.UID == 0 {
			entry.Owner = name + " (UID 0; or unavailable)"
		} else {
			entry.Owner = name
		}
	} else if stat.UID != 0 {
		entry.Owner = "UID " + strconv.FormatUint(uint64(stat.UID), 10) + " (name unavailable)"
	}
}

func unixPermissions(mode os.FileMode) string {
	kind := byte('-')
	switch {
	case mode.IsDir():
		kind = 'd'
	case mode&os.ModeSymlink != 0:
		kind = 'l'
	case mode&os.ModeNamedPipe != 0:
		kind = 'p'
	case mode&os.ModeSocket != 0:
		kind = 's'
	case mode&os.ModeCharDevice != 0:
		kind = 'c'
	case mode&os.ModeDevice != 0:
		kind = 'b'
	}
	result := []byte{kind, '-', '-', '-', '-', '-', '-', '-', '-', '-'}
	for i, bit := range []os.FileMode{0400, 0200, 0100, 0040, 0020, 0010, 0004, 0002, 0001} {
		if mode&bit != 0 {
			result[i+1] = "rwx"[i%3]
		}
	}
	for _, special := range []struct {
		bit      os.FileMode
		position int
		lower    byte
		upper    byte
	}{{os.ModeSetuid, 3, 's', 'S'}, {os.ModeSetgid, 6, 's', 'S'}, {os.ModeSticky, 9, 't', 'T'}} {
		if mode&special.bit != 0 {
			if result[special.position] == 'x' {
				result[special.position] = special.lower
			} else {
				result[special.position] = special.upper
			}
		}
	}
	return string(result)
}

func fileEntry(info os.FileInfo, isDir bool) FileEntry {
	entry := FileEntry{
		Name: info.Name(), Size: info.Size(), Modified: info.ModTime().Format("2006-01-02 15:04:05"),
		IsDir: isDir, Owner: "Unavailable", Permissions: "Unavailable",
	}
	if stat, ok := info.Sys().(*sftp.FileStat); ok && stat != nil {
		entry.Owner = strconv.FormatUint(uint64(stat.UID), 10)
		if stat.UID == 0 {
			entry.Owner = "0 (or unavailable)"
		}
		if stat.Mode != 0 {
			entry.Permissions = unixPermissions(info.Mode())
		}
	}
	return entry
}

// ConnectBrowser opens an independent SFTP session using the SSH login settings.
func (s *Service) ConnectBrowser(id string, req ConnectRequest) (Directory, error) {
	if id == "" {
		return Directory{}, errors.New("session id is required")
	}
	if req.SavedID != "" {
		login, ok := s.logins.find(req.SavedID)
		port := req.Port
		if port == 0 {
			port = 22
		}
		if !ok || login.Host != req.Host || login.Port != port || login.Username != req.Username ||
			login.AuthMethod != req.AuthMethod || login.PrivateKeyPath != req.PrivateKeyPath {
			return Directory{}, errors.New("saved login does not match the requested connection")
		}
		if login.HasSecret && ((req.AuthMethod == "key" && req.Passphrase == "") ||
			(req.AuthMethod != "key" && req.Password == "")) {
			secret, err := keyring.Get(keyringService, req.SavedID)
			if err != nil {
				return Directory{}, fmt.Errorf("reading saved SSH credential: %w", err)
			}
			if req.AuthMethod == "key" {
				req.Passphrase = secret
			} else {
				req.Password = secret
			}
		}
		req.SavedID = ""
	}
	pending := &browserSession{}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return Directory{}, errors.New("SSH service has shut down")
	}
	if _, exists := s.browsers[id]; exists {
		s.mu.Unlock()
		return Directory{}, errors.New("file browser session already exists")
	}
	s.browsers[id] = pending
	s.mu.Unlock()

	client, err := s.dial(req)
	if err != nil {
		s.removeBrowser(id, pending)
		return Directory{}, fmt.Errorf("connecting to SSH: %w", err)
	}
	s.mu.Lock()
	if s.browsers[id] != pending {
		s.mu.Unlock()
		client.Close()
		return Directory{}, errors.New("file browser session was closed")
	}
	pending.client = client
	s.mu.Unlock()
	files, err := sftp.NewClient(client)
	if err != nil {
		s.removeBrowser(id, pending)
		return Directory{}, fmt.Errorf("opening SFTP: %w", err)
	}
	s.mu.Lock()
	if s.browsers[id] != pending {
		s.mu.Unlock()
		files.Close()
		client.Close()
		return Directory{}, errors.New("file browser session was closed")
	}
	pending.sftp = files
	s.mu.Unlock()
	dir, err := listDirectory(files, ".")
	if err != nil {
		s.removeBrowser(id, pending)
		return Directory{}, err
	}
	return dir, nil
}

func (s *Service) browser(id string) (*sftp.Client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session := s.browsers[id]
	if session == nil || session.sftp == nil {
		return nil, errors.New("file browser session is not connected")
	}
	return session.sftp, nil
}

func (s *Service) DisconnectBrowser(id string) {
	s.removeBrowser(id, nil)
}

func (s *Service) removeBrowser(id string, expected *browserSession) {
	s.mu.Lock()
	session := s.browsers[id]
	if expected != nil && session != expected {
		session = nil
	} else {
		delete(s.browsers, id)
	}
	s.mu.Unlock()
	if session != nil {
		for _, server := range session.streams {
			server.Close()
		}
		for _, server := range session.previews {
			server.Close()
		}
		if session.client != nil {
			session.client.Close()
		}
	}
}

func listDirectory(files *sftp.Client, dir string) (Directory, error) {
	resolved, err := files.RealPath(dir)
	if err != nil {
		return Directory{}, fmt.Errorf("opening directory: %w", err)
	}
	infos, err := files.ReadDir(resolved)
	if err != nil {
		return Directory{}, fmt.Errorf("reading directory: %w", err)
	}
	var owners map[uint32]string
	var ownerErr error
	if len(infos) > 0 {
		owners, ownerErr = remoteOwners(files)
	}
	entries := make([]FileEntry, 0, len(infos))
	for _, info := range infos {
		isDir := info.IsDir()
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := files.Stat(path.Join(resolved, info.Name()))
			if err == nil {
				isDir = target.IsDir()
			}
		}
		entry := fileEntry(info, isDir)
		resolveOwner(&entry, info, owners)
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	result := Directory{Path: resolved, Entries: entries}
	if ownerErr != nil {
		result.OwnerWarning = "Owner names unavailable: " + ownerErr.Error()
	}
	return result, nil
}

func (s *Service) ListDirectory(id, dir string) (Directory, error) {
	files, err := s.browser(id)
	if err != nil {
		return Directory{}, err
	}
	return listDirectory(files, dir)
}

// UploadFile selects one local file and uploads it without overwriting a remote file.
func (s *Service) UploadFile(id, remoteDir string) (string, error) {
	files, err := s.browser(id)
	if err != nil {
		return "", err
	}
	local, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{Title: "Choose a file to upload"})
	if err != nil || local == "" {
		return "", err
	}
	remote := path.Join(remoteDir, filepath.Base(local))
	if err := uploadFile(files, local, remote); err != nil {
		return "", err
	}
	return remote, nil
}

func uploadFile(files *sftp.Client, local, remote string) error {
	src, err := os.Open(local)
	if err != nil {
		return fmt.Errorf("opening local file: %w", err)
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return fmt.Errorf("reading local file information: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("only regular files can be uploaded")
	}
	dst, err := files.OpenFile(remote, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return fmt.Errorf("creating remote file (existing files are not overwritten): %w", err)
	}
	_, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if err := errors.Join(copyErr, closeErr); err != nil {
		removeErr := files.Remove(remote)
		return fmt.Errorf("upload failed: %w", errors.Join(err, removeErr))
	}
	return nil
}

// DownloadFile selects a local destination and downloads without overwriting.
func (s *Service) DownloadFile(id, remote string) (string, error) {
	files, err := s.browser(id)
	if err != nil {
		return "", err
	}
	local, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title: "Save downloaded file", DefaultFilename: path.Base(remote),
	})
	if err != nil || local == "" {
		return "", err
	}
	if err := downloadFile(files, remote, local); err != nil {
		return "", err
	}
	return local, nil
}

func downloadFile(files *sftp.Client, remote, local string) error {
	src, err := files.Open(remote)
	if err != nil {
		return fmt.Errorf("opening remote file: %w", err)
	}
	defer src.Close()
	info, err := src.Stat()
	if err != nil {
		return fmt.Errorf("reading remote file information: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("only regular files can be downloaded")
	}
	dst, err := os.OpenFile(local, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("creating local file (existing files are not overwritten): %w", err)
	}
	_, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if err := errors.Join(copyErr, closeErr); err != nil {
		removeErr := os.Remove(local)
		return fmt.Errorf("download failed: %w", errors.Join(err, removeErr))
	}
	return nil
}
