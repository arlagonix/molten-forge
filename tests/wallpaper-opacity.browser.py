"""Check that wallpaper opacity is continuous over the header and composer.

Run: python tests/wallpaper-opacity.browser.py (requires Playwright/Chromium/Pillow).
The fixture uses production CSS and solid white wallpaper to make tiny
changes around 0% measurable without depending on a particular wallpaper.
"""
from io import BytesIO
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

CSS = (Path(__file__).resolve().parents[1] / 'src/styles.css').read_text(encoding='utf-8')
HTML = '''<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><main class="app-shell is-connected background-enabled" style="--session-sidebar-width:200px; --app-background-image:linear-gradient(white,white); --mf-wallpaper-overlay-opacity:0">
  <div class="workspace sidebar-visible">
    <aside class="session-sidebar"><div class="sidebar-titlebar">Molten Forge</div></aside>
    <section class="chat-pane"><header class="chat-header">A session</header>
      <div class="transcript"><div class="transcript-content"></div></div>
      <div class="composer-wrap"><div class="composer" style="width:450px;height:88px"></div></div>
    </section>
  </div>
  <div class="settings-workspace" style="display:none;--settings-sidebar-width:200px">
    <aside class="settings-sidebar"></aside><section class="settings-main"><header class="settings-main-titlebar">General</header><div class="settings-page-scroll"></div></section>
  </div>
</main>
<style>.app-shell{width:100vw;height:100vh}.composer{min-height:88px}</style>
</body></html>'''

def channel_difference(a, b):
    return max(abs(x - y) for x, y in zip(a, b))

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':900, 'height':560}, device_scale_factor=1)
    page.set_content(HTML)
    page.add_style_tag(content=CSS)

    def sample(percent, enabled=True, settings=False):
        page.evaluate('''({percent,enabled,settings}) => {
          const shell = document.querySelector('.app-shell');
          shell.classList.toggle('background-enabled', enabled);
          shell.classList.toggle('background-disabled', !enabled);
          // 0% must not select a separate wallpaper rendering mode.
          shell.style.setProperty('--mf-wallpaper-overlay-opacity', String(percent / 100));
          document.querySelector('.settings-workspace').style.display = settings ? 'grid' : 'none';
        }''', {'percent':percent,'enabled':enabled,'settings':settings})
        img = Image.open(BytesIO(page.screenshot())).convert('RGB')
        return {
            'chat': img.getpixel((540,200)),
            'sidebar': img.getpixel((70,260)),
            'composer': img.getpixel((450,490)),
            'header': img.getpixel((540,12)),
            'settings': img.getpixel((540,200)),
        }

    for theme in ('dark','light'):
        page.evaluate('(theme) => document.documentElement.dataset.theme=theme', theme)
        hidden = sample(0, enabled=False)
        zero = sample(0)
        one = sample(1)
        ten = sample(10)
        twentyfive = sample(25)
        print(theme, '0/1/10/25', zero, one, ten, twentyfive)
        if theme == 'dark':
            assert zero['composer'] == (40, 41, 35), ('dark composer should use raised layer-01', zero)
        for surface in ('chat','sidebar','header','composer'):
            assert zero[surface] == hidden[surface], (theme, surface, '0% should hide wallpaper', zero, hidden)
            assert 0 <= channel_difference(zero[surface], one[surface]) <= 4, (theme, surface, '1% must be a small step',zero,one)
            if theme == 'dark':
                assert channel_difference(zero[surface], one[surface]) > 0, (theme,surface,'1% should be visible over dark colors')
            assert channel_difference(zero[surface], twentyfive[surface]) > channel_difference(zero[surface], ten[surface]) >= channel_difference(zero[surface], one[surface]), (theme,surface)
        settings_zero = sample(0, settings=True)
        settings_one = sample(1, settings=True)
        assert 0 <= channel_difference(settings_zero['settings'],settings_one['settings']) <= 4, (theme,settings_zero,settings_one)
    browser.close()
print('PASS: 0–25% wallpaper continuity over chat, sidebar, header and composer; Settings' )
