package heartbeat

import (
	"bytes"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/breeze-rmm/agent/internal/logging"
)

// syncBuffer is a goroutine-safe wrapper around bytes.Buffer for concurrent
// writers (the test goroutine and the watchdog goroutine both emit logs).
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

// watchdogTestHarness installs a tiny heartbeatWatchdogTimeout and redirects
// the logger into a buffer. Everything is restored via t.Cleanup.
func watchdogTestHarness(t *testing.T, timeout time.Duration) *syncBuffer {
	t.Helper()
	prev := setHeartbeatWatchdogTimeout(timeout)
	t.Cleanup(func() { setHeartbeatWatchdogTimeout(prev) })

	buf := &syncBuffer{}
	logging.Init("text", "debug", buf)
	t.Cleanup(func() { logging.Init("text", "info", nil) })
	return buf
}

// TestSendHeartbeatWatchdogFiresWhenBlocked verifies that a sendHeartbeat
// impl that blocks longer than heartbeatWatchdogTimeout causes the watchdog
// to log a stack dump.
func TestSendHeartbeatWatchdogFiresWhenBlocked(t *testing.T) {
	buf := watchdogTestHarness(t, 50*time.Millisecond)

	release := make(chan struct{})
	started := make(chan struct{})
	var once sync.Once

	h := &Heartbeat{
		sendHeartbeatFn: func() {
			once.Do(func() { close(started) })
			<-release
		},
	}

	done := make(chan struct{})
	go func() {
		h.sendHeartbeatWithWatchdog()
		close(done)
	}()

	<-started
	// Wait well past the 50ms watchdog timeout so the goroutine-dump warn fires.
	time.Sleep(150 * time.Millisecond)
	close(release)
	<-done

	output := buf.String()
	if !strings.Contains(output, "heartbeat send exceeded watchdog timeout") {
		t.Fatalf("expected watchdog warning, got:\n%s", output)
	}
	if !strings.Contains(output, "goroutines=") {
		t.Fatalf("expected goroutines= stack-dump field, got:\n%s", output)
	}
}

// TestSendHeartbeatWatchdogDoesNotFireOnFastPath verifies that a
// sendHeartbeat that returns quickly does NOT trip the watchdog warning.
func TestSendHeartbeatWatchdogDoesNotFireOnFastPath(t *testing.T) {
	buf := watchdogTestHarness(t, 100*time.Millisecond)

	h := &Heartbeat{
		sendHeartbeatFn: func() {
			// Return immediately.
		},
	}

	h.sendHeartbeatWithWatchdog()

	// Give any late-firing watchdog goroutine a chance to warn (it should NOT).
	time.Sleep(250 * time.Millisecond)

	if strings.Contains(buf.String(), "heartbeat send exceeded watchdog timeout") {
		t.Fatalf("watchdog should not fire on fast path, got:\n%s", buf.String())
	}
}

// TestSendHeartbeatWatchdogCancelsOnPanic verifies that a panic inside
// sendHeartbeat still closes the watchdog done channel via the deferred
// close(done), so the watchdog goroutine does not emit a misleading
// "exceeded" warning after the wrapper unwinds the panic.
func TestSendHeartbeatWatchdogCancelsOnPanic(t *testing.T) {
	buf := watchdogTestHarness(t, 50*time.Millisecond)

	h := &Heartbeat{
		sendHeartbeatFn: func() {
			panic("intentional test panic")
		},
	}

	func() {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("expected panic to propagate out of watchdog wrapper")
			}
		}()
		h.sendHeartbeatWithWatchdog()
	}()

	// Wait longer than the watchdog timeout. The deferred close(done) must
	// have fired as the panic unwound, so no warning should be emitted.
	time.Sleep(150 * time.Millisecond)

	if strings.Contains(buf.String(), "heartbeat send exceeded watchdog timeout") {
		t.Fatalf("watchdog fired after panic unwound; deferred close(done) must cancel it:\n%s",
			buf.String())
	}
}

// TestSendHeartbeatWatchdog_SingleMissDoesNotExit verifies that one
// transient watchdog miss only logs + increments the counter, it does NOT
// trigger the escalation exit. This pins the "one slow tick can be
// transient" semantics described in the heartbeat.go comment.
func TestSendHeartbeatWatchdog_SingleMissDoesNotExit(t *testing.T) {
	buf := watchdogTestHarness(t, 50*time.Millisecond)

	exitCalls := 0
	release := make(chan struct{})
	started := make(chan struct{})
	var once sync.Once
	h := &Heartbeat{
		sendHeartbeatFn: func() {
			once.Do(func() { close(started) })
			<-release
		},
		watchdogExitFn: func(int) { exitCalls++ },
	}

	done := make(chan struct{})
	go func() {
		h.sendHeartbeatWithWatchdog()
		close(done)
	}()
	<-started
	// Wait past the 50ms watchdog so the warn fires once.
	time.Sleep(150 * time.Millisecond)
	close(release)
	<-done

	if exitCalls != 0 {
		t.Fatalf("watchdog exitFn called %d times after a single miss; want 0", exitCalls)
	}
	if !strings.Contains(buf.String(), "heartbeat send exceeded watchdog timeout") {
		t.Fatalf("expected first-miss warning, got:\n%s", buf.String())
	}
	if strings.Contains(buf.String(), "consecutive miss threshold reached") {
		t.Fatalf("escalation log fired on a single miss:\n%s", buf.String())
	}
}

// TestSendHeartbeatWatchdog_TwoConsecutiveMissesEscalates verifies that
// two consecutive misses cross the threshold and trigger watchdogExitFn(1).
// This is the recovery path that lets SCM Service Recovery restart a
// wedged agent instead of leaving it stuck forever.
func TestSendHeartbeatWatchdog_TwoConsecutiveMissesEscalates(t *testing.T) {
	buf := watchdogTestHarness(t, 30*time.Millisecond)

	var exitCalls int32
	exitGot := make(chan int, 1)
	h := &Heartbeat{
		watchdogExitFn: func(code int) {
			atomic.AddInt32(&exitCalls, 1)
			select {
			case exitGot <- code:
			default:
			}
		},
	}

	// Build a sendHeartbeatFn that blocks long enough on each invocation to
	// trigger the watchdog. We run the wrapper twice in sequence so the
	// counter accumulates without an intervening clean return.
	for i := 0; i < 2; i++ {
		release := make(chan struct{})
		started := make(chan struct{})
		var once sync.Once
		h.sendHeartbeatFn = func() {
			once.Do(func() { close(started) })
			<-release
		}
		done := make(chan struct{})
		go func() {
			h.sendHeartbeatWithWatchdog()
			close(done)
		}()
		<-started
		time.Sleep(90 * time.Millisecond) // 3x watchdog so it fires
		close(release)
		<-done
	}

	if got := atomic.LoadInt32(&exitCalls); got != 1 {
		t.Fatalf("expected exactly 1 exit call after 2 misses, got %d", got)
	}
	select {
	case code := <-exitGot:
		if code != 1 {
			t.Fatalf("exit code = %d, want 1", code)
		}
	default:
		t.Fatal("exit code channel empty")
	}
	if !strings.Contains(buf.String(), "consecutive miss threshold reached") {
		t.Fatalf("expected escalation log line, got:\n%s", buf.String())
	}
}

// TestSendHeartbeatWatchdog_CleanReturnResetsMissCounter verifies that a
// successful (fast) heartbeat between two slow ticks clears the consecutive
// counter, so an isolated slow tick on either side stays under the
// escalation threshold and does NOT kill a healthy agent.
func TestSendHeartbeatWatchdog_CleanReturnResetsMissCounter(t *testing.T) {
	buf := watchdogTestHarness(t, 30*time.Millisecond)

	var exitCalls int32
	h := &Heartbeat{
		watchdogExitFn: func(int) { atomic.AddInt32(&exitCalls, 1) },
	}

	// Tick 1: slow (one miss).
	{
		release := make(chan struct{})
		started := make(chan struct{})
		var once sync.Once
		h.sendHeartbeatFn = func() {
			once.Do(func() { close(started) })
			<-release
		}
		done := make(chan struct{})
		go func() {
			h.sendHeartbeatWithWatchdog()
			close(done)
		}()
		<-started
		time.Sleep(90 * time.Millisecond)
		close(release)
		<-done
	}

	// Tick 2: fast (clean return → counter reset to 0).
	h.sendHeartbeatFn = func() {}
	h.sendHeartbeatWithWatchdog()

	// Tick 3: slow again. Should be miss #1, not #2, because the clean
	// return in tick 2 reset the counter. No escalation expected.
	{
		release := make(chan struct{})
		started := make(chan struct{})
		var once sync.Once
		h.sendHeartbeatFn = func() {
			once.Do(func() { close(started) })
			<-release
		}
		done := make(chan struct{})
		go func() {
			h.sendHeartbeatWithWatchdog()
			close(done)
		}()
		<-started
		time.Sleep(90 * time.Millisecond)
		close(release)
		<-done
	}

	if got := atomic.LoadInt32(&exitCalls); got != 0 {
		t.Fatalf("exitFn called %d times across slow→fast→slow; counter must reset on clean returns", got)
	}
	if strings.Contains(buf.String(), "consecutive miss threshold reached") {
		t.Fatalf("escalation fired despite a clean return in between:\n%s", buf.String())
	}
}
