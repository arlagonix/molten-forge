"""Regression: wallpaper is a single continuous overlay on the active workspace.

Run: python tests/background-visibility.browser.py (Playwright + Chromium).
The CSS from production is loaded without React so both theme and image-toggle
contracts can be checked even without the full Tauri/Pi runtime.
"""
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
import re

from PIL import Image
from playwright.sync_api import sync_playwright

css = (Path(__file__).resolve().parents[1] / 'src/styles.css').read_text(encoding='utf-8')
image = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100" height="200" fill="#ee2a2a"/><rect x="100" width="100" height="200" fill="#215bfe"/></svg>'
wallpaper = f'url("data:image/svg+xml,{quote(image)}")'
fixture = '''<!doctype html><html data-theme="dark"><head><style>
html,body{width:100%;height:100%;margin:0;}
[hidden]{display:none!important;}
.app-shell{height:100%;width:100%;--session-sidebar-width:180px;}
.workspace{width:100%;height:100%;display:grid;grid-template-columns:180px 1fr;}
.session-sidebar{height:100%;}
.transcript{height:100%;}
</style></head><body><main class="app-shell is-connected background-enabled">
<div class="workspace"><aside class="session-sidebar"></aside>
<section class="chat-pane"><header class="chat-header"></header><div class="transcript"></div></section>
</div>
<div id="settings" class="settings-workspace" hidden>
  <aside class="settings-sidebar"></aside>
  <div class="settings-main"><header class="settings-main-titlebar"></header>
    <div class="pi-skills-workspace"><aside class="pi-skills-list-pane"></aside>
      <div class="pi-skill-detail-scroll"></div></div>
  </div>
</div></main>
</body></html>'''

OPAQUE_PANES = ('.chat-pane', '.session-sidebar', '.settings-main', '.settings-sidebar')

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 800, 'height': 500}, device_scale_factor=1)
    page.set_content(fixture)
    page.add_style_tag(content=css)
    page.evaluate('''(background) => {
      const shell = document.querySelector('.app-shell');
      shell.style.setProperty('--app-background-image', background);
      shell.style.setProperty('--mf-wallpaper-overlay-opacity', '.12');
    }''', wallpaper)

    for theme in ('dark', 'light'):
        page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; }', theme)
        pane_colors = page.evaluate('''() => Object.fromEntries(
          ['.chat-pane', '.chat-header', '.session-sidebar', '.settings-main', '.settings-main-titlebar', '.settings-sidebar',
           '.pi-skills-list-pane', '.pi-skill-detail-scroll'].map(selector => {
           const el = document.querySelector(selector) || document.createElement('div');
           if (!el.isConnected) { el.className=selector.slice(1); document.body.append(el); }
           const cs = getComputedStyle(el);
           return [selector, { background: cs.backgroundColor, filter: cs.backdropFilter }];
          }))''')
        def opacity_of(color):
            if color.startswith('rgba('):
                return float(color.split(',')[-1].strip(' )'))
            if '/' in color:
                return float(re.search(r'/\s*(\d*\.?\d+)\s*\)$', color).group(1))
            return 1

        for selector, values in pane_colors.items():
            color = values['background']
            opacity = opacity_of(color)
            assert values['filter'] == 'none', f'{theme} {selector} expensive blur returned: {values}'
            if selector in OPAQUE_PANES:
                assert opacity == 1, f'{theme} {selector} must be opaque: {color}'
            elif selector in ('.settings-main-titlebar', '.chat-header'):
                # Phase 4.3: both titlebars are lifted into the solid top strip.
                assert opacity == 1, f'{theme} detached titlebar must be opaque: {color}'
            else:
                assert 0 < opacity < 1, f'{theme} {selector} must be translucent: {color}'
        # Compare actual pixels with the very same panel and theme when wallpaper is toggled off.
        page.evaluate('document.querySelector(".app-shell").classList.remove("background-disabled")')
        visible = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('document.querySelector(".app-shell").classList.add("background-disabled")')
        hidden = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('document.querySelector(".app-shell").classList.remove("background-disabled")')
        # At 12%, both the pane and sidebar receive the same single wallpaper
        # overlay; neither has its own separately tinted image layer.
        for pos in ((300, 240), (420, 240), (60, 240), (170, 300)):
            delta = max(abs(a-b) for a,b in zip(visible.getpixel(pos),hidden.getpixel(pos)))
            assert delta >= 6, f'{theme} wallpaper missing from workspace at {pos}: difference {delta}'
        page.evaluate('document.getElementById("settings").hidden = false')
        settings_with_image = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('document.querySelector(".app-shell").classList.add("background-disabled")')
        settings_without_image = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('''() => { document.getElementById('settings').hidden = true;
            document.querySelector('.app-shell').classList.remove('background-disabled'); }''')
        for pos in ((450, 240), (650, 240), (300, 240)):
            delta = max(abs(a-b) for a,b in zip(settings_with_image.getpixel(pos), settings_without_image.getpixel(pos)))
            # A small difference demonstrates wallpaper remains visible even
            # beneath the opaque foreground controls.
            assert delta >= 1, f'{theme} wallpaper invisible under Settings at {pos}: difference {delta}'
        # Settings also receives the wallpaper (including its left sidebar),
        # and the master background toggle hides the overlay everywhere.
        for pos in ((60, 240),):
            delta = max(abs(a-b) for a,b in zip(settings_with_image.getpixel(pos), settings_without_image.getpixel(pos)))
            assert delta >= 6, f'{theme} wallpaper missing from Settings sidebar at {pos}: difference {delta}'
        # Gutter and frame are part of the shared wallpaper overlay; there is
        # no separate CSS background image painted under either pane.
        for pos in ((798, 270), (480, 497)):
            delta = max(abs(a-b) for a,b in zip(visible.getpixel(pos), hidden.getpixel(pos)))
            assert delta >= 3, f'{theme} wallpaper missing from window overlay at {pos}: {delta}'
        # OpenCode-style wallpaper overlay also lightly tints the detached header.
        pos = (600, 15)
        delta = max(abs(a-b) for a,b in zip(visible.getpixel(pos),hidden.getpixel(pos)))
        assert delta >= 1, f'{theme} detached titlebar did not receive overlay: {delta}'
        print(f'{theme}: one wallpaper overlay over chat/Settings and sidebar; wallpaper-composited composer/titlebar; toggle works')
    browser.close()
print('PASS: single wallpaper layer respects appearance toggle in both themes')
