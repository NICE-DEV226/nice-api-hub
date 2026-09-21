// Command nah is the command line and terminal UI for NICE-API'HUB.
package main

import (
	"os"

	"github.com/NICE-DEV226/nice-api-hub/cli/cmd"
)

// Set at build time: -ldflags "-X main.version=... -X main.commit=... -X main.date=...".
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	os.Exit(cmd.Execute(cmd.DefaultEnv(version, commit, date)))
}
