package main

import (
	"context"
	"embed"

	"utility_framework/plugins"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	pluginList := plugins.All()
	bindings := []interface{}{app}
	for _, p := range pluginList {
		bindings = append(bindings, p.Bindings())
	}

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Utility Framework",
		Width:     1100,
		Height:    720,
		MinWidth:  720,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 245, B: 214, A: 1},
		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
			for _, p := range pluginList {
				p.Startup(ctx)
			}
		},
		OnShutdown: func(ctx context.Context) {
			for _, p := range pluginList {
				p.Shutdown()
			}
		},
		Bind: bindings,
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
