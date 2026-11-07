// nah landing page — one orchestrated moment: the terminal types a URL,
// then the result card appears. Everything else is static.

const typed = document.getElementById("typed");
const caret = document.getElementById("caret");
const result = document.getElementById("term-result");
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
    }
  };
  tick();
}

if (reduced) {
  typed.textContent = URL_TEXT;
  caret.remove();
  result.classList.add("show");
} else {
  setTimeout(typeUrl, 600);
}

copyBtn.addEventListener("click", async () => {
  const cmd = document.getElementById("install-cmd").textContent;
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
