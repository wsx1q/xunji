"""Windows desktop host: private loopback origin, native dialogs, WebView2 and shared ledger logic."""
from __future__ import annotations

import argparse
import ctypes
import json
import logging
import mimetypes
import os
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from native import NativeBridge
from storage import dumps

RESOURCES = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))
WEB = RESOURCES / 'web'
ASSETS = RESOURCES / 'desktop'
if not (ASSETS / 'bridge.js').exists():
    ASSETS = Path(__file__).resolve().parent


def create_server(bridge, port=0):
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_):
            pass

        def reply(self, code, data, kind='application/json; charset=utf-8'):
            self.send_response(code)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Frame-Options', 'DENY')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.headers.get('Host') != self.server.host:
                return self.reply(403, b'{}')
            route = unquote(urlsplit(self.path).path)
            if route in ('/', '/index.html'):
                config = dumps({'token': token, 'version': bridge.appVersion(), 'eventPolling': bridge.window is None})
                html = (WEB / 'index.html').read_text('utf-8')
                html = html.replace('<title>洵记</title>', '<title>洵记 · 桌面版</title>')
                html = html.replace('</head>', '<link rel="stylesheet" href="/desktop/style.css"></head>')
                html = html.replace('<script src="js/lib/bill_parser.js">',
                                    f'<script>window.__DESKTOP_CONFIG__={config};</script><script src="/desktop/bridge.js"></script><script src="js/lib/bill_parser.js">')
                html = html.replace('<script src="js/main.js"></script>',
                                    '<script src="/desktop/ui.js"></script><script src="js/main.js"></script>')
                return self.reply(200, html.encode('utf-8'), 'text/html; charset=utf-8')
            if route.startswith('/desktop/'):
                name = route[len('/desktop/'):]
                if name not in {'style.css', 'bridge.js', 'ui.js', 'app.png'}:
                    return self.reply(404, b'{}')
                file = ASSETS / name
            else:
                file = (WEB / route.lstrip('/')).resolve()
                if not file.is_relative_to(WEB.resolve()) or file.suffix.lower() not in {'.js', '.css', '.png', '.svg', '.jpg', '.html'}:
                    return self.reply(404, b'{}')
            if not file.is_file():
                return self.reply(404, b'{}')
            content = file.read_bytes()
            kind = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
            return self.reply(200, content, kind + ('; charset=utf-8' if file.suffix in {'.js', '.css', '.html'} else ''))

        def do_POST(self):
            origin = 'http://' + self.server.host
            if (self.path != '/api' or self.headers.get('Host') != self.server.host or
                self.headers.get('X-Xunji-Token') != token or self.headers.get('Origin', origin) != origin):
                return self.reply(403, b'{"error":"access denied"}')
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 256 * 1024 * 1024:
                    return self.reply(413, b'{"error":"request too large"}')
                request = json.loads(self.rfile.read(length))
                result = bridge.dispatch(request['method'], request.get('args', []))
                self.reply(200, dumps({'result': result}).encode('utf-8'))
            except Exception as exc:
                self.reply(400, dumps({'error': str(exc)}).encode('utf-8'))

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.host = f'127.0.0.1:{server.server_port}'
    server.session_token = token
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    home = args.data_dir or Path(os.environ['LOCALAPPDATA']) / 'XunJiDesktop'
    home.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=home / 'desktop.log', level=logging.WARNING,
                        format='%(asctime)s %(levelname)s %(message)s', encoding='utf-8')
    # Prevent two independent caches from overwriting the same encrypted database.
    import msvcrt
    instance = open(home / 'instance.lock', 'a+b')
    instance.seek(0)
    if not instance.read(1):
        instance.write(b'0')
        instance.flush()
    instance.seek(0)
    try:
        msvcrt.locking(instance.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        if not args.headless:
            ctypes.windll.user32.MessageBoxW(None, '洵记桌面版已经打开，请切换到已有窗口。', '洵记', 0x40)
        return
    bridge = NativeBridge(home)
    server = create_server(bridge, args.port)
    url = 'http://' + server.host + '/'
    if args.headless:
        print(url, flush=True)
        threading.Event().wait()
        return
    import webview
    screen = webview.screens[0]
    window = webview.create_window('洵记 · 桌面版', url, width=min(1440, screen.width - 70), height=min(940, screen.height - 80),
                                   min_size=(1024, 720), maximized=True, background_color='#F5F6F8')
    bridge.window = window
    allow_close, closing = threading.Event(), threading.Event()

    def close_worker():
        try:
            window.evaluate_js('window.onAppPause && onAppPause(); true')
            bridge._ready()
        except Exception as exc:
            logging.warning('Close/save failed: %s', exc)
            if not window.create_confirmation_dialog('保存失败', '未能完成保存。是否仍然关闭？\n' + str(exc)):
                closing.clear()
                return
        allow_close.set()
        window.destroy()

    def on_closing():
        if allow_close.is_set():
            return True
        if not closing.is_set():
            closing.set()
            threading.Thread(target=close_worker, daemon=True).start()
        return False

    def loaded():
        try:
            from Microsoft.Win32 import SystemEvents
            def session_changed(sender, event):
                if str(event.Reason) == 'SessionLock':
                    bridge.emit('lockNow')
            SystemEvents.SessionSwitch += session_changed
            window._session_changed = session_changed
        except Exception:
            logging.warning('Windows session lock notifications unavailable')

    window.events.closing += on_closing
    window.events.loaded += loaded
    try:
        webview.start(gui='edgechromium', private_mode=True, icon=str(ASSETS / 'app.ico'))
    except Exception:
        logging.exception('Desktop host failed')
        ctypes.windll.user32.MessageBoxW(None, '无法启动桌面版，请确认已安装 Microsoft Edge WebView2 Runtime。\n详情见 ' + str(home / 'desktop.log'), '洵记', 0x10)
    finally:
        server.shutdown()
        bridge.dbWait()
        instance.close()


if __name__ == '__main__':
    main()
