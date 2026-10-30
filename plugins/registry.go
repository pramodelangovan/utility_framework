package plugins

import "utility_framework/plugins/ssh"

// All returns every plugin. To add a utility, create plugins/<name>
// and append it here.
func All() []Plugin {
	return []Plugin{
		ssh.New(),
	}
}
