package ssh

import (
	"io"
	"net/http"
	"testing"
	"time"
)

func TestVideoStream(t *testing.T) {
	files := testSFTP(t)
	file, err := files.Create("/movie.mpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("0123456789")); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	server, url, err := startVideoStream(files, "/movie.mpg")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{}}
	t.Cleanup(client.CloseIdleConnections)

	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Range", "bytes=3-5")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusPartialContent || string(data) != "345" ||
		response.Header.Get("Content-Range") != "bytes 3-5/10" {
		t.Fatalf("range response: %s, %q, %q, %v", response.Status, data, response.Header.Get("Content-Range"), err)
	}

	response, err = client.Head(url)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength != 10 {
		t.Fatalf("HEAD response: %s, length %d", response.Status, response.ContentLength)
	}

	request, err = http.NewRequest(http.MethodGet, url, nil)
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
	response, err = client.Get(url + "wrong")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("invalid token accepted: %s", response.Status)
	}

	service := newService()
	service.browsers["video"] = &browserSession{sftp: files, streams: []*http.Server{server}}
	service.DisconnectBrowser("video")
	if _, err := client.Get(url); err == nil {
		t.Fatal("stream still accessible after disconnect")
	}
}

func TestVideoStreamRejectsMissingFilesAndDirectories(t *testing.T) {
	files := testSFTP(t)
	if _, _, err := startVideoStream(files, "/missing.mpg"); err == nil {
		t.Fatal("accepted a missing video")
	}
	if err := files.Mkdir("/folder"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := startVideoStream(files, "/folder"); err == nil {
		t.Fatalf("accepted a directory: %v", err)
	}
}

func TestPlayVideoWithoutVLC(t *testing.T) {
	t.Setenv("PATH", "")
	t.Setenv("ProgramFiles", "")
	t.Setenv("ProgramFiles(x86)", "")
	t.Setenv("LOCALAPPDATA", "")
	if _, found := findVLC(); found {
		t.Skip("VLC is installed in a system location")
	}
	service := newService()
	service.browsers["video"] = &browserSession{sftp: testSFTP(t)}
	started, err := service.PlayVideo("video", "/movie.mpg")
	if err != nil || started {
		t.Fatalf("missing VLC: started=%v, error=%v", started, err)
	}
	if _, err := service.PlayVideo("missing", "/movie.mpg"); err == nil {
		t.Fatal("accepted a missing browser session")
	}
}
