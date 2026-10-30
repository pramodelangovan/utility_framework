package plugins

import "context"

// Plugin is a self-contained utility. Each plugin lives in its own folder
// under plugins/ and is registered in registry.go.
type Plugin interface {
	// Startup is called once the Wails runtime is ready.
	Startup(ctx context.Context)
	// Shutdown is called when the app closes.
	Shutdown()
	// Bindings returns the object whose exported methods are callable from the frontend.
	Bindings() any
}
