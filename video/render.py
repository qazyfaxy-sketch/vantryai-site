#!/usr/bin/env python3
"""Render one Vantry client video and upload it to YouTube (private) - runs on GitHub Actions.

    python video/render.py --id v123abc456de --out out          # real run (needs env below)
    python video/render.py --job sample.json --out out --dry    # local check: no voice API, no upload

Env for a real run:
  VIDEO_API            https://api.vantryai.com (must be in ALLOWED_API_HOSTS)
  VIDEO_SECRET         shared with the Worker
  ELEVENLABS_API_KEY   voice
  ELEVENLABS_VOICE_ID  optional voice id (default: a calm narrator voice)

Steps: fetch the job -> screenshot the client's pages -> voice each part -> build each part
(title card or a browser window scrolling their real page) -> join -> burn captions -> thumbnail ->
upload to YouTube as private (marked as paid promotion) + captions + thumbnail -> report back.
"""
import argparse, base64, json, math, os, re, subprocess, sys, textwrap, time
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1920, 1080, 30
WIN = (120, 78, 1800, 872)          # browser window on screen (x0, y0, x1, y1)
BAR = 46                            # browser top bar height
CONTENT = (WIN[0], WIN[1] + BAR, WIN[2], WIN[3])
CW, CH = CONTENT[2] - CONTENT[0], CONTENT[3] - CONTENT[1]
NAVY, NAVY2, ACCENT, INK = (13, 19, 46), (27, 40, 92), (110, 168, 255), (240, 244, 255)
ALLOWED_API_HOSTS = os.environ.get("ALLOWED_API_HOSTS", "api.vantryai.com").split(",")
DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"


def log(*a):
    print(*a, flush=True)


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {p.stderr[-1200:]}")
    return p.stdout


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).strip())


# ---------------- fonts and drawing ----------------

def font(size, bold=False):
    names = (["Inter-Bold.ttf", "Inter-Bold.otf", "InterDisplay-Bold.otf", "Poppins-Bold.ttf", "DejaVuSans-Bold.ttf"] if bold
             else ["Inter-Medium.ttf", "Inter-Medium.otf", "InterDisplay-Medium.otf", "Poppins-Medium.ttf", "DejaVuSans.ttf"])
    roots = ["/usr/share/fonts", str(Path.home() / ".fonts"), "/usr/local/share/fonts"]
    for n in names:
        for r in roots:
            for p in Path(r).rglob(n) if Path(r).exists() else []:
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size)


def font_family():
    for fam, files in (("Inter", "Inter-*"), ("Inter Display", "InterDisplay-*"), ("Poppins", "Poppins-*")):
        if any(Path("/usr/share/fonts").rglob(files)):
            return fam
    return "DejaVu Sans"


def backdrop(w=W, h=H):
    img = Image.new("RGB", (w, h), NAVY)
    glow = Image.new("RGB", (w, h), NAVY)
    d = ImageDraw.Draw(glow)
    d.ellipse((-w * 0.2, -h * 0.6, w * 0.7, h * 0.7), fill=NAVY2)
    d.ellipse((w * 0.6, h * 0.5, w * 1.3, h * 1.5), fill=(22, 34, 78))
    return Image.blend(img, glow.filter(ImageFilter.GaussianBlur(160)), 0.9)


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ""
    for wd in words:
        t = f"{cur} {wd}".strip()
        if draw.textlength(t, font=fnt) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def tag(img, xy, text, fnt, fill=(255, 255, 255, 34), color=INK):
    """Rounded label, blended onto an RGBA image (returns the new image)."""
    x, y = xy
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw = d.textlength(text, font=fnt)
    d.rounded_rectangle((x, y, x + tw + 36, y + fnt.size + 22), radius=(fnt.size + 22) // 2, fill=fill)
    out = Image.alpha_composite(img, layer)
    ImageDraw.Draw(out).text((x + 18, y + 9), text, font=fnt, fill=color)
    return out


# ---------------- screenshots ----------------

BOXES_JS = """() => {
  const out = [];
  const els = document.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,[class*=price i],[class*=card i],[class*=tier i],[class*=plan i],[class*=feature i],section,article');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 18) continue;
    const t = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 300);
    if (!t) continue;
    out.push({ tag: el.tagName, t, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
    if (out.length > 500) break;
  }
  return out;
}"""


def screenshot_pages(urls, outdir):
    """Returns {url: {"path": png, "boxes": [{t, x, y, w, h, tag}] in screenshot pixels}}."""
    from playwright.sync_api import sync_playwright
    shots = {}
    scale = CW / 1440
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=scale, locale="en-US",
                                  user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
        for i, url in enumerate(urls):
            pg = ctx.new_page()
            try:
                pg.goto(url, wait_until="domcontentloaded", timeout=30000)
                try:
                    pg.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
                for label in ["Accept all", "Accept All", "Accept", "I agree", "Agree", "Got it", "Allow all", "OK"]:
                    try:
                        pg.get_by_role("button", name=label, exact=True).first.click(timeout=700)
                        break
                    except Exception:
                        pass
                pg.add_style_tag(content="[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],#onetrust-banner-sdk,.cc-window{display:none!important}")
                pg.evaluate("""async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 7000); y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); }""")
                pg.wait_for_timeout(800)
                boxes = pg.evaluate(BOXES_JS)
                raw = outdir / f"raw{i}.png"
                pg.screenshot(path=str(raw), full_page=True, timeout=30000)
                im = Image.open(raw).convert("RGB")
                k = CW / im.width
                if im.width != CW:
                    im = im.resize((CW, int(im.height * k)))
                im = im.crop((0, 0, CW, min(im.height, 7000)))
                if im.height < CH:
                    pad = Image.new("RGB", (CW, CH), (255, 255, 255))
                    pad.paste(im, (0, 0))
                    im = pad
                shot = outdir / f"page{i}.png"
                im.save(shot)
                px = scale * k
                boxes = [{"t": b["t"], "tag": b["tag"], "x": b["x"] * px, "y": b["y"] * px, "w": b["w"] * px, "h": b["h"] * px}
                         for b in boxes if (b["y"] + b["h"]) * px < im.height]
                shots[url] = {"path": shot, "boxes": boxes, "h": im.height}
                log(f"screenshot ok: page {i + 1} ({im.height}px, {len(boxes)} parts)")
            except Exception as e:
                log(f"screenshot failed: page {i + 1}: {str(e)[:160]}")
            finally:
                pg.close()
        browser.close()
    return shots


# ---------------- voice ----------------

def voice(text, path, prev_text, next_text, dry=False):
    """Returns words [(word, start, end)] relative to the clip."""
    if dry:
        dur = max(2.0, len(text) / 15.0)
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", f"{dur:.2f}", "-c:a", "libmp3lame", str(path)])
        return even_words(text, dur)
    vid = os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE
    body = {"text": text, "model_id": os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
    if prev_text:
        body["previous_text"] = prev_text
    if next_text:
        body["next_text"] = next_text
    for attempt in range(3):
        r = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/{vid}/with-timestamps?output_format=mp3_44100_128",
                          headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]}, json=body, timeout=120)
        if r.status_code == 200:
            break
        if r.status_code in (429, 500, 502, 503) and attempt < 2:
            time.sleep(5 * (attempt + 1))
            continue
        raise RuntimeError(f"ElevenLabs said {r.status_code}: {r.text[:200]}")
    d = r.json()
    path.write_bytes(base64.b64decode(d["audio_base64"]))
    al = d.get("alignment") or {}
    words = words_from_alignment(al.get("characters") or [], al.get("character_start_times_seconds") or [], al.get("character_end_times_seconds") or [])
    return words or even_words(text, duration(path))


def words_from_alignment(chars, starts, ends):
    words, cur, s0, e0 = [], "", None, None
    for ch, s, e in zip(chars, starts, ends):
        if ch.isspace():
            if cur:
                words.append((cur, s0, e0))
            cur, s0 = "", None
            continue
        if s0 is None:
            s0 = s
        cur += ch
        e0 = e
    if cur:
        words.append((cur, s0, e0))
    return words


def even_words(text, dur):
    ws = text.split()
    total = sum(len(w) + 1 for w in ws) or 1
    t, out = 0.0, []
    for w in ws:
        d = dur * (len(w) + 1) / total
        out.append((w, t, t + d))
        t += d
    return out


# ---------------- captions ----------------

def caption_lines(words, max_chars=42):
    lines, cur = [], []
    for w in words:
        cur.append(w)
        text = " ".join(x[0] for x in cur)
        if len(text) >= max_chars or re.search(r"[.!?,;:]$", w[0]) and len(text) > 18:
            lines.append(cur)
            cur = []
    if cur:
        if lines and len(cur) <= 2 and len(" ".join(x[0] for x in lines[-1] + cur)) <= 56:
            lines[-1] += cur          # no lonely last word
        else:
            lines.append(cur)
    return [(" ".join(x[0] for x in ln), ln[0][1], ln[-1][2]) for ln in lines]


def ts(t, sep):
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    if sep == ",":
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)) % 1000:03d}"
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def ass_color(rgb):
    r, g, b = rgb
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def write_captions(lines, srt_path, ass_path):
    """lines: [(text, start, end, words)] on the final timeline. SRT for YouTube, ASS (word-by-word highlight) to burn in."""
    srt = []
    for i, (text, a, b, _) in enumerate(lines, 1):
        srt += [str(i), f"{ts(a, ',')} --> {ts(b + 0.05, ',')}", text, ""]
    srt_path.write_text("\n".join(srt), encoding="utf-8")
    fam = font_family()
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{fam},54,&H00FFFFFF,&H00FFFFFF,&H00301A0D,&H64000000,1,0,0,0,100,100,0,0,1,3,2,2,160,160,58,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    hi = ass_color(ACCENT)
    clean = lambda w: w.replace("{", "(").replace("}", ")")
    ev = []
    for text, a, b, words in lines:
        for k, (w, ws, we) in enumerate(words):
            t0 = a if k == 0 else ws
            t1 = words[k + 1][1] if k + 1 < len(words) else b + 0.05
            if t1 <= t0:
                continue
            body = " ".join((f"{{\\c{hi}}}{clean(x[0])}{{\\c&H00FFFFFF&}}" if j == k else clean(x[0])) for j, x in enumerate(words))
            pop = "{\\fad(70,0)\\fscx92\\fscy92\\t(0,140,\\fscx100\\fscy100)}" if k == 0 else ""
            ev.append(f"Dialogue: 0,{ts(t0, '.')},{ts(t1, '.')},Cap,,0,0,0,,{pop}{body}")
    ass_path.write_text(head + "\n".join(ev) + "\n", encoding="utf-8")


# ---------------- motion ----------------

ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"]
XF = 0.45                            # transition length (seconds)


def ease_io(x):
    x = min(max(x, 0.0), 1.0)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def ease_out(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


def ease_back(x):
    x = min(max(x, 0.0), 1.0)
    c1 = 1.70158
    return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2


def fade_alpha(img, k):
    """Multiply an RGBA image's transparency by k (0..1)."""
    if k >= 0.999:
        return img
    out = img.copy()
    out.putalpha(img.getchannel("A").point(lambda v: int(v * max(k, 0))))
    return out


class Encoder:
    """Pipe raw frames into ffmpeg together with the narration."""
    def __init__(self, out, audio, dur):
        self.dur, self.n = dur, int(round(dur * FPS))
        self.p = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                                   "-i", str(audio), "-filter_complex", "[1]apad[a]", "-map", "0:v", "-map", "[a]", "-t", f"{dur:.3f}", *ENC, str(out)],
                                  stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    def write(self, img):
        self.p.stdin.write(img.tobytes())

    def close(self):
        self.p.stdin.close()
        err = self.p.stderr.read().decode()[-800:]
        if self.p.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {err}")


def big_backdrop():
    return backdrop(W + 240, H + 140)


def drift(bg, t, dur):
    """Slow, continuous background movement."""
    k = t / max(dur, 1)
    x = int(120 + 110 * math.sin(k * math.pi * 0.9))
    y = int(70 + 60 * math.cos(k * math.pi * 0.7))
    return bg.crop((x, y, x + W, y + H))


def text_layer(text, fnt, color):
    d = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    w = int(d.textlength(text, font=fnt)) + 8
    img = Image.new("RGBA", (w, int(fnt.size * 1.35)), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((2, 0), text, font=fnt, fill=color)
    return img


def pill_layer(text, fnt, fill, color, dot=None):
    d = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    tw = int(d.textlength(text, font=fnt))
    pad = 22 + (22 if dot else 0)
    h = fnt.size + 24
    img = Image.new("RGBA", (tw + pad + 22, h), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    dd.rounded_rectangle((0, 0, img.width - 1, h - 1), radius=h // 2, fill=fill)
    if dot:
        dd.ellipse((20, h // 2 - 6, 32, h // 2 + 6), fill=dot)
    dd.text((pad, 10), text, font=fnt, fill=color)
    return img


def render_title(out, audio, dur, title, name, domain, sponsor, outro=False):
    """Animated title card: lines rise in one after another, an accent line wipes in, name follows."""
    bg = big_backdrop()
    sponsor_l = pill_layer(sponsor, font(30), (255, 255, 255, 34), INK)
    size = 92
    d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    while size > 54:
        big = font(size, True)
        lines = wrap(d, title, big, 1500)
        if len(lines) <= 4:
            break
        size -= 6
    line_l = [text_layer(ln, big, INK) for ln in lines]
    lh = int(size * 1.18)
    y0 = 500 - (len(lines) * lh) // 2
    name_l = text_layer(name, font(42, True), ACCENT)
    dom_l = pill_layer(domain, font(32), (110, 168, 255, 255), NAVY) if domain else None
    dom_plain = text_layer(domain, font(36), (170, 184, 225)) if domain and not outro else None
    enc = Encoder(out, audio, dur)
    for f in range(enc.n):
        t = f / FPS
        img = drift(bg, t, dur).convert("RGBA")
        k = ease_out(t / 0.4)
        img.alpha_composite(fade_alpha(sponsor_l, k), (150, int(120 + 12 * (1 - k))))
        for i, L in enumerate(line_l):
            k = ease_out((t - 0.15 - i * 0.12) / 0.6)
            if k > 0:
                img.alpha_composite(fade_alpha(L, k), (150, int(y0 + i * lh + 46 * (1 - k))))
        ybar = y0 + len(lines) * lh + 14
        kb = ease_io((t - 0.55) / 0.5)
        if kb > 0:
            ImageDraw.Draw(img).rounded_rectangle((150, ybar, 150 + int(180 * kb), ybar + 8), radius=4, fill=ACCENT)
        kn = ease_out((t - 0.75) / 0.5)
        if kn > 0:
            img.alpha_composite(fade_alpha(name_l, kn), (150 + int(-20 * (1 - kn)), ybar + 34))
            if dom_plain:
                img.alpha_composite(fade_alpha(dom_plain, kn), (150 + name_l.width + 20, ybar + 38))
        if outro and dom_l:
            kd = ease_back((t - 1.0) / 0.45)
            if kd > 0:
                s2 = max(0.01, 0.6 + 0.4 * kd)
                pl = dom_l.resize((max(1, int(dom_l.width * s2)), max(1, int(dom_l.height * s2))))
                img.alpha_composite(fade_alpha(pl, min(1, kd)), (150, ybar + 110 + (dom_l.height - pl.height) // 2))
        enc.write(img.convert("RGB"))
    enc.close()


def window_base(url, sponsor):
    """Background + browser window chrome (content area painted over per frame)."""
    img = backdrop().convert("RGBA")
    x0, y0, x1, y1 = WIN
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 16, x1, y1 + 16), radius=22, fill=(0, 0, 0, 130))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(26)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0, y0, x1, y1), radius=20, fill=(238, 241, 247, 255))
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse((x0 + 22 + i * 26, y0 + 16, x0 + 36 + i * 26, y0 + 30), fill=c)
    pill_x0, pill_x1 = x0 + 140, x1 - 140
    d.rounded_rectangle((pill_x0, y0 + 9, pill_x1, y0 + 37), radius=14, fill=(255, 255, 255, 255))
    shown = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
    d.text((pill_x0 + 18, y0 + 12), shown[:90], font=font(19), fill=(70, 78, 100))
    img = tag(img, (x0, 20), sponsor, font(24), fill=(10, 14, 34, 200))
    return img.convert("RGB")


_CONTENT_MASK = None


def content_mask():
    global _CONTENT_MASK
    if _CONTENT_MASK is None:
        m = Image.new("L", (CW, CH), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, -30, CW - 1, CH - 1), radius=20, fill=255)
        _CONTENT_MASK = m
    return _CONTENT_MASK


STOP = set("this that with your their they them have from what when will about into just more than also only each other which there these those then here very most some been being were does dont cant you're it's here's know should".split())


def keywords(text):
    return {w for w in re.findall(r"[a-z0-9$]+", text.lower()) if (len(w) > 3 or w.startswith("$")) and w not in STOP}


def pick_focus(boxes, say, chapter, used, page_h):
    """The part of the page that best matches what's being said, small enough to zoom into."""
    want = keywords(f"{say} {chapter} {chapter}")
    nums = set(re.findall(r"\d+", say))
    best, best_score = None, 0.0
    for b in boxes:
        if b["h"] > CH * 0.8 or b["w"] > CW * 0.8 or b["w"] < 160 or b["h"] < 30 or b["y"] + b["h"] > page_h:
            continue
        have = keywords(b["t"])
        score = len(want & have) + 1.5 * len(nums & set(re.findall(r"\d+", b["t"])))
        if b["tag"] in ("H1", "H2", "H3"):
            score += 0.5 if want & have else 0
        frac = (b["w"] * b["h"]) / (CW * CH)
        score *= (frac / 0.05) ** 0.5 if frac < 0.05 else (0.6 / frac if frac > 0.6 else 1.0)
        key = (round(b["x"]), round(b["y"]))
        if key in used:
            score *= 0.4
        if score > best_score:
            best, best_score = b, score
    return best if best_score >= 1.2 else None


def camera_plan(focus, style, dur, y_start, page_h):
    """Keyframes [(t, cx, cy, zoom)] in page pixels."""
    clamp_y = lambda cy, z: min(max(cy, CH / z / 2), page_h - CH / z / 2)
    if not focus:
        y_end = min(y_start + 38 * dur, max(0, page_h - CH))
        return [(0, CW / 2, y_start + CH / 2, 1.0), (0.5, CW / 2, y_start + CH / 2, 1.0), (dur, CW / 2, y_end + CH / 2, 1.04)]
    z = min(1.55, max(1.12, min(0.78 * CW / focus["w"], 0.78 * CH / focus["h"])))
    fx, fy = focus["x"] + focus["w"] / 2, focus["y"] + focus["h"] / 2
    fx = min(max(fx, CW / z / 2), CW - CW / z / 2)
    if style == "glide":
        cur = y_start + CH / 2
        start_y = clamp_y(cur if abs(fy - cur) < CH * 1.2 else fy, 1.0)
        settle = min(1.7, dur * 0.35)
        return [(0, CW / 2, start_y, 1.0), (0.25, CW / 2, start_y, 1.0), (settle, fx, clamp_y(fy, z), z), (dur, fx, clamp_y(fy, z * 1.06), z * 1.06)]
    return [(0, fx, clamp_y(fy, z * 0.94), z * 0.94), (dur, fx, clamp_y(fy, z * 1.05), z * 1.05)]


def camera_at(plan, t):
    if t <= plan[0][0]:
        return plan[0][1:]
    for (t0, x0, y0, z0), (t1, x1, y1, z1) in zip(plan, plan[1:]):
        if t <= t1:
            k = ease_io((t - t0) / max(t1 - t0, 1e-6))
            return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, z0 + (z1 - z0) * k
    return plan[-1][1:]


def render_page(out, audio, dur, page, base, focus, style, y_start, chapter):
    pimg = Image.open(page["path"]).convert("RGB")
    ph = pimg.height
    plan = camera_plan(focus, style, dur, y_start, ph)
    show_at = plan[2][0] if style == "glide" and focus else 0.45
    chip = pill_layer(chapter, font(24, True), (255, 255, 255, 30), INK, dot=ACCENT) if chapter else None
    mask = content_mask()
    enc = Encoder(out, audio, dur)
    for f in range(enc.n):
        t = f / FPS
        cx, cy, z = camera_at(plan, t)
        vw, vh = CW / z, CH / z
        left = min(max(cx - vw / 2, 0), CW - vw)
        top = min(max(cy - vh / 2, 0), max(ph - vh, 0))
        view = pimg.resize((CW, CH), Image.BILINEAR, box=(left, top, left + vw, top + vh))
        frame = base.copy()
        frame.paste(view, (CONTENT[0], CONTENT[1]), mask)
        if focus:
            k = (t - show_at) / 0.4
            if k > 0:
                s2 = 1 + 0.06 * (1 - ease_back(k))
                bx = (focus["x"] - left) * z + CONTENT[0]
                by = (focus["y"] - top) * z + CONTENT[1]
                bw, bh = focus["w"] * z, focus["h"] * z
                pad = 14
                x0, y0 = bx + bw / 2 - (bw / 2 + pad) * s2, by + bh / 2 - (bh / 2 + pad) * s2
                x1, y1 = bx + bw / 2 + (bw / 2 + pad) * s2, by + bh / 2 + (bh / 2 + pad) * s2
                x0, y0 = max(x0, CONTENT[0] + 4), max(y0, CONTENT[1] + 4)
                x1, y1 = min(x1, CONTENT[2] - 4), min(y1, CONTENT[3] - 4)
                if x1 - x0 > 20 and y1 - y0 > 20:
                    a = min(1.0, k)
                    region = (int(x0) - 4, int(y0) - 4, int(x1) + 5, int(y1) + 5)
                    crop = frame.crop(region).convert("RGBA")
                    ov = Image.new("RGBA", crop.size, (0, 0, 0, 0))
                    od = ImageDraw.Draw(ov)
                    od.rounded_rectangle((4, 4, crop.width - 5, crop.height - 5), radius=16, fill=ACCENT + (int(26 * a),), outline=ACCENT + (int(255 * a),), width=5)
                    frame.paste(Image.alpha_composite(crop, ov).convert("RGB"), region[:2])
        if chip:
            # chapter label above the window, top right: slides down in, stays for the whole shot
            k_in = ease_out((t - 0.15) / 0.45)
            if k_in > 0.01:
                cx0 = WIN[2] - chip.width
                region = (cx0, 6, WIN[2], 6 + chip.height + 20)
                bgc = frame.crop(region).convert("RGBA")
                bgc.alpha_composite(fade_alpha(chip, k_in), (0, int(10 - 14 * (1 - k_in)) + 4))
                frame.paste(bgc.convert("RGB"), region[:2])
        enc.write(frame)
    enc.close()
    return max(0, plan[-1][2] - CH / plan[-1][3] / 2)   # where this shot ended (top of view), for the next shot


TRANSITIONS = ["smoothleft", "slideup", "smoothright", "circleopen", "smoothup", "fadeblack"]


def join_parts(parts, durs, ass, final, music=None):
    """Smooth transitions between every shot, captions burned in, loudness evened out."""
    n = len(parts)
    inputs = sum([["-i", str(p)] for p in parts], [])
    fc, v, a = [], "[0:v]", "[0:a]"
    off, kinds = 0.0, []
    for i in range(1, n):
        off += durs[i - 1] - XF
        kind = "fade" if i == 1 or i == n - 1 else TRANSITIONS[(i - 2) % len(TRANSITIONS)]
        kinds.append(kind)
        fc.append(f"{v}[{i}:v]xfade=transition={kind}:duration={XF}:offset={off:.3f}[v{i}]")
        fc.append(f"{a}[{i}:a]acrossfade=d={XF}:c1=tri:c2=tri[a{i}]")
        v, a = f"[v{i}]", f"[a{i}]"
    total = sum(durs) - XF * (n - 1)
    ass_arg = str(ass).replace("\\", "/").replace(":", "\\:")
    fc.append(f"{v}subtitles='{ass_arg}',fade=t=in:st=0:d=0.5,fade=t=out:st={max(total - 0.8, 0):.2f}:d=0.8[vout]")
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]
        fc.append(f"{a}loudnorm=I=-16:TP=-1.5:LRA=11,asplit=2[voice][key]")
        fc.append(f"[{n}:a]volume=0.22,afade=t=in:d=1.5,afade=t=out:st={max(total - 2, 0):.2f}:d=2[bgm]")
        fc.append("[bgm][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=500[ducked]")
        fc.append("[voice][ducked]amix=inputs=2:normalize=0:duration=first[aout]")
    else:
        fc.append(f"{a}loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final)])
    return total


def chapters(starts, total):
    out = []
    for name, t in starts:
        if out and (out[-1][0] == name or t - out[-1][1] < 10):
            continue
        out.append((name, t))
    if out and total - out[-1][1] < 10:
        out.pop()
    if len(out) < 3:
        return ""
    fmt = lambda t: f"{int(t // 60)}:{int(t % 60):02d}"
    return "Chapters\n" + "\n".join(f"{fmt(0 if i == 0 else t)} {name}" for i, (name, t) in enumerate(out))


def thumbnail(path, title, name, home_shot):
    img = backdrop(1280, 720).convert("RGBA")
    if home_shot:
        shot = Image.open(home_shot).convert("RGB").crop((0, 0, CW, int(CW * 0.62)))
        shot = shot.resize((620, int(620 * shot.height / shot.width)))
        mask = Image.new("L", shot.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), radius=18, fill=255)
        img.paste(shot, (620, 150), mask)
    d = ImageDraw.Draw(img)
    size = 66
    while size > 40:
        f = font(size, True)
        lines = wrap(d, title, f, 520 if home_shot else 1100)
        if len(lines) <= 5:
            break
        size -= 4
    y = 360 - len(lines) * int(size * 1.15) // 2
    for ln in lines:
        d.text((60, y), ln, font=f, fill=INK)
        y += int(size * 1.15)
    img = tag(img, (60, 70), name, font(30, True), fill=(110, 168, 255, 255), color=NAVY)
    img.convert("RGB").save(path, quality=90)


# ---------------- YouTube ----------------

def clean_text(s, limit):
    return re.sub(r"[<>]", "", s).strip()[:limit]


def yt_upload(token, mp4, script, description):
    meta = {"snippet": {"title": clean_text(script["title"], 100), "description": clean_text(description, 4900), "tags": script.get("tags", []),
                        "categoryId": "28", "defaultLanguage": "en", "defaultAudioLanguage": "en"},
            "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False, "embeddable": True, "license": "youtube"},
            "paidProductPlacementDetails": {"hasPaidProductPlacement": True}}
    hdr = {"Authorization": f"Bearer {token}"}
    for parts in ("snippet,status,paidProductPlacementDetails", "snippet,status"):
        body = dict(meta) if "paid" in parts else {k: v for k, v in meta.items() if k != "paidProductPlacementDetails"}
        r = requests.post(f"https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part={parts}",
                          headers={**hdr, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4",
                                   "X-Upload-Content-Length": str(mp4.stat().st_size)}, data=json.dumps(body), timeout=60)
        if r.status_code == 200:
            break
        if "paid" not in parts or r.status_code != 400:
            raise RuntimeError(f"YouTube upload start failed {r.status_code}: {r.text[:300]}")
        log("YouTube didn't accept the paid-promotion field; set it in Studio. Retrying without it.")
    with open(mp4, "rb") as fh:
        up = requests.put(r.headers["Location"], headers={**hdr, "Content-Type": "video/mp4"}, data=fh, timeout=1800)
    if up.status_code not in (200, 201):
        raise RuntimeError(f"YouTube upload failed {up.status_code}: {up.text[:300]}")
    return up.json()["id"], "paid" in parts


def yt_captions(token, video_id, srt):
    b = "vantrycaptions"
    meta = json.dumps({"snippet": {"videoId": video_id, "language": "en", "name": "English", "isDraft": False}})
    body = (f"--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{b}\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + srt.read_bytes() + f"\r\n--{b}--\r\n".encode()
    r = requests.post("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet",
                      headers={"Authorization": f"Bearer {token}", "Content-Type": f"multipart/related; boundary={b}"}, data=body, timeout=120)
    log("captions uploaded" if r.ok else f"captions not uploaded ({r.status_code})")


def yt_thumbnail(token, video_id, jpg):
    r = requests.post(f"https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={video_id}&uploadType=media",
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "image/jpeg"}, data=jpg.read_bytes(), timeout=120)
    log("thumbnail set" if r.ok else f"thumbnail not set ({r.status_code}; custom thumbnails need a phone-verified channel)")


# ---------------- main ----------------

def find_music():
    m = os.environ.get("VIDEO_MUSIC")
    if m and Path(m).exists():
        return Path(m)
    tracks = sorted((Path(__file__).parent / "music").glob("*.mp3"))
    return tracks[int(time.time()) % len(tracks)] if tracks else None


def render(job, out, dry=False):
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    work.mkdir(exist_ok=True)
    script, co = job["script"], job["company"]
    name = co["name"]
    domain = re.sub(r"^https?://(www\.)?", "", co.get("website", "")).rstrip("/")
    sponsor = f"Paid promotion · {name}"
    segs = script["segments"]

    urls = list(dict.fromkeys([s["page"] for s in segs if s.get("page")] + job.get("pages", [])[:1]))
    shots = screenshot_pages(urls, work) if urls else {}
    home = shots.get(job["pages"][0]) if job.get("pages") else None
    home = home or next(iter(shots.values()), None)
    if not home:
        raise RuntimeError(f"Couldn't load {name}'s website to show it on screen.")

    parts, durs, seg_words, bases, used, scroll = [], [], [], {}, {}, {}
    page_n = 0
    for i, s in enumerate(segs):
        audio = work / f"a{i}.mp3"
        words = voice(s["say"], audio, segs[i - 1]["say"] if i else "", segs[i + 1]["say"] if i + 1 < len(segs) else "", dry)
        dur = duration(audio) + 0.25 + (XF if i + 1 < len(segs) else 0.6)
        clip = work / f"p{i}.mp4"
        if s.get("visual") == "title" or not s.get("page"):
            last = i == len(segs) - 1
            render_title(clip, audio, dur, f"Learn more about {name}" if last else script.get("question") or script["title"], name, domain, sponsor, outro=last)
        else:
            url = s["page"] if s["page"] in shots else next(iter(shots))
            page = shots[url]
            if url not in bases:
                bases[url] = window_base(url, sponsor)
            focus = pick_focus(page["boxes"], s["say"], s.get("chapter", ""), used.setdefault(url, set()), page["h"])
            if focus:
                used[url].add((round(focus["x"]), round(focus["y"])))
            style = "glide" if page_n % 2 == 0 else "punch"
            prev_chapter = segs[i - 1].get("chapter") if i else None
            chapter = s.get("chapter") if s.get("chapter") and s.get("chapter") != prev_chapter else None
            y_start = scroll.get(url, 0)
            if y_start >= page["h"] - CH - 20:
                y_start = 0
            scroll[url] = render_page(clip, audio, dur, page, bases[url], focus, style, y_start, chapter)
            page_n += 1
            log(f"  shot: {'zoom to ' + focus['t'][:40] + '...' if focus else 'scroll'} ({style if focus else 'pan'})")
        parts.append(clip)
        durs.append(duration(clip))
        seg_words.append(words)
        log(f"part {i + 1}/{len(segs)} done ({dur:.1f}s)")

    # Timeline with transitions: part i starts at sum(previous) - i * XF.
    starts, lines, t = [], [], 0.0
    for i, s in enumerate(segs):
        starts.append((s.get("chapter") or f"Part {i + 1}", t))
        for txt, a, b in caption_lines(seg_words[i]):
            ws = [(w, x + t, y + t) for w, x, y in seg_words[i] if x >= a - 1e-6 and y <= b + 1e-6]
            lines.append((txt, a + t, b + t, ws or [(txt, a + t, b + t)]))
        t += durs[i] - XF
    srt, ass = out / "captions.srt", work / "captions.ass"
    write_captions(lines, srt, ass)
    final = out / "video.mp4"
    music = find_music()
    total = join_parts(parts, durs, ass, final, music)
    thumb = out / "thumbnail.jpg"
    thumbnail(thumb, script.get("question") or script["title"], name, home["path"])
    chap = chapters(starts, total)
    description = script["description"] + (f"\n\n{chap}" if chap else "")
    (out / "youtube.txt").write_text(f"TITLE\n{clean_text(script['title'], 100)}\n\nDESCRIPTION\n{clean_text(description, 4900)}\n\nTAGS\n{', '.join(script.get('tags', []))}\n\nMark it as a paid promotion: Details > Show more > Paid promotion.\n", encoding="utf-8")
    log(f"video ready: {total:.0f}s{' with music' if music else ''}")
    return final, srt, thumb, description, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id")
    ap.add_argument("--job")
    ap.add_argument("--out", default="out")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    if a.job:
        job = json.loads(Path(a.job).read_text())
        render(job, out, dry=a.dry)
        return
    if not re.fullmatch(r"v[a-z0-9]{11}", a.id or ""):
        sys.exit("bad video id")
    api = os.environ.get("VIDEO_API", "https://api.vantryai.com").rstrip("/")
    if not re.fullmatch(r"https://[a-z0-9.-]+", api) or api.split("//")[1] not in ALLOWED_API_HOSTS:
        sys.exit("VIDEO_API host not allowed")
    hdr = {"X-Video-Secret": os.environ["VIDEO_SECRET"]}
    report = {"id": a.id}
    gh = os.environ.get("GITHUB_RUN_ID")
    if gh:
        report["runUrl"] = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{gh}"
    try:
        r = requests.get(f"{api}/api/video/job/{a.id}", headers=hdr, timeout=60)
        r.raise_for_status()
        job = r.json()
        token = (job.get("youtube") or {}).get("accessToken")
        if token:
            print(f"::add-mask::{token}", flush=True)
        if job.get("voice"):
            os.environ["ELEVENLABS_VOICE_ID"] = job["voice"]
        final, srt, thumb, description, total = render(job, out)
        report["durationSec"] = round(total)
        if token:
            try:
                vid, paid = yt_upload(token, final, job["script"], description)
                report["youtubeId"] = vid
                if not paid:
                    report["uploadError"] = "Uploaded, but mark it as a paid promotion in YouTube Studio."
                log("uploaded to YouTube (private)")
                yt_captions(token, vid, srt)
                yt_thumbnail(token, vid, thumb)
            except Exception as e:
                report["uploadError"] = str(e)[:300]
                log(f"YouTube upload failed: {str(e)[:300]}")
        else:
            report["uploadError"] = "No YouTube channel connected."
    except Exception as e:
        report["error"] = str(e)[:500]
        log(f"FAILED: {str(e)[:500]}")
    requests.post(f"{api}/api/video/done", headers=hdr, json=report, timeout=60)
    if report.get("error"):
        sys.exit(1)


if __name__ == "__main__":
    main()
