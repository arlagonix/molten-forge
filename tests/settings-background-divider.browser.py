"""Check that the Wallpaper overlay -> Light background divider is visible.

Run: python tests/settings-background-divider.browser.py
Uses the production CSS and the same class ordering as GeneralSettings.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

css = (Path(__file__).resolve().parents[1] / 'src/styles.css').read_text(encoding='utf-8')
html = '''<!doctype html><html data-theme="dark"><body>
<div class="settings-main"><div class="settings-page-content"><section class="settings-section">
<div class="settings-panel">
<label class="settings-switch-row">Show background image</label>
<div class="settings-control-row settings-wallpaper-overlay-row">Wallpaper overlay</div>
<div class="settings-background-row" id="light-background">Light background</div>
<div class="settings-background-row" id="dark-background">Dark background</div>
</div></section></div></div></body></html>'''
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1140, 'height': 600})
    page.set_content(html)
    page.add_style_tag(content=css)
    for theme in ('dark', 'light'):
        page.evaluate('(t) => document.documentElement.dataset.theme=t', theme)
        rows = page.evaluate('''() => ['light-background','dark-background'].map(id => {
          const cs = getComputedStyle(document.getElementById(id));
          return { width: cs.borderTopWidth, style: cs.borderTopStyle, color: cs.borderTopColor };
        })''')
        assert all(r['width'] == '1px' and r['style'] == 'solid' for r in rows), (theme, rows)
        assert rows[0]['color'] == rows[1]['color'], (theme, rows)
        print(theme, rows)
    browser.close()
