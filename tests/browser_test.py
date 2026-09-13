"""Local, dependency-light browser checks using Chrome's DevTools protocol.

Run: python tests/browser_test.py
Requires an installed Chrome and Python websocket-client; no driver download.
The Browser context manager is reusable by additional application scenarios.
"""
from __future__ import annotations

import base64
import functools
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

import websocket


WORKSPACE = Path(__file__).resolve().parents[1]
ARTIFACTS = WORKSPACE / "tests" / "artifacts"
CHROME = Path("C:/Program Files/Google/Chrome/Application/chrome.exe")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format, *args):
        pass


class LocalServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Browser:
    """One hidden Chrome process, local HTTP server and synchronous CDP session."""

    def __init__(self, http_port=8765, debug_port=9223):
        self.http_port = http_port
        self.debug_port = debug_port
        self.base_url = f"http://localhost:{http_port}"
        self.debug_url = f"http://localhost:{debug_port}"
        self.profile = WORKSPACE / "tests" / ".browser-profile"
        self.process = None
        self.server = None
        self.server_thread = None
        self.ws = None
        self.sequence = 0
        self.events = []
        self.console_errors = []
        self.log = None

    def __enter__(self):
        try:
            self.start()
            return self
        except BaseException:
            self.close()
            raise

    def __exit__(self, _type, _value, _traceback):
        self.close()

    def start(self):
        if not CHROME.is_file():
            raise FileNotFoundError(f"Chrome was not found: {CHROME}")
        # Never attach to or terminate a browser that this test did not start.
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", self.debug_port)) == 0:
                raise RuntimeError(f"CDP port {self.debug_port} is already in use")
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        self.profile.mkdir(parents=True, exist_ok=True)
        handler = functools.partial(QuietHandler, directory=str(WORKSPACE))
        self.server = LocalServer(("127.0.0.1", self.http_port), handler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.log = (ARTIFACTS / "chrome.log").open("w", encoding="utf-8")
        args = [str(CHROME), "--headless=new", f"--remote-debugging-port={self.debug_port}",
                f"--remote-allow-origins={self.debug_url}", f"--user-data-dir={self.profile}",
                "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
                "--disable-component-update", "--disable-sync", "about:blank"]
        self.process = subprocess.Popen(
            args, cwd=str(WORKSPACE), stdin=subprocess.DEVNULL,
            stdout=self.log, stderr=self.log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        deadline = time.monotonic() + 20
        last_error = None
        targets = []
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"Chrome exited ({self.process.returncode}); see tests/artifacts/chrome.log")
            try:
                with urllib.request.urlopen(f"{self.debug_url}/json/list", timeout=1) as response:
                    targets = json.load(response)
                if any(target.get("type") == "page" for target in targets):
                    break
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                last_error = error
            time.sleep(0.1)
        page = next((target for target in targets if target.get("type") == "page"), None)
        if page is None:
            raise RuntimeError(f"Chrome CDP did not become ready: {last_error}")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], origin=self.debug_url, timeout=15)
        self.command("Page.enable")
        self.command("Runtime.enable")
        self.command("Log.enable")
        self.command("Network.enable")
        self.command("Network.setCacheDisabled", {"cacheDisabled": True})
        self.viewport(1920, 1080)

    def command(self, method, params=None):
        if self.ws is None:
            raise RuntimeError("The browser is not connected")
        self.sequence += 1
        identifier = self.sequence
        self.ws.send(json.dumps({"id": identifier, "method": method, "params": params or {}}))
        while True:
            response = json.loads(self.ws.recv())
            if response.get("id") == identifier:
                if "error" in response:
                    raise RuntimeError(f"{method}: {response['error']}")
                return response.get("result", {})
            event_name = response.get("method", "")
            if event_name:
                self.events.append(response)
                if event_name == "Runtime.exceptionThrown":
                    self.console_errors.append(response["params"]["exceptionDetails"])
                if event_name == "Log.entryAdded" and response["params"]["entry"].get("level") == "error":
                    self.console_errors.append(response["params"]["entry"])
                if event_name == "Runtime.consoleAPICalled" and response["params"].get("type") == "error":
                    self.console_errors.append(response["params"])

    def eval(self, expression, user_gesture=True):
        result = self.command("Runtime.evaluate", {
            "expression": expression, "returnByValue": True,
            "awaitPromise": True, "userGesture": user_gesture,
        })
        if result.get("exceptionDetails"):
            raise RuntimeError(f"JavaScript evaluation failed: {result['exceptionDetails']}")
        return result.get("result", {}).get("value")

    def navigate(self, path="/index.html"):
        url = path if path.startswith("http") else self.base_url + path
        result = self.command("Page.navigate", {"url": url})
        if result.get("errorText"):
            raise RuntimeError(f"Navigation failed: {result['errorText']}")
        self.wait_for("document.readyState === 'complete'", timeout=15)
        self.wait("body")
        return self

    def wait_for(self, expression, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.eval(expression):
                return True
            time.sleep(0.05)
        raise AssertionError(f"Timed out waiting for: {expression}")

    def wait(self, selector, timeout=5, visible=True):
        expression = ("(() => { const el = document.querySelector(" + json.dumps(selector) + "); "
                      "if (!el) return false; "
                      + ("const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && "
                         "getComputedStyle(el).visibility !== 'hidden';" if visible else "return true;")
                      + " })()")
        self.wait_for(expression, timeout)
        return self

    def click(self, selector):
        self.wait(selector)
        position = self.eval("(() => { const el = document.querySelector(" + json.dumps(selector) + "); "
                             "el.scrollIntoView({block:'nearest', inline:'nearest'}); "
                             "const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()")
        self.command("Input.dispatchMouseEvent", {"type": "mousePressed", "button": "left", "clickCount": 1, **position})
        self.command("Input.dispatchMouseEvent", {"type": "mouseReleased", "button": "left", "clickCount": 1, **position})
        return self

    def key(self, key, modifiers=0):
        mapping = {"ArrowLeft": ("ArrowLeft", 37), "ArrowRight": ("ArrowRight", 39),
                   "ArrowUp": ("ArrowUp", 38), "ArrowDown": ("ArrowDown", 40),
                   "Enter": ("Enter", 13), "Escape": ("Escape", 27), "Tab": ("Tab", 9),
                   " ": ("Space", 32), "Space": ("Space", 32)}
        code, virtual_key = mapping.get(key, (f"Key{key.upper()}", ord(key.upper()) if len(key) == 1 else 0))
        actual_key = " " if key == "Space" else key
        fields = {"key": actual_key, "code": code, "windowsVirtualKeyCode": virtual_key, "modifiers": modifiers}
        self.command("Input.dispatchKeyEvent", {"type": "keyDown", **fields})
        self.command("Input.dispatchKeyEvent", {"type": "keyUp", **fields})
        return self

    def viewport(self, width, height, device_scale=1):
        self.command("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": device_scale,
            "mobile": False, "screenWidth": width, "screenHeight": height,
        })
        return self

    def screenshot(self, filename):
        self.eval("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        path = Path(filename)
        if not path.is_absolute():
            path = ARTIFACTS / path
        path.parent.mkdir(parents=True, exist_ok=True)
        shot = self.command("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False, "fromSurface": True})
        path.write_bytes(base64.b64decode(shot["data"]))
        return path

    def boundaries(self, selector="body > *"):
        return self.eval("""(() => {
          const w = innerWidth, h = innerHeight;
          return {
            viewport: {width:w,height:h},
            document: {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
            scroll: {x:scrollX,y:scrollY},
            elements: [...document.querySelectorAll(SELECTOR)].map(el => {
              const r = el.getBoundingClientRect();
              return {tag:el.tagName,id:el.id,className:typeof el.className === 'string' ? el.className : '',
                x:r.x,y:r.y,width:r.width,height:r.height,
                visible:r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
                overflow:r.x < -1 || r.y < -1 || r.right > w+1 || r.bottom > h+1};
            })
          };
        })()""".replace("SELECTOR", json.dumps(selector)))

    def close(self):
        if self.ws is not None:
            try:
                self.command("Browser.close")
            except (RuntimeError, websocket.WebSocketException, OSError, ValueError):
                pass
            try:
                self.ws.close()
            except (websocket.WebSocketException, OSError):
                pass
            self.ws = None
        if self.process is not None:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            self.process = None
            # These are only this dedicated profile's browser lock files.
            allowed_root = (WORKSPACE / "tests").resolve()
            resolved_profile = self.profile.resolve()
            if resolved_profile.parent == allowed_root and resolved_profile.name == ".browser-profile":
                for filename in ("SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"):
                    candidate = resolved_profile / filename
                    try:
                        if candidate.is_file() or candidate.is_symlink():
                            candidate.unlink()
                    except OSError:
                        pass
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        if self.server_thread is not None:
            self.server_thread.join(timeout=2)
            self.server_thread = None
        if self.log is not None:
            self.log.close()
            self.log = None


def main():
    with Browser() as browser:
        browser.navigate()
        browser.wait_for("document.fonts.status === 'loaded'")
        report = {"page": browser.eval("({title:document.title,url:location.href})"),
                  "homepageFhd": browser.boundaries(), "consoleErrors": browser.console_errors}
        report["screenshot"] = str(browser.screenshot("homepage-1920x1080.png").relative_to(WORKSPACE))
        (ARTIFACTS / "browser-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    import sys
    if "--scenarios" in sys.argv:
        from scenarios import run
        run()
    else:
        main()
