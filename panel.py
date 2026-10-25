# -*- coding: utf-8 -*-
"""小女仆挂件 · 四个悬浮图标版。

四个图标直接浮在女仆周围（无边框、透明背景）：
  饭（喂食）/ 时钟（番茄钟）/ 水杯（喝水）/ Q 版头像（状态）
番茄钟运行时会有一个气泡显示倒计时；状态只在点头像时用气泡显示。
窗口用 Windows 分层窗口逐像素透明，所以图标边缘没有白底或紫边。
"""
import atexit
import ctypes
import json
import os
import time
import tkinter as tk
from ctypes import wintypes as wt
from tkinter import simpledialog
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

DSH_HOME = os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")
DATA_DIR = os.path.join(DSH_HOME, "dsh-pet-plus")
STATE_FILE = os.path.join(DATA_DIR, "state.json")
PID_FILE = os.path.join(DATA_DIR, "panel.pid")
DEFAULT_PORT = 64679

W, H = 460, 420
ICON = 44
try:
    AUTO_HIDE_SECONDS = max(1, int(os.environ.get("DSH_PET_PLUS_AUTOHIDE", "5")))
except Exception:
    AUTO_HIDE_SECONDS = 300
OUT = (12, 18, 40, 255)
INK = (43, 48, 64, 255)
FONT_NAME = "Microsoft YaHei UI"
BLUE = (77, 107, 254, 255)
BLUE_D = (56, 82, 208, 255)
WATER = (120, 180, 255, 255)

RECTS = {
    "feed": (34, 150, 34 + ICON, 150 + ICON),
    "focus": (382, 150, 382 + ICON, 150 + ICON),
    "water": (34, 300, 34 + ICON, 300 + ICON),
    "status": (382, 300, 382 + ICON, 300 + ICON),
}


def _font(size, bold=False):
    windir = os.environ.get("WINDIR", r"C:\Windows")
    names = ("msyhbd.ttc", "msyh.ttc") if bold else ("msyh.ttc", "msyhbd.ttc")
    for name in names + ("simhei.ttf", "simsun.ttc", "arial.ttf"):
        try:
            return ImageFont.truetype(os.path.join(windir, "Fonts", name), size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_bowl(s=ICON):
    k = 4
    n = s * k
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = 2 * k
    d.polygon([(7 * k, 21 * k), (37 * k, 21 * k), (32 * k, 39 * k), (12 * k, 39 * k)],
              fill=BLUE, outline=OUT, width=w)
    d.ellipse([4 * k, 17 * k, 40 * k, 27 * k], fill=(255, 255, 255, 255), outline=OUT, width=w)
    d.ellipse([10 * k, 9 * k, 34 * k, 23 * k], fill=(255, 255, 255, 255), outline=OUT, width=w)
    d.arc([16 * k, 1 * k, 24 * k, 10 * k], 200, 340, fill=OUT, width=w)
    d.arc([22 * k, 0 * k, 30 * k, 9 * k], 200, 340, fill=OUT, width=w)
    return im.resize((s, s), Image.LANCZOS)


def draw_clock(s=ICON):
    k = 4
    n = s * k
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = 2 * k
    d.rectangle([19 * k, 3 * k, 25 * k, 8 * k], fill=BLUE, outline=OUT, width=w)
    d.ellipse([5 * k, 8 * k, 39 * k, 42 * k], fill=(255, 255, 255, 255), outline=OUT, width=w)
    cx, cy = 22 * k, 25 * k
    d.line([cx, cy, cx, cy - 10 * k], fill=BLUE_D, width=2 * k)
    d.line([cx, cy, cx + 7 * k, cy], fill=BLUE_D, width=2 * k)
    d.ellipse([cx - 2 * k, cy - 2 * k, cx + 2 * k, cy + 2 * k], fill=OUT)
    for a, b in ((22, 11), (22, 39), (8, 25), (36, 25)):
        d.line([a * k, (b - 1) * k, a * k, (b + 1) * k], fill=OUT, width=k)
    return im.resize((s, s), Image.LANCZOS)


def draw_cup(s=ICON):
    k = 4
    n = s * k
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = 2 * k
    d.polygon([(13 * k, 10 * k), (35 * k, 10 * k), (31 * k, 41 * k), (17 * k, 41 * k)],
              fill=(236, 245, 255, 255), outline=OUT, width=w)
    d.polygon([(15 * k, 23 * k), (33 * k, 23 * k), (30 * k, 39 * k), (18 * k, 39 * k)],
              fill=WATER, outline=None)
    d.line([16 * k, 23 * k, 33 * k, 23 * k], fill=(90, 155, 235, 255), width=2 * k)
    d.line([18 * k, 26 * k, 19 * k, 35 * k], fill=(220, 238, 255, 255), width=2 * k)
    return im.resize((s, s), Image.LANCZOS)


def draw_avatar(assets, s=ICON):
    path = os.path.join(assets, "memes", "可爱.png") if assets else ""
    try:
        im = Image.open(path).convert("RGBA")
        w, h = im.size
        crop = im.crop((int(w * 0.20), int(h * 0.00), int(w * 0.80), int(h * 0.56)))
        crop = ImageOps.fit(crop, (s * 4, s * 4), method=Image.LANCZOS)
        arr = np.array(crop)
        white = (arr[..., 0] > 244) & (arr[..., 1] > 244) & (arr[..., 2] > 244)
        arr[..., 3][white] = 0
        crop = Image.fromarray(arr)
        mask = Image.new("L", (s * 4, s * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, s * 4 - 1, s * 4 - 1], fill=255)
        out = Image.new("RGBA", (s * 4, s * 4), (0, 0, 0, 0))
        out.paste(crop, (0, 0), mask)
        return out.resize((s, s), Image.LANCZOS)
    except Exception:
        im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.ellipse([2, 4, s - 2, s - 2], fill=BLUE, outline=OUT, width=3)
        d.ellipse([s * 0.32, s * 0.38, s * 0.42, s * 0.48], fill=OUT)
        d.ellipse([s * 0.58, s * 0.38, s * 0.68, s * 0.48], fill=OUT)
        d.arc([s * 0.36, s * 0.52, s * 0.64, s * 0.68], 20, 160, fill=OUT, width=2)
        return im


def asset_root():
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(os.path.dirname(here), "dsh-pet", "assets"),
        os.path.join(DSH_HOME, "profiles", "desktop", "node_modules", "dsh-pet", "assets"),
        os.path.join(os.path.expanduser("~"), ".dsh", "profiles", "desktop", "node_modules", "dsh-pet", "assets"),
    ]
    for base in candidates:
        if os.path.isdir(os.path.join(base, "memes")):
            return base
    return None


def bubble_image(text, size=10, bold=False):
    """白底、深色描边、尾巴朝上的气泡；尺寸只跟着文字走。"""
    sw = 3
    font = _font(size * sw, bold)
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    tw = int(probe.textlength(text, font=font))
    asc, desc = font.getmetrics()
    th = asc + desc
    pad = 12 * sw
    bw = tw + pad * 2
    bh = th + pad * 2 + 10 * sw
    im = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    border = 3 * sw
    top = 10 * sw
    d.rounded_rectangle([sw, top, bw - sw, bh - sw], radius=14 * sw,
                        fill=(255, 255, 255, 250), outline=OUT, width=border)
    cx = bw // 2
    d.polygon([(cx - 10 * sw, top), (cx, sw), (cx + 10 * sw, top)], fill=(255, 255, 255, 250))
    d.line([(cx - 10 * sw, top), (cx, sw)], fill=OUT, width=border)
    d.line([(cx + 10 * sw, top), (cx, sw)], fill=OUT, width=border)
    d.text(((bw - tw) // 2, top + pad), text, font=font, fill=INK)
    return im.resize((bw // sw, bh // sw), Image.LANCZOS)


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG),
                ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG),
                ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wt.DWORD * 3)]


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_ubyte), ("BlendFlags", ctypes.c_ubyte),
                ("SourceConstantAlpha", ctypes.c_ubyte), ("AlphaFormat", ctypes.c_ubyte)]


class POINT(ctypes.Structure):
    _fields_ = [("x", wt.LONG), ("y", wt.LONG)]


class SIZE(ctypes.Structure):
    _fields_ = [("cx", wt.LONG), ("cy", wt.LONG)]


user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

try:
    user32.SetWindowPos.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, ctypes.c_int, ctypes.c_uint,
    ]
    user32.SetWindowPos.restype = ctypes.c_int
except Exception:
    pass

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TOOLWINDOW = 0x00000080
GA_ROOT = 2
RGN_OR = 2
HWND_TOPMOST = -1
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010


def premultiply(img):
    a = np.asarray(img, dtype=np.uint16)
    alpha = a[..., 3:4]
    bgra = np.empty(a.shape, dtype=np.uint8)
    bgra[..., 0] = (a[..., 2:3] * alpha // 255)[..., 0]
    bgra[..., 1] = (a[..., 1:2] * alpha // 255)[..., 0]
    bgra[..., 2] = (a[..., 0:1] * alpha // 255)[..., 0]
    bgra[..., 3] = alpha[..., 0]
    return bgra.tobytes()


class LayeredWindow:
    def __init__(self, hwnd, w, h):
        self.hwnd, self.w, self.h = hwnd, w, h
        st = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, st | WS_EX_LAYERED | WS_EX_TOOLWINDOW)
        self.screen_dc = user32.GetDC(None)
        self.mem_dc = gdi32.CreateCompatibleDC(self.screen_dc)
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = w
        bmi.bmiHeader.biHeight = -h
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0
        self.bits = ctypes.c_void_p()
        self.hbmp = gdi32.CreateDIBSection(self.mem_dc, ctypes.byref(bmi), 0,
                                           ctypes.byref(self.bits), None, 0)
        gdi32.SelectObject(self.mem_dc, self.hbmp)

    def blit(self, bgra, x, y):
        ctypes.memmove(self.bits, bgra, len(bgra))
        pt_dst, pt_src = POINT(int(x), int(y)), POINT(0, 0)
        size = SIZE(self.w, self.h)
        blend = BLENDFUNCTION(0, 0, 255, 1)
        user32.UpdateLayeredWindow(self.hwnd, self.screen_dc, ctypes.byref(pt_dst),
                                   ctypes.byref(size), self.mem_dc, ctypes.byref(pt_src),
                                   0, ctypes.byref(blend), 2)

    def set_region(self, rects):
        rgn = gdi32.CreateRectRgn(0, 0, 0, 0)
        for l, t, r, b in rects:
            r2 = gdi32.CreateRectRgn(int(l), int(t), int(r), int(b))
            gdi32.CombineRgn(rgn, rgn, r2, RGN_OR)
            gdi32.DeleteObject(r2)
        user32.SetWindowRgn(self.hwnd, rgn, True)


def work_area():
    class RECT(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                    ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

    r = RECT()
    try:
        if user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0):
            return r.left, r.top, r.right, r.bottom
    except Exception:
        pass
    return 0, 0, user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def read_port():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            port = int(json.load(f).get("port") or 0)
        return port or DEFAULT_PORT
    except Exception:
        return DEFAULT_PORT


def api_get_dsh(path):
    url = "http://127.0.0.1:%d/dsh-pet-7340%s" % (read_port(), path)
    with urllib.request.urlopen(url, timeout=1.2) as r:
        return json.loads(r.read().decode("utf-8"))


def api_get_plus(path):
    url = "http://127.0.0.1:%d/dsh-pet-plus%s" % (read_port(), path)
    with urllib.request.urlopen(url, timeout=1.5) as r:
        return json.loads(r.read().decode("utf-8"))


def api_post(path, payload):
    url = "http://127.0.0.1:%d/dsh-pet-plus%s" % (read_port(), path)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=2.0) as r:
        return json.loads(r.read().decode("utf-8"))


def clear_pet_say():
    """清掉 dsh-pet 刚弹出的「专注 N 分钟」说话气泡，只留倒计时。"""
    url = "http://127.0.0.1:%d/dsh-pet-7340/bubble/clear?pet=main&surface=any" % read_port()
    req = urllib.request.Request(url, data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1.5):
        pass


def _pid_alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def acquire_single_instance():
    old = 0
    try:
        with open(PID_FILE, "r", encoding="utf-8") as f:
            old = int(f.read().strip() or 0)
    except Exception:
        old = 0
    if _pid_alive(old):
        return False
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(PID_FILE, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass

    def cleanup():
        try:
            with open(PID_FILE, "r", encoding="utf-8") as f:
                cur = int(f.read().strip() or 0)
            if cur == os.getpid():
                os.remove(PID_FILE)
        except Exception:
            pass

    atexit.register(cleanup)
    return True


class Overlay:
    def __init__(self, root):
        self.root = root
        self.state = {}
        self.flash_until = 0
        self.flash_text = ""
        self.pos = (0, 0)
        self.last_sig = None
        self.icons_visible = False
        self.pet_center = None
        self.mouse_down = False
        self.last_interaction = 0.0

        root.overrideredirect(True)
        root.attributes("-topmost", True)
        try:
            root.attributes("-toolwindow", True)
        except Exception:
            pass
        root.config(bg="black")
        root.geometry("%dx%d+0+0" % (W, H))
        root.update()

        assets = asset_root()
        self.icons = {
            "feed": draw_bowl(),
            "focus": draw_clock(),
            "water": draw_cup(),
            "status": draw_avatar(assets),
        }

        hwnd = user32.GetAncestor(root.winfo_id(), GA_ROOT)
        self.lay = LayeredWindow(hwnd, W, H)
        root.bind("<Button-1>", self.on_click)
        root.bind("<Button-3>", self.on_menu)

        self.refresh_state()
        self.follow_pose()
        self.render()
        root.after(1000, self.tick)
        root.after(80, self.poll_click)

    def active_keys(self):
        return ["feed", "focus", "water", "status"] if self.icons_visible else []

    def bubble_text(self):
        if time.time() < self.flash_until and self.flash_text:
            return self.flash_text
        sec = int(self.state.get("focusLeftSec") or 0)
        if sec > 0:
            return "专注 %02d:%02d" % (sec // 60, sec % 60)
        return ""

    def render(self):
        text = self.bubble_text()
        sig = (self.pos[0], self.pos[1], text, self.icons_visible)
        if sig == self.last_sig:
            return
        self.last_sig = sig

        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for key in self.active_keys():
            im = self.icons[key]
            r = RECTS[key]
            canvas.alpha_composite(im, (r[0], r[1]))

        bubble = None
        if text:
            if text.startswith("专注"):
                bimg = bubble_image(text, size=21, bold=True)
            else:
                bimg = bubble_image(text, size=11)
            bx = (W - bimg.width) // 2
            by = H - bimg.height - 4
            canvas.alpha_composite(bimg, (bx, by))
            bubble = (bx, by, bx + bimg.width, by + bimg.height)

        self.lay.blit(premultiply(canvas), self.pos[0], self.pos[1])
        rects = [RECTS[k] for k in self.active_keys()]
        if bubble:
            rects.append(bubble)
        if not rects:
            # 空 region 会让整个分层窗口不可见，之后气泡也显示不出来；留 1px 占位
            rects = [(0, 0, 1, 1)]
        self.lay.set_region(rects)
        # 压到所有 topmost 窗口之上，避免倒计时被 dsh-pet 自己的说话气泡盖住
        user32.SetWindowPos(ctypes.c_void_p(self.lay.hwnd), ctypes.c_void_p(-1),
                            0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)

    def follow_pose(self):
        try:
            pose = api_get_dsh("/pose?pet=main")
        except Exception:
            return
        if not pose.get("ok"):
            return
        wl, wt, wr, wb = work_area()
        cx = float(pose.get("x", 0.5)) * wr
        cy = float(pose.get("y", 0.5)) * wb
        self.pet_center = (cx, cy)
        x = int(cx - W // 2)
        y = int(cy - H // 2)
        x = max(wl, min(x, wr - W))
        y = max(wt, min(y, wb - H))
        if (x, y) != self.pos:
            self.pos = (x, y)
            self.root.geometry("+%d+%d" % (x, y))
            self.render()

    def refresh_state(self):
        try:
            self.state = api_get_plus("/state")["state"]
        except Exception:
            self.state = {}

    def on_click(self, event):
        self.touch()
        for key in self.active_keys():
            x0, y0, x1, y1 = RECTS[key]
            if x0 <= event.x <= x1 and y0 <= event.y <= y1:
                self.action(key)
                return
        if self.state.get("focusLeftSec", 0) > 0 and time.time() >= self.flash_until:
            self.act("focus-stop")

    def action(self, key):
        if key == "feed":
            self.act("feed")
        elif key == "focus":
            self.open_focus_menu()
        elif key == "water":
            self.open_water_menu()
        elif key == "status":
            # 只让女仆自己说一遍，不在挂件上再弹气泡
            try:
                api_post("/action", {"action": "status"})
            except Exception:
                pass
            self.root.after(400, self.refresh_state)

    def _menu(self):
        return tk.Menu(self.root, tearoff=0, font=(FONT_NAME, 9), bg="#ffffff", fg="#2b3040",
                       activebackground="#e8ecfb", activeforeground="#2b3040")

    def open_focus_menu(self):
        menu = self._menu()
        for m in (15, 25, 45, 60, 90):
            menu.add_command(label="%d 分钟" % m, command=lambda v=m: self.act("focus", minutes=v, quiet=True))
        menu.add_separator()
        menu.add_command(label="自定义…", command=self.ask_focus)
        menu.add_command(label="停止番茄钟", command=lambda: self.act("focus-stop"))
        self._menu_focus = menu
        r = RECTS["focus"]
        x = self.root.winfo_rootx() + r[2]
        y = self.root.winfo_rooty() + r[3]
        try:
            menu.tk_popup(x, y)
        finally:
            menu.grab_release()

    def open_water_menu(self):
        menu = self._menu()
        for m in (30, 45, 60):
            menu.add_command(label="每 %d 分钟" % m, command=lambda v=m: self.act("water", minutes=v))
        menu.add_separator()
        menu.add_command(label="关闭喝水提醒", command=lambda: self.act("water-off"))
        self._menu_water = menu
        r = RECTS["water"]
        x = self.root.winfo_rootx() + r[2]
        y = self.root.winfo_rooty() + r[3]
        try:
            menu.tk_popup(x, y)
        finally:
            menu.grab_release()

    def on_menu(self, event):
        self.touch()
        menu = self._menu()
        fm = self._menu()
        for m in (15, 25, 45, 60, 90):
            fm.add_command(label="%d 分钟" % m, command=lambda v=m: self.act("focus", minutes=v, quiet=True))
        fm.add_separator()
        fm.add_command(label="自定义…", command=self.ask_focus)
        menu.add_cascade(label="番茄钟", menu=fm)

        wm = self._menu()
        for m in (30, 45, 60):
            wm.add_command(label="每 %d 分钟" % m, command=lambda v=m: self.act("water", minutes=v))
        wm.add_separator()
        wm.add_command(label="关闭喝水提醒", command=lambda: self.act("water-off"))
        menu.add_cascade(label="喝水提醒", menu=wm)

        menu.add_command(label="停止番茄钟", command=lambda: self.act("focus-stop"))
        menu.add_command(label="刷新", command=self.refresh_state)
        menu.add_command(label="显示/隐藏图标", command=self.toggle_icons)
        menu.add_separator()
        menu.add_command(label="关闭挂件", command=self.root.destroy)
        self._menu_all = menu
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def ask_focus(self):
        m = simpledialog.askinteger("番茄钟", "分钟数（1-180）", parent=self.root,
                                    minvalue=1, maxvalue=180, initialvalue=25)
        if m:
            self.act("focus", minutes=m, quiet=True)

    def act(self, action, **payload):
        self.touch()
        start_focus = action == "focus"
        try:
            data = {"action": action}
            data.update(payload)
            api_post("/action", data)
            if start_focus:
                try:
                    clear_pet_say()
                except Exception:
                    pass
        except Exception:
            pass
        # 不在挂件上弹反馈气泡：喂食/喝水/状态都只看女仆头顶的气泡
        self.flash_text = ""
        self.flash_until = 0
        self.refresh_state()
        self.render()

    def tick(self):
        self.refresh_state()
        self.follow_pose()
        if self.icons_visible and self.last_interaction:
            if time.time() - self.last_interaction >= AUTO_HIDE_SECONDS:
                self.icons_visible = False
        self.render()
        self.root.after(1000, self.tick)

    def toggle_icons(self):
        self.icons_visible = not self.icons_visible
        if self.icons_visible:
            self.last_interaction = time.time()
        self.render()

    def touch(self):
        self.last_interaction = time.time()

    def poll_click(self):
        try:
            pt = POINT()
            user32.GetCursorPos(ctypes.byref(pt))
            down = bool(user32.GetAsyncKeyState(0x01) & 0x8000)
            if down and not self.mouse_down and self.pet_center:
                cx, cy = self.pet_center
                if cx - 150 <= pt.x <= cx + 150 and cy - 180 <= pt.y <= cy + 120:
                    self.icons_visible = not self.icons_visible
                    if self.icons_visible:
                        self.last_interaction = time.time()
                    self.render()
            self.mouse_down = down
        except Exception:
            pass
        self.root.after(80, self.poll_click)


def main():
    if not acquire_single_instance():
        return
    root = tk.Tk()
    Overlay(root)
    root.mainloop()


if __name__ == "__main__":
    main()
