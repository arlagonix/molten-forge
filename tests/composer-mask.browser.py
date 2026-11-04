"""Pixel regression: transcript text is masked beneath the floating composer.

Run: python tests/composer-mask.browser.py
Requires Playwright + Chromium + Pillow. Uses the shipping stylesheet, not
hand-written copies of the composer/mask CSS.
"""
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

CSS = (Path(__file__).resolve().parents[1] / "src/styles.css").read_text(encoding="utf-8")
HTML = """<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main class="app-shell is-connected background-enabled" style="--mf-wallpaper-overlay-opacity:.10">
 <div class="workspace sidebar-hidden"><section class="chat-pane" style="--chat-width:760px">
  <div class="transcript"><div class="transcript-content">
    <div style="height:500px">Previously read conversation content</div>
    <div id="hidden" style="margin-left:0;color:white;font:700 20px monospace;white-space:nowrap">THIS TRANSCRIPT MUST FADE OUT UNDER THE COMPOSER</div>
  </div></div>
  <footer class="composer-wrap"><form class="composer" style="height:105px"><textarea>Message Pi</textarea><div class="composer-actions">Send</div></form></footer>
 </section></div>
</main></body></html>"""


def crop_image(page, rect):
    img = Image.open(BytesIO(page.screenshot())).convert("RGB")
    return img.crop((int(rect["left"]), int(rect["top"]), int(rect["right"]), int(rect["bottom"])))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1200, "height": 640}, device_scale_factor=1)
    page.set_content(HTML)
    page.add_style_tag(content=CSS)
    info = page.evaluate("""() => {
      const pane = document.querySelector('.chat-pane');
      const transcript = document.querySelector('.transcript');
      const composer = document.querySelector('.composer-wrap');
      const bottom = transcript.getBoundingClientRect().bottom;
      const top = composer.getBoundingClientRect().top;
      const inset = Math.max(0, Math.ceil(bottom - top));
      pane.style.setProperty('--composer-fade-inset', inset + 'px');
      return {inset, mask: getComputedStyle(transcript).maskImage,
        text: document.querySelector('#hidden').getBoundingClientRect().toJSON(),
        composer: composer.getBoundingClientRect().toJSON(),
        transcript: transcript.getBoundingClientRect().toJSON()};
    }""")
    assert info["inset"] > 80, info
    assert "--composer-fade-inset" not in info["mask"], info
    # The line is under the composer; compare pixels on the left, outside the
    # composer card itself, where the text would otherwise be plainly visible.
    text_rect = info["text"]
    left = max(info["transcript"]["left"] + 8, text_rect["left"])
    rect = {"left": left, "top": text_rect["top"],
            "right": min(left + 480, info["transcript"]["right"] - 20),
            "bottom": text_rect["bottom"]}
    assert info["composer"]["top"] < rect["top"] < info["transcript"]["bottom"], info
    masked = crop_image(page, rect)
    page.evaluate("""() => { const t=document.querySelector('.transcript');
       t.style.webkitMaskImage='none'; t.style.maskImage='none'; }""")
    unmasked = crop_image(page, rect)
    bbox = ImageChops.difference(masked, unmasked).getbbox()
    assert bbox is not None, "Mask had no visible effect on the obscured transcript pixels"
    differing = sum(1 for px in ImageChops.difference(masked, unmasked).get_flattened_data() if max(px) > 15)
    assert differing > 80, f"Transcript remained visible beneath composer ({differing} differing pixels)"
    print(f"Composer mask pixel regression: PASS ({differing} pixels hidden)")
    browser.close()
