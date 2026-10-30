"""Optional real-browser regression checks for the floating composer layout.

Run: python tests/composer-layout.browser.py
Requires Python Playwright, Chromium and the project's TypeScript compiler.
Uses the production stylesheet and compiled production clearance helpers; no
React or Tauri runtime is replaced or mocked in the release build.
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "src/styles.css").read_text(encoding="utf-8")
HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<section class="chat-pane" style="position:relative;height:var(--pane-height);width:100%;overflow:hidden">
  <section class="transcript" style="position:absolute;inset:0;overflow-y:auto">
    <div class="transcript-content" style="margin:0 auto"><div style="height:1450px">Earlier messages</div>
      <article id="last" style="height:48px">Last assistant message — must be readable</article>
    </div>
  </section>
  <footer class="composer-wrap">
    <div class="extension-status" style="height:120px">Extension status</div>
    <div class="extension-widgets above-editor"><div class="extension-widget" style="height:170px">Large widget</div></div>
    <div class="composer-queue"><div class="composer-queue-header"><span>Queued messages</span></div>
      <div class="composer-queue-items">''' + '<div class="composer-queue-item">Queued item</div>' * 8 + '''</div></div>
    <form class="composer"><div class="composer-attachments" style="height:85px">Attachment previews</div>
      <textarea rows="3">''' + ('Text\n' * 40) + '''</textarea>
      <div class="composer-actions"><div class="composer-left-actions">Add</div>
        <div class="composer-right-actions">Model selector • Send</div></div>
    </form>
    <div class="extension-widgets below-editor"><div class="extension-widget" style="height:180px">Bottom widget</div></div>
  </footer>
</section></body></html>'''


def production_helpers():
    with tempfile.TemporaryDirectory() as temp:
        subprocess.run(
            ["tsc", "--target", "ES2022", "--module", "ES2022", "--skipLibCheck",
             "--outDir", temp, "src/core/message-queue.ts"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        return (Path(temp) / "message-queue.js").read_text(encoding="utf-8")


def assert_geometry(page, pane_height, *, has_extras=True, width=1200):
    page.set_viewport_size({"width": width, "height": pane_height + 60})
    result = page.evaluate('''([height, extras]) => {
      const pane = document.querySelector('.chat-pane');
      pane.style.setProperty('--pane-height', height + 'px');
      if (!extras) {
        for (const selector of ['.extension-status', '.extension-widgets', '.composer-queue', '.composer-attachments']) {
          for (const element of document.querySelectorAll(selector)) element.remove();
        }
      }
      const textarea = document.querySelector('.composer textarea');
      const computed = getComputedStyle(textarea);
      textarea.style.height = 'auto';
      const limit = window.composerLayoutHelpers.textareaHeightLimit(
        pane.clientHeight, parseFloat(computed.lineHeight) || 24,
        parseFloat(computed.paddingTop) || 0, parseFloat(computed.paddingBottom) || 0,
      );
      textarea.style.height = Math.min(textarea.scrollHeight, limit) + 'px';
      const wrap = document.querySelector('.composer-wrap');
      const transcript = document.querySelector('.transcript');
      const clearance = window.composerLayoutHelpers.composerOverlayClearance(
        transcript.getBoundingClientRect().bottom, wrap.getBoundingClientRect().top,
      );
      pane.style.setProperty('--composer-overlay-clearance', clearance + 'px');
      transcript.scrollTop = transcript.scrollHeight;
      const last = document.getElementById('last');
      return {
        visibleChat: wrap.getBoundingClientRect().top - transcript.getBoundingClientRect().top,
        lastBottom: last.getBoundingClientRect().bottom,
        composerTop: wrap.getBoundingClientRect().top,
        textareaHeight: textarea.getBoundingClientRect().height,
        textareaMax: getComputedStyle(textarea).maxHeight,
        textareaOverflow: getComputedStyle(textarea).overflowY,
        textareaScrollable: textarea.scrollHeight > textarea.clientHeight,
        queueHeight: document.querySelector('.composer-queue')?.getBoundingClientRect().height,
        queueScrollable: (() => { const items = document.querySelector('.composer-queue-items'); return items && items.scrollHeight > items.clientHeight; })(),
        widgetsScrollable: [...document.querySelectorAll('.extension-widgets')].some(el => el.scrollHeight > el.clientHeight),
      };
    }''', [pane_height, has_extras])
    print(f"{width}×{pane_height}px, extras={has_extras}: {result}")
    assert result["visibleChat"] >= min(160, pane_height * .33) - 3, "Composer obscures the chat viewport"
    assert result["lastBottom"] <= result["composerTop"] - 8, "Last message cannot clear composer at full scroll"
    assert result["textareaMax"] == "none", "CSS overrides JS textarea height limit"
    assert result["textareaOverflow"] == "auto", "Flex-shrunk textarea cannot scroll internally"
    assert result["textareaHeight"] >= 72, "Composer textarea became unusably short"
    if has_extras:
        assert result["queueHeight"] >= 50, "Queued messages collapsed out of view"
        assert result["queueScrollable"] and result["widgetsScrollable"], "Supplementary panels lack internal scroll"


def main():
    source = production_helpers()
    browser_path = os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium") or shutil.which("chrome")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_path, headless=True, args=["--no-sandbox"])
        page = browser.new_page()
        for theme in ("dark", "light"):
            for has_extras in (False, True):
                page.set_content(HTML)
                page.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
                page.add_style_tag(content=CSS)
                page.evaluate('''async (code) => {
                  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
                  try { window.composerLayoutHelpers = await import(url); }
                  finally { URL.revokeObjectURL(url); }
                }''', source)
                # Resize the same mounted DOM (no reload) to catch stale geometry.
                for width, height in ((1200, 800), (1200, 520), (820, 360), (1200, 800)):
                    assert_geometry(page, height, has_extras=has_extras, width=width)
        browser.close()
    print("Chromium composer geometry: PASS")


if __name__ == "__main__":
    main()
