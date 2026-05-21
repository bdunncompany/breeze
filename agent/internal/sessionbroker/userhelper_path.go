package sessionbroker

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// UserHelperBinaryName is the on-disk filename of the GUI-subsystem user-helper
// binary installed alongside the agent. Built from the same Go source as the
// agent with `-H windowsgui` so the Windows kernel does not allocate a console
// window when the scheduled task or SYSTEM-context spawn paths launch it in a
// user session. The constant is declared in this platform-independent file so
// resolveUserHelperPath is testable on every OS the agent builds on, even
// though only Windows actually uses the helper binary at runtime.
const UserHelperBinaryName = "breeze-user-helper.exe"

// helperInstallFailedSentinelPath is the marker file written by the helper
// package when an msiexec install of the user-helper times out (see
// agent/internal/helper/install_windows.go). When this file is present the
// sessionbroker MUST refuse to spawn the fallback breeze-agent.exe
// --user-helper subcommand, because doing so just stacks up zombie
// processes that each hit the same broken MSI state. Variable so tests can
// override it. Path is intentionally duplicated rather than imported from
// helper to avoid a new cross-package dependency for one string constant.
var helperInstallFailedSentinelPath = `C:\ProgramData\Breeze\helper_install_failed.lock`

// userHelperSpawnGracePeriod is how long after agent process start the
// sessionbroker suppresses fallback spawns. The agent's own helper.Manager
// is downloading + installing the MSI during the first ~60s of life; if
// the helper binary is missing during this window the right answer is
// "wait for the install to complete", not "spawn a fallback".
var userHelperSpawnGracePeriod = 60 * time.Second

// agentStartTime is captured at package init. The grace-period guard
// compares against this. Variable so tests can shift "start time" without
// patching time.Now or sleeping in CI.
var agentStartTime = time.Now()

// ErrUserHelperFallbackSuppressed is returned by resolveUserHelperPath when
// the fallback to spawning the agent binary as --user-helper is intentionally
// suppressed (either because the helper-install-failed sentinel is present
// or because the agent has been alive less than userHelperSpawnGracePeriod).
// The spawner_windows.go callers treat this as a normal "skip spawn this
// tick" signal — the broker's lifecycle manager will retry on the next
// reconcile tick instead of producing a zombie.
var ErrUserHelperFallbackSuppressed = errors.New("user-helper fallback spawn suppressed (sentinel present or within startup grace period)")

// resolveUserHelperPath picks the right binary path for a user-helper spawn,
// given the running agent's executable path. Pure function modulo the
// filesystem — extracted so it can be tested without depending on Windows
// build tags or os.Executable.
//
//   - sibling present → return sibling path
//   - sibling missing AND (startup grace period OR sentinel present)
//     → return ErrUserHelperFallbackSuppressed (skip spawn)
//   - sibling missing with fs.ErrNotExist outside grace + no sentinel
//     → log Warn + return agentExe (fallback)
//   - any other stat error → wrap and return
//
// The two suppression conditions exist to stop the zombie spawn loop seen
// on TUCKER-NUC133 (drafts/2026-05-21-heartbeat-goroutine-deadlock-analysis.md):
// when the user-helper MSI install is wedged, the helper binary is missing,
// and the previous behaviour silently fell back to spawning the agent
// binary itself per Windows session — accumulating dozens of stuck
// breeze-agent.exe --user-helper processes that each hit the same broken
// MSI state.
//
// The fallback survives outside the suppressed states because some failure
// modes (failed build, AV quarantine, partial upgrade) are recoverable and
// the agent path keeps run_as_user functionality alive at the cost of the
// console-window flash documented in the original comment.
func resolveUserHelperPath(agentExe string) (string, error) {
	helper := filepath.Join(filepath.Dir(agentExe), UserHelperBinaryName)
	_, statErr := os.Stat(helper)
	if statErr == nil {
		return helper, nil
	}
	if errors.Is(statErr, fs.ErrNotExist) {
		// Suppression conditions (any one triggers): we are still inside
		// the startup grace window, OR the helper-install-failed sentinel
		// file is present. Either way, refusing to spawn the fallback is
		// strictly safer than producing yet another zombie.
		if within := time.Since(agentStartTime) < userHelperSpawnGracePeriod; within {
			log.Warn("breeze-user-helper.exe missing inside startup grace period — suppressing fallback spawn",
				"expectedPath", helper,
				"agentUptime", time.Since(agentStartTime).String(),
				"gracePeriod", userHelperSpawnGracePeriod.String(),
			)
			return "", ErrUserHelperFallbackSuppressed
		}
		if _, err := os.Stat(helperInstallFailedSentinelPath); err == nil {
			log.Warn("breeze-user-helper.exe missing and helper-install-failed sentinel present — suppressing fallback spawn to avoid zombie loop",
				"expectedPath", helper,
				"sentinelPath", helperInstallFailedSentinelPath,
			)
			return "", ErrUserHelperFallbackSuppressed
		}
		log.Warn("breeze-user-helper.exe missing — falling back to agent binary; console window will flash at user logon until the install is repaired",
			"expectedPath", helper,
			"fallbackPath", agentExe,
		)
		return agentExe, nil
	}
	return "", fmt.Errorf("stat %s: %w", helper, statErr)
}
