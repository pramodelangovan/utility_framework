package plugins

import (
	"utility_framework/plugins/ssh"
	"utility_framework/plugins/vnc"
)

// All returns every plugin. To add a utility, create plugins/<name>
// and append it here.
func All() []Plugin {
	return []Plugin{
		ssh.New(),
		vnc.New(),
	}
}
