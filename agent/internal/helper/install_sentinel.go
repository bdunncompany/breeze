package helper

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// writeHelperInstallFailedSentinel best-effort creates the marker file at
// path that tells the sessionbroker "user-helper MSI install is wedged or
// broken; do not keep spawning fallback breeze-agent.exe --user-helper
// processes." Returns nil on success. Errors are returned so tests can
// observe them; production callers (Windows install_windows.go) log + ignore.
//
// Lives in a cross-platform file so the sentinel behavior is unit-testable
// on Linux/Mac without a Windows runner. Only the msiexec.exe call path on
// Windows actually invokes this in production.
func writeHelperInstallFailedSentinel(path string) error {
	if path == "" {
		return fmt.Errorf("empty sentinel path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("mkdir sentinel dir: %w", err)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("open sentinel: %w", err)
	}
	defer f.Close()
	if _, err := fmt.Fprintf(f, "msiexec install timed out at %s\n",
		time.Now().UTC().Format(time.RFC3339)); err != nil {
		return fmt.Errorf("write sentinel: %w", err)
	}
	return nil
}
