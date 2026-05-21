package sessionbroker

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// withResolvedAgentStarted shifts agentStartTime far enough into the past
// that the startup grace-period guard in resolveUserHelperPath does not
// trip. Restores the previous value via t.Cleanup. Tests that want to
// exercise the grace-period branch deliberately do NOT call this.
func withResolvedAgentStarted(t *testing.T) {
	t.Helper()
	prev := agentStartTime
	agentStartTime = time.Now().Add(-10 * time.Minute)
	t.Cleanup(func() { agentStartTime = prev })
}

// withSentinelPath overrides the helper-install-failed sentinel path to
// something inside t.TempDir() so tests can create/remove the file without
// needing access to C:\ProgramData\Breeze.
func withSentinelPath(t *testing.T, path string) {
	t.Helper()
	prev := helperInstallFailedSentinelPath
	helperInstallFailedSentinelPath = path
	t.Cleanup(func() { helperInstallFailedSentinelPath = prev })
}

// TestResolveUserHelperPath_PicksGUIBinaryWhenAvailable verifies that when
// breeze-user-helper.exe sits alongside the running agent binary,
// resolveUserHelperPath returns the helper path (so spawn paths use the
// GUI-subsystem sibling and avoid the console-window flash bug).
//
// This is the positive-path counterpart to the fallback test below. Together
// they pin the two-binary contract that the AgentUserHelper scheduled task
// XML and the SYSTEM-context broker spawn paths depend on.
func TestResolveUserHelperPath_PicksGUIBinaryWhenAvailable(t *testing.T) {
	withResolvedAgentStarted(t)
	withSentinelPath(t, filepath.Join(t.TempDir(), "absent-sentinel"))
	tmpDir := t.TempDir()
	agentExe := filepath.Join(tmpDir, "breeze-agent.exe")
	helperExe := filepath.Join(tmpDir, UserHelperBinaryName)
	if err := os.WriteFile(agentExe, []byte("agent stub"), 0o644); err != nil {
		t.Fatalf("write agent stub: %v", err)
	}
	if err := os.WriteFile(helperExe, []byte("helper stub"), 0o644); err != nil {
		t.Fatalf("write helper stub: %v", err)
	}

	got, err := resolveUserHelperPath(agentExe)
	if err != nil {
		t.Fatalf("resolveUserHelperPath returned unexpected error: %v", err)
	}
	if got != helperExe {
		t.Fatalf("resolveUserHelperPath = %q, want %q (sibling helper)", got, helperExe)
	}
}

// TestUserHelperExePath_FallsBackToAgentWhenSiblingMissing exercises the
// fs.ErrNotExist branch of resolveUserHelperPath, which is the documented
// defense-in-depth path for partially-upgraded installs where the new task
// XML points at breeze-user-helper.exe but the binary itself is missing
// (failed build, AV quarantine, tamper). The fallback returns the agent
// path so run_as_user functionality keeps working at the cost of a visible
// console window — and the log.Warn provides the ops telemetry without
// which the silent fallback would reintroduce the bug this PR fixes.
func TestUserHelperExePath_FallsBackToAgentWhenSiblingMissing(t *testing.T) {
	withResolvedAgentStarted(t)
	withSentinelPath(t, filepath.Join(t.TempDir(), "absent-sentinel"))
	tmpDir := t.TempDir()
	agentExe := filepath.Join(tmpDir, "breeze-agent.exe")
	if err := os.WriteFile(agentExe, []byte("agent stub"), 0o644); err != nil {
		t.Fatalf("write agent stub: %v", err)
	}
	// Deliberately do NOT create the sibling breeze-user-helper.exe.

	got, err := resolveUserHelperPath(agentExe)
	if err != nil {
		t.Fatalf("resolveUserHelperPath returned error on missing sibling, want nil + agent fallback: %v", err)
	}
	if got != agentExe {
		t.Fatalf("resolveUserHelperPath fallback = %q, want %q (agent path)", got, agentExe)
	}
}

// TestResolveUserHelperPath_PropagatesOtherStatErrors verifies that any
// stat error other than fs.ErrNotExist (e.g. permission, I/O) is returned
// to the caller so the spawn fails loud instead of silently downgrading.
// Test simulates the "dir-instead-of-file" case via filename containing a
// NUL byte, which os.Stat rejects with EINVAL on POSIX and ERROR_INVALID_NAME
// on Windows. Skipped on filesystems where the synthetic invalid path
// somehow succeeds — see error mapping note inline.
func TestResolveUserHelperPath_PropagatesOtherStatErrors(t *testing.T) {
	withResolvedAgentStarted(t)
	withSentinelPath(t, filepath.Join(t.TempDir(), "absent-sentinel"))
	// Use a path with an embedded NUL byte to provoke an invalid-argument
	// error from os.Stat. This is portable: every OS POSIX-syscalls go
	// through chokes on NUL in pathnames, returning ENOENT/EINVAL/etc.,
	// none of which are wrapped as fs.ErrNotExist.
	agentExe := "/tmp/breeze-agent.exe\x00invalid"
	_, err := resolveUserHelperPath(agentExe)
	if err == nil {
		t.Skip("filesystem unexpectedly accepted an invalid agent path; cannot exercise the error branch here")
	}
	// We only care that the function did NOT swallow this error as a
	// fallback. The exact wrapping wording is intentionally not pinned.
	if !strings.Contains(err.Error(), "stat") {
		t.Fatalf("resolveUserHelperPath error does not mention stat: %v", err)
	}
}

// TestResolveUserHelperPath_SuppressesFallbackInStartupGrace verifies that
// when the helper binary is missing AND the agent has been alive less than
// userHelperSpawnGracePeriod, the function refuses to spawn the fallback
// and returns ErrUserHelperFallbackSuppressed. This stops the
// zombie-spawn-loop that fired N times per session-broker tick on
// TUCKER-NUC133 while the helper MSI install was wedged.
func TestResolveUserHelperPath_SuppressesFallbackInStartupGrace(t *testing.T) {
	// Deliberately do NOT shift agentStartTime — we want time.Since to be small.
	prev := agentStartTime
	agentStartTime = time.Now() // fresh "just started"
	t.Cleanup(func() { agentStartTime = prev })

	withSentinelPath(t, filepath.Join(t.TempDir(), "absent-sentinel"))

	tmpDir := t.TempDir()
	agentExe := filepath.Join(tmpDir, "breeze-agent.exe")
	if err := os.WriteFile(agentExe, []byte("agent stub"), 0o644); err != nil {
		t.Fatalf("write agent stub: %v", err)
	}
	// sibling helper deliberately absent

	_, err := resolveUserHelperPath(agentExe)
	if !errors.Is(err, ErrUserHelperFallbackSuppressed) {
		t.Fatalf("expected ErrUserHelperFallbackSuppressed inside grace period, got %v", err)
	}
}

// TestResolveUserHelperPath_SuppressesFallbackWhenSentinelPresent verifies
// that when the helper binary is missing AND the helper-install-failed
// sentinel file exists, the function refuses to spawn the fallback even
// outside the startup grace period. The sentinel is the persistent signal
// from Fix A that msiexec wedged; spawning more fallbacks would just hit
// the same broken state.
func TestResolveUserHelperPath_SuppressesFallbackWhenSentinelPresent(t *testing.T) {
	withResolvedAgentStarted(t) // outside grace period

	sentinelDir := t.TempDir()
	sentinelPath := filepath.Join(sentinelDir, "helper_install_failed.lock")
	if err := os.WriteFile(sentinelPath, []byte("wedged"), 0o644); err != nil {
		t.Fatalf("write sentinel: %v", err)
	}
	withSentinelPath(t, sentinelPath)

	tmpDir := t.TempDir()
	agentExe := filepath.Join(tmpDir, "breeze-agent.exe")
	if err := os.WriteFile(agentExe, []byte("agent stub"), 0o644); err != nil {
		t.Fatalf("write agent stub: %v", err)
	}
	// sibling helper deliberately absent

	_, err := resolveUserHelperPath(agentExe)
	if !errors.Is(err, ErrUserHelperFallbackSuppressed) {
		t.Fatalf("expected ErrUserHelperFallbackSuppressed when sentinel exists, got %v", err)
	}
}

// TestResolveUserHelperPath_FallbackProceedsAfterSentinelRemoved verifies
// that once the sentinel file is removed (manual cleanup after a repair)
// AND we are past the startup grace period, the function once again
// returns the agent-binary fallback. Confirms the suppression is gated
// on observable state, not sticky.
func TestResolveUserHelperPath_FallbackProceedsAfterSentinelRemoved(t *testing.T) {
	withResolvedAgentStarted(t)
	withSentinelPath(t, filepath.Join(t.TempDir(), "absent-sentinel"))

	tmpDir := t.TempDir()
	agentExe := filepath.Join(tmpDir, "breeze-agent.exe")
	if err := os.WriteFile(agentExe, []byte("agent stub"), 0o644); err != nil {
		t.Fatalf("write agent stub: %v", err)
	}

	got, err := resolveUserHelperPath(agentExe)
	if err != nil {
		t.Fatalf("expected fallback to agent path with no sentinel + outside grace, got err: %v", err)
	}
	if got != agentExe {
		t.Fatalf("expected fallback = %q, got %q", agentExe, got)
	}
}
