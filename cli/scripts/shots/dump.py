#!/usr/bin/env python3
"""Dump the real `nah` TUI text buffer (no PNG) for inspection.

    go build -o /tmp/nah-dev .            # from cli/
    python3 stub.py 8791 &                # fake gateway
    NAH_BIN=/tmp/nah-dev python3 dump.py dashboard
"""
import os, sys, time, signal
import pyte
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shot import spawn, drain, wait_idle

COLS, ROWS = 120, 36

def screen_text(screen):
    return "\n".join(screen.display)

def click_tab(fd, screen, stream, name):
    """SGR click on the tab label found in the header row."""
    for y in range(3):
        line = screen.display[y]
        x = line.find(name)
        if x >= 0:
            cx = x + len(name) // 2
            os.write(fd, f"\x1b[<0;{cx+1};{y+1}M".encode())
            time.sleep(0.05)
            os.write(fd, f"\x1b[<0;{cx+1};{y+1}m".encode())
            return True
    return False

def run(which):
    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.ByteStream(screen)
    pid, fd = spawn({"NAH_API_KEY": "nah_live_test"}, COLS, ROWS)
    try:
        os.set_blocking(fd, False)
        wait_idle(fd, screen, stream)
        for tab in which.split(","):
            if not click_tab(fd, screen, stream, tab):
                print(f"!! tab {tab!r} not found")
                continue
            wait_idle(fd, screen, stream, quiet=0.5, maxwait=10)
            time.sleep(0.5)
            drain(fd, screen, stream, timeout=0.3)
            print(f"===== {tab} =====")
            print(screen_text(screen))
            print()
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.close(fd)

if __name__ == "__main__":
    os.makedirs(os.environ.get("NAH_HOME", "/tmp/nah-home"), exist_ok=True)
    run(sys.argv[1] if len(sys.argv) > 1 else "Dashboard")
