package helper

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestWriteHelperInstallFailedSentinel_CreatesFileWithTimestamp asserts the
// sentinel writer creates the parent dir, writes the file, and the file
// content includes an RFC3339 timestamp marker. The sentinel itself is the
// signal — content is informational — but we want to verify the file is
// reachable from a fresh path and the body is non-empty so ops can pull a
// hint at when the wedge first fired.
func TestWriteHelperInstallFailedSentinel_CreatesFileWithTimestamp(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "subdir", "helper_install_failed.lock")

	if err := writeHelperInstallFailedSentinel(path); err != nil {
		t.Fatalf("writeHelperInstallFailedSentinel returned unexpected error: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("sentinel file not created at %s: %v", path, err)
	}
	if info.Size() == 0 {
		t.Fatalf("sentinel file is empty; expected timestamp marker")
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read sentinel: %v", err)
	}
	if !strings.Contains(string(body), "msiexec install timed out at") {
		t.Fatalf("sentinel missing expected marker text:\n%s", string(body))
	}
}

// TestWriteHelperInstallFailedSentinel_EmptyPathRejected asserts the writer
// rejects an empty path rather than producing a file at "/" or in cwd —
// the production path is hardcoded and non-empty, so an empty path here
// means a programming bug we want to surface loudly.
func TestWriteHelperInstallFailedSentinel_EmptyPathRejected(t *testing.T) {
	if err := writeHelperInstallFailedSentinel(""); err == nil {
		t.Fatal("expected error for empty path, got nil")
	}
}

// TestWriteHelperInstallFailedSentinel_Idempotent verifies the writer
// truncates an existing sentinel rather than appending. The marker file's
// purpose is "broken; do not spawn" — multiple writes from successive
// install timeouts should leave a single fresh timestamp, not stack up.
func TestWriteHelperInstallFailedSentinel_Idempotent(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "helper_install_failed.lock")

	if err := writeHelperInstallFailedSentinel(path); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := writeHelperInstallFailedSentinel(path); err != nil {
		t.Fatalf("second write: %v", err)
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read sentinel: %v", err)
	}
	// Exactly one timestamp line, not two.
	count := strings.Count(string(body), "msiexec install timed out at")
	if count != 1 {
		t.Fatalf("sentinel should contain one marker line, got %d:\n%s", count, string(body))
	}
}
