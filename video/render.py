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
SCROLL_SPEED = 38                   # px per second of narration
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


def title_card(path, title, name, domain, sponsor_line):
    img = tag(backdrop().convert("RGBA"), (150, 120), sponsor_line, font(30))
    d = ImageDraw.Draw(img)
    size = 92
    while size > 54:
        big = font(size, True)
        lines = wrap(d, title, big, 1500)
        if len(lines) <= 4:
            break
        size -= 6
    y = 500 - (len(lines) * int(size * 1.18)) // 2
    for ln in lines:
        d.text((150, y), ln, font=big, fill=INK)
        y += int(size * 1.18)
    mid = font(40, True)
    d.text((150, y + 36), name, font=mid, fill=ACCENT)
    if domain:
        d.text((150 + d.textlength(name, font=mid) + 24, y + 40), domain, font=font(36), fill=(170, 184, 225))
    img.convert("RGB").save(path)


def window_frame(path, url, sponsor_line):
    """Full-screen PNG with a transparent hole where the page shows through."""
    img = backdrop().convert("RGBA")
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = WIN
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 14, x1, y1 + 14), radius=22, fill=(0, 0, 0, 120))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(24)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0, y0, x1, y1), radius=20, fill=(238, 241, 247, 255))
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        d.ellipse((x0 + 22 + i * 26, y0 + 16, x0 + 36 + i * 26, y0 + 30), fill=c)
    pill_x0, pill_x1 = x0 + 140, x1 - 140
    d.rounded_rectangle((pill_x0, y0 + 9, pill_x1, y0 + 37), radius=14, fill=(255, 255, 255, 255))
    shown = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
    d.text((pill_x0 + 18, y0 + 12), shown[:90], font=font(19), fill=(70, 78, 100))
    # cut the content hole, keeping rounded bottom corners
    hole = Image.new("L", (W, H), 0)
    ImageDraw.Draw(hole).rounded_rectangle((CONTENT[0], CONTENT[1], CONTENT[2], CONTENT[3]), radius=20, fill=255)
    ImageDraw.Draw(hole).rectangle((CONTENT[0], CONTENT[1], CONTENT[2], CONTENT[1] + 30), fill=255)
    alpha = img.getchannel("A").point(lambda a: a)
    alpha.paste(0, mask=hole)
    img.putalpha(alpha)
    tag(img, (x0, 20), sponsor_line, font(24), fill=(10, 14, 34, 200)).save(path)


# ---------------- screenshots ----------------

def screenshot_pages(urls, outdir):
    from playwright.sync_api import sync_playwright
    shots = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=CW / 1440, locale="en-US",
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
                raw = outdir / f"raw{i}.png"
                pg.screenshot(path=str(raw), full_page=True, timeout=30000)
                im = Image.open(raw).convert("RGB")
                if im.width != CW:
                    im = im.resize((CW, int(im.height * CW / im.width)))
                im = im.crop((0, 0, CW, min(im.height, 7000)))
                if im.height < CH:
                    pad = Image.new("RGB", (CW, CH), (255, 255, 255))
                    pad.paste(im, (0, 0))
                    im = pad
                shot = outdir / f"page{i}.png"
                im.save(shot)
                shots[url] = shot
                log(f"screenshot ok: page {i + 1} ({im.height}px)")
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
        lines.append(cur)
    return [(" ".join(x[0] for x in ln), ln[0][1], ln[-1][2]) for ln in lines]


def ts(t, sep):
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    if sep == ",":
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s % 1) * 1000)) % 1000:03d}"
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def write_captions(lines, srt_path, ass_path):
    srt = []
    for i, (text, a, b) in enumerate(lines, 1):
        srt += [str(i), f"{ts(a, ',')} --> {ts(b + 0.05, ',')}", text, ""]
    srt_path.write_text("\n".join(srt), encoding="utf-8")
    fam = font_family()
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{fam},52,&H00FFFFFF,&H00FFFFFF,&H00301A0D,&H80000000,1,0,0,0,100,100,0,0,1,3,0,2,160,160,62,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = [f"Dialogue: 0,{ts(a, '.')},{ts(b + 0.05, '.')},Cap,,0,0,0,,{text.replace('{', '(').replace('}', ')')}" for text, a, b in lines]
    ass_path.write_text(head + "\n".join(ev) + "\n", encoding="utf-8")


# ---------------- building parts ----------------

ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"]


def part_title(png, audio, dur, out):
    run(["ffmpeg", "-y", "-loop", "1", "-framerate", str(FPS), "-i", str(png), "-i", str(audio),
         "-filter_complex", f"[0]scale={W}:{H},zoompan=z='1+0.0004*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}[v];[1]apad[a]",
         "-map", "[v]", "-map", "[a]", "-t", f"{dur:.3f}", *ENC, str(out)])


def part_page(shot, frame, audio, dur, y0, y1, out):
    move = f"{y0}+({y1}-{y0})*(0.5-0.5*cos(PI*min(max(t-0.6,0)/{max(dur - 1.2, 0.5):.3f},1)))"
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:r={FPS}", "-loop", "1", "-framerate", str(FPS), "-i", str(shot),
         "-loop", "1", "-framerate", str(FPS), "-i", str(frame), "-i", str(audio),
         "-filter_complex", f"[1]crop={CW}:{CH}:0:'{move}'[pg];[0][pg]overlay={CONTENT[0]}:{CONTENT[1]}[b];[b][2]overlay=0:0[v];[3]apad[a]",
         "-map", "[v]", "-map", "[a]", "-t", f"{dur:.3f}", *ENC, str(out)])


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

    parts, lines, starts, t = [], [], [], 0.0
    offsets, frames = {}, {}
    for i, s in enumerate(segs):
        audio = work / f"a{i}.mp3"
        prev_text = segs[i - 1]["say"] if i else ""
        next_text = segs[i + 1]["say"] if i + 1 < len(segs) else ""
        words = voice(s["say"], audio, prev_text, next_text, dry)
        dur = duration(audio) + 0.45
        clip = work / f"p{i}.mp4"
        if s.get("visual") == "title" or not s.get("page"):
            png = work / f"t{i}.png"
            last = i == len(segs) - 1
            title_card(png, f"Learn more about {name}" if last else script.get("question") or script["title"], name, domain, sponsor)
            part_title(png, audio, dur, clip)
        else:
            url = s["page"] if s["page"] in shots else next(iter(shots))
            shot = shots[url]
            if url not in frames:
                frames[url] = work / f"f{len(frames)}.png"
                window_frame(frames[url], url, sponsor)
            hpx = Image.open(shot).height
            y0 = offsets.get(url, 0)
            y1 = min(y0 + int(SCROLL_SPEED * dur), max(0, hpx - CH))
            if y0 >= max(0, hpx - CH) - 20:     # reached the bottom before: start over from the top
                y0, y1 = 0, min(int(SCROLL_SPEED * dur), max(0, hpx - CH))
            offsets[url] = y1
            part_page(shot, frames[url], audio, dur, y0, y1, clip)
        starts.append((s.get("chapter") or f"Part {i + 1}", t))
        lines += [(txt, a + t, b + t) for txt, a, b in caption_lines(words)]
        parts.append(clip)
        t += duration(clip)
        log(f"part {i + 1}/{len(segs)} done ({dur:.1f}s)")

    lst = work / "list.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    joined = work / "joined.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)])
    srt, ass = out / "captions.srt", work / "captions.ass"
    write_captions(lines, srt, ass)
    total = duration(joined)
    final = out / "video.mp4"
    ass_arg = str(ass).replace("\\", "/").replace(":", "\\:")
    run(["ffmpeg", "-y", "-i", str(joined), "-vf", f"subtitles='{ass_arg}',fade=t=in:st=0:d=0.5,fade=t=out:st={max(total - 0.8, 0):.2f}:d=0.8",
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(final)])
    thumb = out / "thumbnail.jpg"
    thumbnail(thumb, script.get("question") or script["title"], name, home)
    chap = chapters(starts, total)
    description = script["description"] + (f"\n\n{chap}" if chap else "")
    (out / "youtube.txt").write_text(f"TITLE\n{clean_text(script['title'], 100)}\n\nDESCRIPTION\n{clean_text(description, 4900)}\n\nTAGS\n{', '.join(script.get('tags', []))}\n\nMark it as a paid promotion: Details > Show more > Paid promotion.\n", encoding="utf-8")
    log(f"video ready: {total:.0f}s")
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
