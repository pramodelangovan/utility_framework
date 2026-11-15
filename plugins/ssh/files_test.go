package ssh

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	"github.com/zalando/go-keyring"
	gossh "golang.org/x/crypto/ssh"
)

func TestReadImage(t *testing.T) {
	client := testSFTP(t)
	file, err := client.Create("/picture.png")
	if err != nil {
		t.Fatal(err)
	}
	data := []byte{0, 0xff, 1, 2}
	if _, err := file.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := readImage(client, "/picture.png")
	if err != nil || result != base64.StdEncoding.EncodeToString(data) {
		t.Fatalf("image: %q, %v", result, err)
	}
	if _, err := readImage(client, "/missing.png"); err == nil {
		t.Fatal("accepted a missing image")
	}
	if err := client.Mkdir("/folder"); err != nil {
		t.Fatal(err)
	}
	if _, err := readImage(client, "/folder"); err == nil {
		t.Fatal("accepted a directory")
	}
}

func TestReadImageSizeLimit(t *testing.T) {
	client := testSFTP(t)
	file, err := client.Create("/large.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Seek((64<<20)-1, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte{0}); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := client.Stat("/large.png")
	if err != nil || info.Size() != 64<<20 {
		t.Fatalf("unexpected file size at limit: %v, %v", info, err)
	}
	if _, err := readImage(client, "/large.png"); err != nil {
		t.Fatalf("rejected an image at the size limit: %v", err)
	}
	file, err = client.OpenFile("/large.png", os.O_WRONLY)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Seek(64<<20, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte{0}); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	info, err = client.Stat("/large.png")
	if err != nil || info.Size() != (64<<20)+1 {
		t.Fatalf("unexpected oversized file size: %v, %v", info, err)
	}
	if _, err := readImage(client, "/large.png"); err == nil || !strings.Contains(err.Error(), "64 MiB") {
		t.Fatalf("did not reject an oversized image: %v", err)
	}
}

func testSFTP(t *testing.T) *sftp.Client {
	t.Helper()
	serverConn, clientConn := net.Pipe()
	server := sftp.NewRequestServer(serverConn, sftp.InMemHandler())
	go server.Serve()
	client, err := sftp.NewClientPipe(clientConn, clientConn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		client.Close()
		server.Close()
	})
	return client
}

func TestReadTextChunk(t *testing.T) {
	client := testSFTP(t)
	file, err := client.Create("/text.log")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Repeat("a", (64<<10)-1) + "€\nERROR"
	if _, err := file.Write([]byte(text)); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	first, err := readTextChunk(client, "/text.log", 0)
	if err != nil || first.NextOffset != (64<<10)-1 {
		t.Fatalf("first chunk: %+v, %v", first, err)
	}
	second, err := readTextChunk(client, "/text.log", first.NextOffset)
	if err != nil || first.Text+second.Text != text || second.NextOffset != second.Size {
		t.Fatalf("second chunk: %+v, %v", second, err)
	}
	if _, err := readTextChunk(client, "/text.log", second.Size+1); err == nil {
		t.Fatal("accepted an invalid offset")
	}
	binary, err := client.Create("/binary")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := binary.Write([]byte{0, 0xff}); err != nil {
		t.Fatal(err)
	}
	if err := binary.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := readTextChunk(client, "/binary", 0); err == nil {
		t.Fatal("accepted binary data")
	}
}

func TestBrowserSSHAuthentication(t *testing.T) {
	keyring.MockInit()
	_, serverKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hostSigner, err := gossh.NewSignerFromKey(serverKey)
	if err != nil {
		t.Fatal(err)
	}
	_, userKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	userSigner, err := gossh.NewSignerFromKey(userKey)
	if err != nil {
		t.Fatal(err)
	}
	keyBytes, err := x509.MarshalPKCS8PrivateKey(userKey)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(t.TempDir(), "id_key")
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes}), 0o600); err != nil {
		t.Fatal(err)
	}
	config := &gossh.ServerConfig{
		PasswordCallback: func(meta gossh.ConnMetadata, password []byte) (*gossh.Permissions, error) {
			if meta.User() == "test" && string(password) == "secret" {
				return nil, nil
			}
			return nil, gossh.ErrNoAuth
		},
		PublicKeyCallback: func(meta gossh.ConnMetadata, key gossh.PublicKey) (*gossh.Permissions, error) {
			if meta.User() == "test" && string(key.Marshal()) == string(userSigner.PublicKey().Marshal()) {
				return nil, nil
			}
			return nil, gossh.ErrNoAuth
		},
	}
	config.AddHostKey(hostSigner)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				server, channels, requests, err := gossh.NewServerConn(conn, config)
				if err != nil {
					conn.Close()
					return
				}
				defer server.Close()
				go gossh.DiscardRequests(requests)
				for incoming := range channels {
					channel, requests, err := incoming.Accept()
					if err != nil {
						continue
					}
					go func() {
						for request := range requests {
							if request.Type == "subsystem" && string(request.Payload) == "\x00\x00\x00\x04sftp" {
								request.Reply(true, nil)
								_ = sftp.NewRequestServer(channel, sftp.InMemHandler()).Serve()
								return
							}
							request.Reply(false, nil)
						}
					}()
				}
			}()
		}
	}()
	host, portText, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	service := newService()
	service.hosts.path = filepath.Join(t.TempDir(), "known-hosts.json")
	service.logins.path = filepath.Join(t.TempDir(), "logins.json")
	defer service.closeAll()

	login, err := service.SaveLogin(SaveLoginRequest{
		Login:  Login{Host: host, Port: port, Username: "test", AuthMethod: "password"},
		Secret: "secret", SaveSecret: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id  string
		req ConnectRequest
	}{
		{"password", ConnectRequest{Host: host, Port: port, Username: "test", AuthMethod: "password", Password: "secret"}},
		{"saved", ConnectRequest{Host: host, Port: port, Username: "test", AuthMethod: "password", SavedID: login.ID}},
		{"key", ConnectRequest{Host: host, Port: port, Username: "test", AuthMethod: "key", PrivateKeyPath: keyPath}},
	} {
		dir, err := service.ConnectBrowser(tc.id, tc.req)
		if err != nil || dir.Path != "/" {
			t.Fatalf("%s connection: %+v, %v", tc.id, dir, err)
		}
		service.DisconnectBrowser(tc.id)
	}
	_, err = service.ConnectBrowser("bad", ConnectRequest{Host: host, Port: port, Username: "test", Password: "wrong"})
	if err == nil {
		t.Fatal("accepted incorrect password")
	}
	if _, err := service.browser("bad"); err == nil {
		t.Fatal("failed connection left a browser session")
	}
	if _, err := service.ConnectBrowser("mismatch", ConnectRequest{
		Host: "other.example", Port: port, Username: "test", AuthMethod: "password", SavedID: login.ID,
	}); err == nil {
		t.Fatal("allowed a saved password to be sent to a different host")
	}
	if err := keyring.Delete(keyringService, login.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ConnectBrowser("missing-secret", ConnectRequest{
		Host: host, Port: port, Username: "test", AuthMethod: "password", SavedID: login.ID,
	}); err == nil {
		t.Fatal("ignored missing saved password")
	}
}

func TestFileBrowsingAndTransfers(t *testing.T) {
	client := testSFTP(t)
	if err := client.Mkdir("/documents"); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	local := filepath.Join(dir, "upload.txt")
	if err := os.WriteFile(local, []byte("hello SFTP"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := uploadFile(client, local, "/documents/upload.txt"); err != nil {
		t.Fatal(err)
	}
	if err := uploadFile(client, local, "/documents/upload.txt"); err == nil {
		t.Fatal("upload overwrote existing remote file")
	}
	listing, err := listDirectory(client, "/documents")
	if err != nil || listing.Path != "/documents" || len(listing.Entries) != 1 || listing.Entries[0].Name != "upload.txt" {
		t.Fatalf("unexpected directory: %+v, %v", listing, err)
	}
	if entry := listing.Entries[0]; entry.Size != 10 || entry.Permissions != "-rw-r--r--" || entry.Owner != "0 (or unavailable)" {
		t.Fatalf("unexpected file metadata: %+v", entry)
	}
	if listing.OwnerWarning == "" {
		t.Fatal("missing owner lookup warning")
	}
	if err := client.Mkdir("/etc"); err != nil {
		t.Fatal(err)
	}
	passwd, err := client.Create("/etc/passwd")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := passwd.Write([]byte("root:x:0:0:root:/root:/bin/sh\nalice:x:1000:1000::/home/alice:/bin/sh\n")); err != nil {
		t.Fatal(err)
	}
	if err := passwd.Close(); err != nil {
		t.Fatal(err)
	}
	listing, err = listDirectory(client, "/documents")
	if err != nil || listing.OwnerWarning != "" || listing.Entries[0].Owner != "root (UID 0; or unavailable)" {
		t.Fatalf("resolved directory metadata: %+v, %v", listing, err)
	}
	destination := filepath.Join(dir, "download.txt")
	if err := downloadFile(client, "/documents/upload.txt", destination); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "hello SFTP" {
		t.Fatalf("downloaded %q: %v", data, err)
	}
	if err := downloadFile(client, "/documents/upload.txt", destination); err == nil {
		t.Fatal("download overwrote existing local file")
	}
	if err := downloadFile(client, "/documents", filepath.Join(dir, "directory")); err == nil {
		t.Fatal("downloaded a directory")
	}
	if _, err := listDirectory(client, "/missing"); err == nil {
		t.Fatal("listed a missing directory")
	}
}

func TestResolveRemoteOwner(t *testing.T) {
	client := testSFTP(t)
	if err := client.Mkdir("/etc"); err != nil {
		t.Fatal(err)
	}
	passwd, err := client.Create("/etc/passwd")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := passwd.Write([]byte("invalid\nalice:x:1000:1000::/home/alice:/bin/sh\nother:x:1000:1::/:/bin/sh\n")); err != nil {
		t.Fatal(err)
	}
	if err := passwd.Close(); err != nil {
		t.Fatal(err)
	}
	owners, err := remoteOwners(client)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		uid  uint32
		want string
	}{{1000, "alice"}, {1234, "UID 1234 (name unavailable)"}} {
		stat := &sftp.FileStat{UID: tc.uid, Mode: 0100644}
		fi := testFileInfo{FileInfo: info, mode: 0644, stat: stat}
		entry := fileEntry(fi, false)
		resolveOwner(&entry, fi, owners)
		if entry.Owner != tc.want {
			t.Errorf("UID %d: got %q, want %q", tc.uid, entry.Owner, tc.want)
		}
	}
}

type testFileInfo struct {
	os.FileInfo
	mode os.FileMode
	stat any
}

func (i testFileInfo) Mode() os.FileMode { return i.mode }
func (i testFileInfo) Sys() any          { return i.stat }

func TestFileEntryMetadata(t *testing.T) {
	info, err := os.Stat(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name        string
		mode        os.FileMode
		stat        any
		owner       string
		permissions string
	}{
		{"regular", 0640, &sftp.FileStat{UID: 1234, Mode: 0100640}, "1234", "-rw-r-----"},
		{"directory", os.ModeDir | 0755, &sftp.FileStat{UID: 1, Mode: 0040755}, "1", "drwxr-xr-x"},
		{"symlink", os.ModeSymlink | 0777, &sftp.FileStat{UID: 2, Mode: 0120777}, "2", "lrwxrwxrwx"},
		{"special bits", os.ModeSetuid | os.ModeSetgid | os.ModeSticky | 0641, &sftp.FileStat{UID: 3, Mode: 0107641}, "3", "-rwSr-S--t"},
		{"missing mode", 0, &sftp.FileStat{UID: 4}, "4", "Unavailable"},
		{"missing stat", 0644, nil, "Unavailable", "Unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entry := fileEntry(testFileInfo{FileInfo: info, mode: tc.mode, stat: tc.stat}, false)
			if entry.Owner != tc.owner || entry.Permissions != tc.permissions {
				t.Fatalf("got owner %q permissions %q, want %q %q", entry.Owner, entry.Permissions, tc.owner, tc.permissions)
			}
		})
	}
}

func TestBrowserSessionLifecycle(t *testing.T) {
	s := newService()
	s.browsers["pending"] = &browserSession{}
	s.DisconnectBrowser("pending")
	if _, err := s.browser("pending"); err == nil {
		t.Fatal("closed session remained available")
	}
	s.closeAll()
	if _, err := s.ConnectBrowser("new", ConnectRequest{}); err == nil {
		t.Fatal("accepted a browser connection after shutdown")
	}
}
