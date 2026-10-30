"""Behavioral animation regression using the production Molten Forge CSS.

Run: python tests/generation-animations.browser.py (Playwright + Chromium).
Only the spinner should animate during generation; no idle wordmark animation.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STYLES = (ROOT / 'src/styles.css').read_text(encoding='utf-8')

DOCUMENT = '''<!doctype html><html data-theme="dark"><head></head><body>
<strong class="molten-forge-title">Molten Forge</strong>
<div class="generation-status">
  <span class="generating-radix-spinner" role="status" aria-label="Loading">
    ''' + ''.join(f'<span class="generating-radix-spinner-leaf" style="--spinner-index:{i};opacity:{.28+i*.09}"></span>' for i in range(8)) + '''
  </span>
  <span class="generating-gradient-text">Composing</span>
</div></body></html>'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page()
    page.set_content(DOCUMENT)
    page.add_style_tag(content=STYLES)
    for theme in ('dark', 'light'):
        page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; }', theme)
        results = page.evaluate('''() => {
           const names = selector => [...document.querySelectorAll(selector)].flatMap(el =>
               el.getAnimations().map(a => a.animationName));
           const prop = (sel, key) => getComputedStyle(document.querySelector(sel)).getPropertyValue(key).trim();
           return {
              wordmark: names('.molten-forge-title'),
              titleBackground: prop('.molten-forge-title','background-image'),
              text: names('.generating-gradient-text'),
              textBackground: prop('.generating-gradient-text','background-image'),
              leaves: names('.generating-radix-spinner-leaf'),
              leafBackground: prop('.generating-radix-spinner-leaf','background-image'),
              spinner: names('.generating-radix-spinner'),
           };
        }''')
        print(theme, results)
        assert results['wordmark'] == [], 'Idle title still animates'
        assert results['text'] == [], 'Composing text still repaints its background'
        assert results['leaves'] == [], 'Spinner leaves still repaint gradients'
        assert results['spinner'] == ['molten-radix-spinner-rotate'], 'Spinner must retain transform rotation'
        assert results['textBackground'] != 'none', 'Lost the Composing gradient'
        assert results['leafBackground'] != 'none', 'Lost the spinner leaf gradient'
        if theme == 'dark': assert results['titleBackground'] != 'none', 'Lost dark wordmark gradient'
        if theme == 'light': assert results['titleBackground'] == 'none', 'Light wordmark should be neutral'
    browser.close()
print('PASS: only spinner rotation animates while retaining static gradients')
