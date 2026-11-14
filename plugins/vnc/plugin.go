package vnc

import "context"

type Plugin struct {
	svc *Service
}

func New() *Plugin { return &Plugin{svc: newService()} }

func (p *Plugin) Startup(ctx context.Context) { p.svc.ctx = ctx }

func (p *Plugin) Shutdown() { p.svc.closeAll() }

func (p *Plugin) Bindings() any { return p.svc }
