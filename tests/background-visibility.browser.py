"""Regression: the selectable app wallpaper must remain visible behind pane tints.

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
.chat-pane{height:100%;}
.transcript{height:100%;}
</style></head><body><main class="app-shell background-enabled">
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

OPAQUE_PANES = ('.chat-header', '.session-sidebar', '.settings-sidebar')

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 800, 'height': 500}, device_scale_factor=1)
    page.set_content(fixture)
    page.add_style_tag(content=css)
    page.evaluate('(background) => document.querySelector(".app-shell").style.setProperty("--app-background-image", background)', wallpaper)

    for theme in ('dark', 'light'):
        page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; }', theme)
        pane_colors = page.evaluate('''() => Object.fromEntries(
          ['.chat-pane', '.chat-header', '.session-sidebar', '.settings-main', '.settings-sidebar',
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
                # The sidebars must read as one solid color with the chat header,
                # so they must not let the wallpaper through at all.
                assert opacity == 1, f'{theme} {selector} must be opaque: {color}'
            else:
                assert 0 < opacity < 1, f'{theme} {selector} must be translucent: {color}'
        # Both sidebars must be exactly the chat header surface.
        for selector in OPAQUE_PANES:
            assert pane_colors[selector]['background'] == pane_colors['.chat-header']['background'], (
                f"{theme} {selector} {pane_colors[selector]['background']} must equal "
                f"header {pane_colors['.chat-header']['background']}"
            )
        # Chat wallpaper tint must visually match the Settings main-pane tint.
        assert pane_colors['.chat-pane']['background'] == pane_colors['.settings-main']['background'], (
            f"{theme} chat tint {pane_colors['.chat-pane']['background']} must equal "
            f"Settings tint {pane_colors['.settings-main']['background']}"
        )
        # Compare actual pixels with the very same panel and theme when wallpaper is toggled off.
        page.evaluate('document.querySelector(".app-shell").classList.remove("background-disabled")')
        visible = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('document.querySelector(".app-shell").classList.add("background-disabled")')
        hidden = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('document.querySelector(".app-shell").classList.remove("background-disabled")')
        # Both samples sit inside the translucent chat column (x > 180).
        for pos in ((300, 240), (420, 240)):
            delta = max(abs(a-b) for a,b in zip(visible.getpixel(pos),hidden.getpixel(pos)))
            assert delta >= 6, f'{theme} wallpaper invisible under chat pane at {pos}: difference {delta}'
        # x=60/170 sit inside the solid session sidebar; no wallpaper may show.
        for pos in ((60, 240), (170, 300)):
            delta = max(abs(a-b) for a,b in zip(visible.getpixel(pos), hidden.getpixel(pos)))
            assert delta == 0, f'{theme} wallpaper leaks through the solid sidebar at {pos}: {delta}'
        page.evaluate('document.getElementById("settings").hidden = false')
        settings_with_image = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('document.querySelector(".app-shell").classList.add("background-disabled")')
        settings_without_image = Image.open(BytesIO(page.screenshot())).convert('RGB')
        page.evaluate('''() => { document.getElementById('settings').hidden = true;
            document.querySelector('.app-shell').classList.remove('background-disabled'); }''')
        for pos in ((450, 240), (650, 240), (300, 240)):
            delta = max(abs(a-b) for a,b in zip(settings_with_image.getpixel(pos), settings_without_image.getpixel(pos)))
            assert delta >= 2, f'{theme} wallpaper invisible under Settings at {pos}: difference {delta}'
        # The Settings sidebar is solid too.
        for pos in ((60, 240),):
            delta = max(abs(a-b) for a,b in zip(settings_with_image.getpixel(pos), settings_without_image.getpixel(pos)))
            assert delta == 0, f'{theme} wallpaper leaks through the solid Settings sidebar at {pos}: {delta}'
        print(f'{theme}: wallpaper visible in chat/Settings/Skills, hidden under the solid sidebars; toggle works; no blur')
    browser.close()
print('PASS: tinted panes preserve wallpaper across themes')
