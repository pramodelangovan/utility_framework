package ssh

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestHTMLPreview(t *testing.T) {
	files := testSFTP(t)
	for _, directory := range []string{"/site", "/site/assets", "/private"} {
		if err := files.Mkdir(directory); err != nil {
			t.Fatal(err)
		}
	}
	for name, content := range map[string]string{
		"/site/index.html":    `<script src="assets/app.js"></script>`,
		"/site/assets/app.js": `document.body.textContent = "working"`,
		"/private/secret.js":  `secret`,
	} {
		file, err := files.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if err := files.Symlink("/private", "/site/external"); err != nil {
		t.Fatal(err)
	}
	server, address, err := startHTMLPreview(files, "/site/index.html")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)
	base := strings.TrimSuffix(address, "index.html")
	request, err := http.NewRequest(http.MethodGet, base+"assets/app.js", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "null")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || !strings.Contains(string(data), "working") ||
		response.Header.Get("Access-Control-Allow-Origin") != "null" ||
		response.Header.Get("Referrer-Policy") != "no-referrer" ||
		!strings.Contains(response.Header.Get("Content-Type"), "javascript") {
		t.Fatalf("asset response: %s, %q, %v", response.Status, data, err)
	}
	for _, target := range []string{base + "../private/secret.js", base + "%2e%2e/private/secret.js",
		base + "external/secret.js", base + "missing.js"} {
		response, err := client.Get(target)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("unexpected access to %q: %s", target, response.Status)
		}
	}
	request, err = http.NewRequest(http.MethodGet, address, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "example.com"
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("unexpected host accepted: %s", response.Status)
	}

	service := newService()
	service.browsers["preview"] = &browserSession{sftp: files, previews: map[string]*http.Server{address: server}}
	service.StopHTMLPreview("preview", address)
	if _, err := client.Get(address); err == nil {
		t.Fatal("preview still accessible after closing")
	}
	service.StopHTMLPreview("preview", address)
}

func TestHTMLPreviewRejectsMissingFilesAndDirectories(t *testing.T) {
	files := testSFTP(t)
	if _, _, err := startHTMLPreview(files, "/missing.html"); err == nil {
		t.Fatal("accepted a missing HTML file")
	}
	if err := files.Mkdir("/folder"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := startHTMLPreview(files, "/folder"); err == nil {
		t.Fatal("accepted a directory")
	}
	file, err := files.Create("/index.html")
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if err := files.Symlink("/index.html", "/link.html"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := startHTMLPreview(files, "/link.html"); err == nil {
		t.Fatal("accepted a symbolic link")
	}
}
