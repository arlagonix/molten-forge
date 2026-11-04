"""Browser regression for the OpenCode-inspired Monokai workspace shell.

Run with: python tests/monokai-shell.browser.py
Requires Playwright and Chromium; uses the real production stylesheet.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

CSS = (Path(__file__).resolve().parents[1] / 'src/styles.css').read_text(encoding='utf-8')
HTML = '''<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<main class="app-shell is-connected background-disabled" style="--session-sidebar-width:232px">
  <div class="window-controls"></div>
  <div class="workspace sidebar-visible">
    <aside class="session-sidebar">
      <div class="sidebar-titlebar"><div class="sidebar-brand"><strong>Molten Forge</strong></div></div>
      <div class="sidebar-section-heading">Projects</div>
      <nav class="session-list project-session-list">
        <div class="project-session-heading current"><span class="project-session-name">molten-forge</span></div>
        <button class="session-row project-session-row active"><span class="session-title">Current session</span></button>
      </nav>
      <footer class="sidebar-footer">Connected</footer>
      <div class="sidebar-width-resizer"></div>
    </aside>
    <section class="chat-pane"><header class="chat-header"><div class="chat-heading"><strong>Current session</strong></div></header>
      <div class="transcript"><div class="transcript-content">Chat transcript</div></div>
      <div class="composer-wrap"><div class="composer">Composer</div></div>
    </section>
  </div>
  <div class="settings-workspace" hidden style="--settings-sidebar-width:232px">
    <aside class="settings-sidebar"><div class="settings-sidebar-titlebar">Molten Forge</div>
       <nav class="settings-sidebar-nav"><button class="settings-sidebar-row active">General</button></nav>
       <button class="settings-back-to-chat">Back to chat</button>
    </aside>
    <section class="settings-main"><header class="settings-main-titlebar"><strong>General</strong></header>
       <div class="settings-page-scroll">Settings content</div>
    </section>
  </div>
</main></body></html>'''

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1200, 'height': 780})
    page.set_content(HTML)
    page.add_style_tag(content=CSS)
    for theme in ('dark', 'light'):
        page.evaluate('(value) => document.documentElement.dataset.theme = value', theme)
        for collapsed in (False, True):
            page.evaluate('''(collapsed) => {
              const workspace = document.querySelector('.workspace');
              workspace.classList.toggle('sidebar-hidden', collapsed);
              workspace.classList.toggle('sidebar-visible', !collapsed);
              document.querySelector('.session-sidebar').style.display = collapsed ? 'none' : '';
            }''', collapsed)
            metrics = page.evaluate('''() => {
              const pane = document.querySelector('.chat-pane');
              const side = document.querySelector('.session-sidebar');
              const header = document.querySelector('.chat-header');
              const footer = document.querySelector('.sidebar-footer');
              const row = document.querySelector('.session-row.active');
              const box = pane.getBoundingClientRect();
              const style = getComputedStyle(pane);
              return {
                pane: {top: box.top, left: box.left, right: box.right, bottom: box.bottom},
                viewport: {width: innerWidth, height: innerHeight},
                radius: style.borderTopLeftRadius, border: style.borderTopWidth,
                bg: style.backgroundColor, overflow: style.overflow,
                sideBorder: getComputedStyle(side).borderRightWidth,
                sideBg: getComputedStyle(side).backgroundColor,
                headerBorder: getComputedStyle(header).borderBottomWidth,
                headerRect: {top:header.getBoundingClientRect().top, bottom:header.getBoundingClientRect().bottom, left:header.getBoundingClientRect().left, right:header.getBoundingClientRect().right},
                transcriptTop: document.querySelector('.transcript').getBoundingClientRect().top,
                footerBorder: getComputedStyle(footer).borderTopWidth,
                selectedBorder: getComputedStyle(row).borderTopColor,
                chrome: getComputedStyle(header).backgroundColor,
                frame: getComputedStyle(document.querySelector('.app-shell'), '::before').backgroundColor,
                frameHeight: getComputedStyle(document.querySelector('.app-shell'), '::before').height,
                transcriptScrollable: getComputedStyle(document.querySelector('.transcript')).overflowY,
              }
            }''')
            print(theme, 'collapsed' if collapsed else 'expanded', metrics)
            assert metrics['pane']['top'] == 40
            assert metrics['pane']['right'] == 1194
            assert metrics['pane']['bottom'] == 774
            assert metrics['pane']['left'] == (6 if collapsed else 232)
            assert metrics['radius'] == '10px'
            assert metrics['border'] == '1px'
            assert metrics['overflow'] == 'visible'  # no new sticky ancestor
            assert metrics['sideBorder'] == metrics['footerBorder'] == '0px'
            assert metrics['headerRect'] == {'top': 0, 'bottom': 40, 'left': (6 if collapsed else 232), 'right':1194}, metrics
            assert metrics['headerBorder'] == '0px', metrics
            assert metrics['transcriptTop'] == 41, metrics
            assert metrics['transcriptScrollable'] == 'auto'
            # The detached titlebar now belongs to the solid frame above the inset workspace.
            assert metrics['chrome'] == metrics['sideBg'], metrics
            assert metrics['frameHeight'] == '40px', metrics
            if theme == 'dark':
                assert metrics['frame'] == metrics['sideBg'] == 'rgb(25, 26, 21)', metrics
                assert metrics['bg'] == 'rgb(29, 30, 25)', metrics
            else:
                assert metrics['frame'] == metrics['sideBg'] == 'rgb(245, 240, 229)', metrics
    # OpenCode-style painter order: the floating composer uses a raised opaque
    # V2 surface above the base chat, with one wallpaper tint covering both.
    # The light palette remains independent.
    for theme in ('dark', 'light'):
        page.evaluate('(theme) => document.documentElement.dataset.theme=theme', theme)
        palette = page.evaluate('''() => {
          const el = document.querySelector('.composer');
          const cs = getComputedStyle(el);
          const chat = getComputedStyle(document.querySelector('.chat-pane'));
          const sidebar = getComputedStyle(document.querySelector('.session-sidebar'));
          return {composer:cs.backgroundColor, composerBorder:cs.borderTopColor,
            chat:chat.backgroundColor, sidebar:sidebar.backgroundColor,
            composerBlur:cs.backdropFilter, composerPosition:cs.position};
        }''')
        print(theme, 'surface palette', palette)
        assert palette['composerBlur'] == 'none', palette
        if theme == 'dark':
            assert palette['composer'] == 'rgb(40, 41, 35)' and palette['chat'] == 'rgb(29, 30, 25)', palette
            assert palette['composerBorder'] == 'rgb(55, 55, 50)', palette
            assert palette['sidebar'] == 'rgb(25, 26, 21)', palette
        else:
            assert palette['composer'] != 'rgb(29, 30, 25)', palette
    # Settings is the same inset shell and must use identical pane paint.
    for theme in ('dark', 'light'):
        page.evaluate('''(theme) => {
          document.documentElement.dataset.theme = theme;
          document.querySelector('.settings-workspace').hidden = false;
          document.querySelector('.workspace').style.visibility='hidden';
        }''', theme)
        m = page.evaluate('''() => {
          const main = document.querySelector('.settings-main');
          const b = main.getBoundingClientRect();
          return {top:b.top,left:b.left,right:b.right,bottom:b.bottom,
            radius:getComputedStyle(main).borderTopLeftRadius,
            bg:getComputedStyle(main).backgroundColor,
            header:getComputedStyle(document.querySelector('.settings-main-titlebar')).backgroundColor,
            sidebarBg:getComputedStyle(document.querySelector('.settings-sidebar')).backgroundColor,
            sidebarBorder:getComputedStyle(document.querySelector('.settings-sidebar')).borderRightWidth,
            titlebarBorder:getComputedStyle(document.querySelector('.settings-main-titlebar')).borderBottomWidth};
        }''')
        assert (m['top'],m['left'],m['right'],m['bottom']) == (40,232,1194,774), m
        assert m['radius'] == '10px' and m['titlebarBorder'] == m['sidebarBorder'] == '0px', m
        assert m['header'] == m['sidebarBg'], m
        if theme == 'dark':
            assert m['bg'] == 'rgb(29, 30, 25)' and m['sidebarBg'] == 'rgb(25, 26, 21)', m
        page.evaluate('''() => {
          document.querySelector('.settings-workspace').hidden = true;
          document.querySelector('.workspace').style.visibility='';
        }''')
    page.set_viewport_size({'width': 850, 'height': 520})
    page.evaluate('''() => {
      const workspace = document.querySelector('.workspace');
      workspace.classList.replace('sidebar-hidden', 'sidebar-visible');
      document.querySelector('.session-sidebar').style.display = '';
    }''')
    narrow = page.evaluate('''() => {
      const pane = document.querySelector('.chat-pane').getBoundingClientRect();
      return {left:pane.left, right:pane.right, bottom:pane.bottom, width:pane.width, height:pane.height};
    }''')
    assert narrow['width'] > 580 and narrow['height'] > 460 and narrow['bottom'] == 514, narrow
    # Screenshot-level regression: the detached titlebar paints the solid frame
    # and the pane border alone separates it from the wallpaper-covered chat panel.
    from io import BytesIO
    from PIL import Image
    page.set_viewport_size({'width': 1200, 'height': 780})
    page.evaluate("""() => {
      document.documentElement.dataset.theme='dark';
      const shell=document.querySelector('.app-shell');
      shell.classList.remove('background-disabled');
      shell.classList.add('background-enabled');
      shell.style.setProperty('--app-background-image', 'linear-gradient(90deg, #00ffff, #ff00ff)');
    }""")
    def pixel(x, y):
        return Image.open(BytesIO(page.screenshot())).convert('RGB').getpixel((x, y))
    assert pixel(400, 15) == pixel(900, 15), 'Top frame still shows wallpaper gradient'
    assert pixel(1197, 400) == pixel(1197, 180), 'Right gutter still shows wallpaper gradient'
    assert pixel(400, 777) == pixel(900, 777), 'Bottom gutter still shows wallpaper gradient'
    page.evaluate("""() => {
      const shell=document.querySelector('.app-shell');
      shell.style.setProperty('--mf-wallpaper-overlay-opacity', '0.12');
    }""")
    header = pixel(900, 20)
    body = pixel(900, 145)
    assert max(abs(a-b) for a,b in zip(header, body)) >= 4, (header, body)
    print('strip pixels', [(y,pixel(900,y)) for y in [15,20,35,37,38,39,40,41,42]])
    assert max(abs(a-b) for a,b in zip(pixel(900,39),pixel(900,20))) < 3, 'Redundant divider under the detached titlebar'
    browser.close()
print('PASS: Monokai shell, detached titlebar without duplicate divider, frame, margins and scroll hierarchy')
