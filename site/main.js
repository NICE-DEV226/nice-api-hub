// nah landing page — one orchestrated load sequence:
// type the URL → result card → simulated `d` download → saved.
// Everything else is static.

const typed = document.getElementById("typed");
const caret = document.getElementById("caret");
const result = document.getElementById("term-result");
const dlBox = document.getElementById("term-dl");
const dlFill = document.getElementById("dl-fill");
const dlPct = document.getElementById("dl-pct");
const dlSpeed = document.getElementById("dl-speed");
const saved = document.getElementById("term-saved");
const copyBtn = document.getElementById("copy-btn");

const URL_TEXT = "https://www.youtube.com/watch?v=abc";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function typeUrl() {
  let i = 0;
  const tick = () => {
    typed.textContent = URL_TEXT.slice(0, ++i);
    if (i < URL_TEXT.length) {
      setTimeout(tick, 34 + Math.random() * 40);
    } else {
      caret.remove();
      setTimeout(() => result.classList.add("show"), 350);
      setTimeout(startDownload, 1900);
    }
  };
  tick();
}

function startDownload() {
  dlBox.classList.add("show");
  const total = 233.7; // MB, matches the "Best quality" line
  const duration = 2600;
  const t0 = performance.now();
  const frame = (now) => {
    const p = Math.min((now - t0) / duration, 1);
    // ease-out so it decelerates like a real transfer finishing
    const eased = 1 - Math.pow(1 - p, 2);
    const mb = total * eased;
    dlFill.style.width = `${eased * 100}%`;
    dlPct.textContent = `${Math.round(eased * 100)}%`;
    dlSpeed.textContent = p < 1 ? `${(mb / Math.max((now - t0) / 1000, 0.3)).toFixed(1)} MB/s` : "done";
    if (p < 1) requestAnimationFrame(frame);
    else {
      dlSpeed.textContent = "5.7 MB/s avg";
      setTimeout(() => {
        dlBox.classList.remove("show");
        saved.classList.add("show");
      }, 500);
    }
  };
  requestAnimationFrame(frame);
}

if (reduced) {
  typed.textContent = URL_TEXT;
  caret.remove();
  result.classList.add("show");
  saved.classList.add("show");
  saved.textContent = "✓ saved to ~/Downloads/Big Buck Bunny.mp4";
} else {
  setTimeout(typeUrl, 600);
}

const COMMANDS = {
  unix: "curl -fsSL https://github.com/NICE-DEV226/nice-api-hub/releases/latest/download/install.sh | sh",
  win: "irm https://github.com/NICE-DEV226/nice-api-hub/releases/latest/download/install.ps1 | iex",
};
const installCmd = document.getElementById("install-cmd");
const installPrompt = document.getElementById("install-prompt");

for (const tab of document.querySelectorAll(".os-tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".os-tab").forEach((t) => t.classList.remove("on"));
    tab.classList.add("on");
    const os = tab.dataset.os;
    installCmd.textContent = COMMANDS[os];
    installPrompt.textContent = os === "win" ? "PS>" : "$";
  });
}

copyBtn.addEventListener("click", async () => {
  const cmd = installCmd.textContent;
  try {
    await navigator.clipboard.writeText(cmd);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = cmd;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  copyBtn.textContent = "copied";
  copyBtn.classList.add("done");
  setTimeout(() => {
    copyBtn.textContent = "copy";
    copyBtn.classList.remove("done");
  }, 1600);
});
