#!/usr/bin/env python3
"""Render a real `nah` TUI session to PNG via a PTY + pyte.

Usage (needs `pip install pyte pillow` and a JetBrainsMono Nerd Font):
    go build -o /tmp/nah ../..           # from cli/
    python3 stub.py 8791 &               # fake gateway
    NAH_BIN=/tmp/nah python3 shot.py all # writes nah-*.png next to this file
"""
import os, pty, sys, time, fcntl, termios, struct, select, signal
import pyte
from PIL import Image, ImageDraw, ImageFont

NAH = os.environ.get("NAH_BIN", "/tmp/nah")
STUB = os.environ.get("NAH_STUB", "http://127.0.0.1:8791")
SHOTS = os.environ.get("NAH_SHOTS", os.path.dirname(os.path.abspath(__file__)))
FONT_PATH = "/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Bold.ttf"

COLS, ROWS = 140, 42
CELL_W, CELL_H = 9, 19   # tuned below from font metrics if needed

# xterm-ish palette for ANSI names/numbers; default fg/bg match nah dark theme.
ANSI = {
    "black": "#484f58", "red": "#ff7b72", "green": "#3fb950", "yellow": "#d29922",
    "blue": "#58a6ff", "magenta": "#bc8cff", "cyan": "#39c5cf", "white": "#b1bac4",
    "brightblack": "#6e7681", "brightred": "#ffa198", "brightgreen": "#56d364",
    "brightyellow": "#e3b341", "brightblue": "#79c0ff", "brightmagenta": "#d2a8ff",
    "brightcyan": "#56d4dd", "brightwhite": "#f0f6fc",
}
DEFAULT_BG = "#0d1117"
DEFAULT_FG = "#e6edf3"

def resolve(color, default):
    if color in (None, "default"):
        return default
    if isinstance(color, str) and color.startswith("#"):
        return color
    return ANSI.get(str(color).lower(), default)


def spawn(env_extra=None, cols=COLS, rows=ROWS):
    pid, fd = pty.fork()
    if pid == 0:
        env = dict(os.environ)
        env.update({
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "HOME": os.environ.get("NAH_HOME", "/tmp/nah-home"),
            "NAH_URL": STUB,
            "NAH_NO_KEYRING": "1",
            "NAH_DOWNLOAD_DIR": os.environ.get("NAH_DL", "/tmp/nah-dl"),
            "NAH_CONFIG": os.path.join(os.environ.get("NAH_HOME", "/tmp/nah-home"), ".config/nah/config.json"),
        })
        env.update(env_extra or {})
        os.execvpe(NAH, [NAH], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    return pid, fd


def feed(fd, pid, data, wait=0.0):
    os.write(fd, data)
    if wait:
        time.sleep(wait)


def drain(fd, screen, stream, timeout=0.05):
    while True:
        r, _, _ = select.select([fd], [], [], timeout)
        if not r:
            return
        try:
            data = os.read(fd, 65536)
        except OSError:
            return
        if not data:
            return
        stream.feed(data)


def shot(screen, path, cols=COLS, rows=ROWS):
    font = ImageFont.truetype(FONT_PATH, 15)
    font_b = ImageFont.truetype(FONT_BOLD, 15)
    # measure a cell
    bbox = font.getbbox("M")
    adv = font.getlength("M")
    cw = int(round(adv)) or 9
    ch = int(round(font.size * 1.27)) or 19
    img = Image.new("RGB", (cols * cw + 16, rows * ch + 16), DEFAULT_BG)
    d = ImageDraw.Draw(img)
    pad = 8
    for y in range(rows):
        line = screen.buffer[y]
        for x, ch_ in line.items():
            if ch_.data == " ":
                continue
            fg = resolve(ch_.fg, DEFAULT_FG)
            bg = resolve(ch_.bg, DEFAULT_BG)
            if bg != DEFAULT_BG:
                d.rectangle([pad + x*cw, pad + y*ch, pad + (x+1)*cw - 1, pad + (y+1)*ch - 1], fill=bg)
            f = font_b if ch_.bold else font
            d.text((pad + x*cw, pad + y*ch - 2), ch_.data, font=f, fill=fg)
    img.save(path)
    print("wrote", path, img.size)


def wait_idle(fd, screen, stream, quiet=0.4, maxwait=8.0):
    """Feed until no output for `quiet` seconds."""
    end = time.time() + maxwait
    last = time.time()
    while time.time() < end:
        drain(fd, screen, stream, timeout=0.1)
        if time.time() - last > quiet:
            return
        last = time.time()
    drain(fd, screen, stream, timeout=0.2)


def run(name, keys_seq, env_extra=None, cols=COLS, rows=ROWS, settle=1.0):
    screen = pyte.Screen(cols, rows)
    stream = pyte.ByteStream(screen)
    pid, fd = spawn(env_extra, cols, rows)
    try:
        os.set_blocking(fd, False)
        wait_idle(fd, screen, stream)
        for keys, pause in keys_seq:
            feed(fd, pid, keys)
            wait_idle(fd, screen, stream, quiet=0.35, maxwait=10.0)
            time.sleep(pause)
        time.sleep(settle)
        drain(fd, screen, stream, timeout=0.3)
        shot(screen, f"{SHOTS}/{name}.png", cols, rows)
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.close(fd)


if __name__ == "__main__":
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(os.environ.get("NAH_HOME", "/tmp/nah-home"), exist_ok=True)
    os.makedirs(os.environ.get("NAH_DL", "/tmp/nah-dl"), exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else "all"

    if which in ("all", "welcome"):
        # no API key: the setup/welcome screen
        run("nah-welcome", [], env_extra={"NAH_API_KEY": "", "NAH_URL": STUB}, settle=1.5)

    if which in ("all", "home"):
        run("nah-home", [], env_extra={"NAH_API_KEY": "nah_live_test"}, settle=1.0)

    if which in ("all", "overview"):
        run("nah-overview",
            [(b"https://www.youtube.com/watch?v=aqz-KE-bpKQ", 0.3), (b"\r", 0)],
            env_extra={"NAH_API_KEY": "nah_live_test"}, settle=3.0)

    if which in ("all", "picker"):
        run("nah-picker",
            [(b"https://www.youtube.com/watch?v=aqz-KE-bpKQ", 0.3), (b"\r", 0),
             (b"d", 0)],
            env_extra={"NAH_API_KEY": "nah_live_test"}, settle=2.0)
