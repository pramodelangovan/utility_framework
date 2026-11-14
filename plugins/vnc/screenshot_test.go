package vnc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func testScreenshot(t *testing.T) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 3))
	for y := 0; y < 3; y++ {
		for x := 0; x < 4; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 50), G: uint8(y * 50), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestSaveScreenshotWithCrop(t *testing.T) {
	crop := &Crop{X: 1, Y: 1, Width: 2, Height: 2}
	img, err := decodeScreenshot("capture", testScreenshot(t), crop)
	if err != nil {
		t.Fatal(err)
	}
	parent := t.TempDir()
	dir, err := saveScreenshot(parent, "capture", img, crop)
	if err != nil {
		t.Fatal(err)
	}
	readImage := func(name string) image.Image {
		t.Helper()
		file, err := os.Open(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		image, err := png.Decode(file)
		if err != nil {
			t.Fatal(err)
		}
		return image
	}
	full := readImage("capture_fullscreen.png")
	cropped := readImage("capture_crop.png")
	if full.Bounds().Dx() != 4 || full.Bounds().Dy() != 3 || cropped.Bounds().Dx() != 2 || cropped.Bounds().Dy() != 2 {
		t.Fatalf("unexpected sizes: full %v, crop %v", full.Bounds(), cropped.Bounds())
	}
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			if cropped.At(x, y) != full.At(x+1, y+1) {
				t.Fatalf("crop pixel %d,%d does not match full image", x, y)
			}
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, "capture_coord.json"))
	if err != nil {
		t.Fatal(err)
	}
	var meta screenshotMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		t.Fatal(err)
	}
	if meta.ImageWidth != 4 || meta.ImageHeight != 3 || meta.Crop == nil ||
		meta.Crop.Crop != *crop || meta.Crop.TopLeft != (point{1, 1}) || meta.Crop.TopRight != (point{3, 1}) ||
		meta.Crop.BottomLeft != (point{1, 3}) || meta.Crop.BottomRight != (point{3, 3}) {
		t.Fatalf("unexpected metadata: %+v", meta)
	}
	if _, err := saveScreenshot(parent, "capture", img, crop); err == nil {
		t.Fatal("existing capture folder was overwritten")
	}
}

func TestSaveScreenshotWithoutCrop(t *testing.T) {
	img, err := decodeScreenshot("full", testScreenshot(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := saveScreenshot(t.TempDir(), "full", img, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "full_crop.png")); !os.IsNotExist(err) {
		t.Fatalf("unexpected crop file: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "full_coord.json"))
	if err != nil {
		t.Fatal(err)
	}
	var meta screenshotMetadata
	if err := json.Unmarshal(data, &meta); err != nil || meta.Crop != nil || meta.ImageWidth != 4 || meta.ImageHeight != 3 {
		t.Fatalf("unexpected metadata: %+v, %v", meta, err)
	}
}

func TestDecodeScreenshotRejectsInvalidInput(t *testing.T) {
	data := testScreenshot(t)
	for _, name := range []string{"", "../escape", "a/b", "NUL", "a.", " a", "a:b"} {
		if _, err := decodeScreenshot(name, data, nil); err == nil {
			t.Errorf("accepted name %q", name)
		}
	}
	for _, crop := range []*Crop{
		{X: -1, Width: 1, Height: 1}, {X: 3, Width: 2, Height: 1},
		{Y: 2, Width: 1, Height: 2}, {Width: 0, Height: 1},
	} {
		if _, err := decodeScreenshot("valid", data, crop); err == nil {
			t.Errorf("accepted crop %+v", crop)
		}
	}
	if _, err := decodeScreenshot("valid", "data:image/png;base64,bad", nil); err == nil {
		t.Fatal("accepted invalid PNG")
	}
}
