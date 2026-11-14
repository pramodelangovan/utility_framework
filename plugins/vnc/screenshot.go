package vnc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Crop struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type cropMetadata struct {
	Crop
	TopLeft     point `json:"topLeft"`
	TopRight    point `json:"topRight"`
	BottomLeft  point `json:"bottomLeft"`
	BottomRight point `json:"bottomRight"`
}

type screenshotMetadata struct {
	ImageWidth  int           `json:"imageWidth"`
	ImageHeight int           `json:"imageHeight"`
	Crop        *cropMetadata `json:"crop"`
}

// SaveScreenshot prompts for a parent directory and saves a new named capture folder.
func (s *Service) SaveScreenshot(name, data string, selection Crop, includeCrop bool) (string, error) {
	var crop *Crop
	if includeCrop {
		crop = &selection
	}
	img, err := decodeScreenshot(name, data, crop)
	if err != nil {
		return "", err
	}
	dir, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{Title: "Choose screenshot destination"})
	if err != nil {
		return "", fmt.Errorf("choosing screenshot destination: %w", err)
	}
	if dir == "" {
		return "", nil
	}
	return saveScreenshot(dir, name, img, crop)
}

func validScreenshotName(name string) bool {
	if name == "" || name == "." || name == ".." || strings.TrimSpace(name) != name ||
		strings.HasSuffix(name, ".") || strings.ContainsAny(name, `<>:"/\|?*`) {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	stem := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	switch stem {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return false
	}
	return true
}

func decodeScreenshot(name, data string, crop *Crop) (image.Image, error) {
	if !validScreenshotName(name) {
		return nil, errors.New("enter a valid folder name without path separators or reserved characters")
	}
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(data, prefix) {
		return nil, errors.New("screenshot must be a PNG image")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, prefix))
	if err != nil {
		return nil, fmt.Errorf("decoding screenshot: %w", err)
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("reading screenshot PNG: %w", err)
	}
	bounds := img.Bounds()
	if bounds.Empty() {
		return nil, errors.New("screenshot is empty")
	}
	if crop != nil && (crop.X < 0 || crop.Y < 0 || crop.Width < 1 || crop.Height < 1 ||
		crop.X >= bounds.Dx() || crop.Y >= bounds.Dy() ||
		crop.Width > bounds.Dx()-crop.X || crop.Height > bounds.Dy()-crop.Y) {
		return nil, errors.New("crop must be inside the screenshot")
	}
	return img, nil
}

func saveScreenshot(parent, name string, img image.Image, crop *Crop) (string, error) {
	dir := filepath.Join(parent, name)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return "", fmt.Errorf("creating screenshot folder (choose a name that does not already exist): %w", err)
	}
	writePNG := func(filename string, img image.Image) error {
		file, err := os.OpenFile(filepath.Join(dir, filename), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return err
		}
		err = png.Encode(file, img)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		return closeErr
	}
	fail := func(err error) (string, error) {
		return "", fmt.Errorf("saving screenshot in %s (the folder may contain partial files): %w", dir, err)
	}
	if err := writePNG(name+"_fullscreen.png", img); err != nil {
		return fail(err)
	}
	meta := screenshotMetadata{ImageWidth: img.Bounds().Dx(), ImageHeight: img.Bounds().Dy()}
	if crop != nil {
		r := image.Rect(crop.X, crop.Y, crop.X+crop.Width, crop.Y+crop.Height)
		cropped := image.NewRGBA(image.Rect(0, 0, crop.Width, crop.Height))
		draw.Draw(cropped, cropped.Bounds(), img, img.Bounds().Min.Add(r.Min), draw.Src)
		if err := writePNG(name+"_crop.png", cropped); err != nil {
			return fail(err)
		}
		meta.Crop = &cropMetadata{
			Crop: *crop, TopLeft: point{r.Min.X, r.Min.Y}, TopRight: point{r.Max.X, r.Min.Y},
			BottomLeft: point{r.Min.X, r.Max.Y}, BottomRight: point{r.Max.X, r.Max.Y},
		}
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fail(err)
	}
	file, err := os.OpenFile(filepath.Join(dir, name+"_coord.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fail(err)
	}
	_, writeErr := file.Write(append(data, '\n'))
	closeErr := file.Close()
	if writeErr != nil {
		return fail(writeErr)
	}
	if closeErr != nil {
		return fail(closeErr)
	}
	return dir, nil
}
