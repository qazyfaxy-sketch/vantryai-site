"""The vertical "Shorts" cut: 1080x1920, a hook in the first 2 seconds, one idea, a new shot every ~2.4 seconds,
big word-by-word captions, the real page on screen, the paid-promotion label on screen the whole time, and an
ending that returns to the hook so it loops. Called from render.py when script["format"] == "short".

    python video/render.py --job job.json --out out --dry     # silent local check
"""
import re
from pathlib import Path

from PIL import Image, ImageDraw

import render as R

SW, SH, FPS = 1080, 1920, R.FPS
CARD = (60, 190, 1020, 1070)                 # the page window: 960 x 880
CARD_W, CARD_H = CARD[2] - CARD[0], CARD[3] - CARD[1]
SHOT = 2.4                                   # seconds before the picture changes again
MAX_TOTAL = 58.0


class Enc:
    def __init__(self, out, audio, dur):
        self.n = int(round(dur * FPS))
        self.p = R.subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{SW}x{SH}", "-r", str(FPS), "-i", "-",
                                     "-i", str(audio), "-filter_complex", "[1]apad[a]", "-map", "0:v", "-map", "[a]", "-t", f"{dur:.3f}", *R.ENC, str(out)],
                                    stdin=R.subprocess.PIPE, stderr=R.subprocess.PIPE)

    def write(self, img):
        self.p.stdin.write(img.tobytes())

    def close(self):
        self.p.stdin.close()
        err = self.p.stderr.read().decode()[-800:]
        if self.p.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {err}")


def card_mask():
    m = Image.new("L", (CARD_W, CARD_H), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, CARD_W - 1, CARD_H - 1), radius=36, fill=255)
    return m


def crop_for(pimg, cx, cy, wcrop):
    """A CARD-shaped crop of the page centred near (cx, cy), never outside the page."""
    pw, ph = pimg.size
    wcrop = min(wcrop, pw, ph * CARD_W / CARD_H)
    hcrop = wcrop * CARD_H / CARD_W
    x0 = min(max(cx - wcrop / 2, 0), pw - wcrop)
    y0 = min(max(cy - hcrop / 2, 0), ph - hcrop)
    return pimg.crop((int(x0), int(y0), int(x0 + wcrop), int(y0 + hcrop))).resize((CARD_W, CARD_H), Image.BICUBIC)


def shot_cam(page, focus, k, p, y_start):
    """Camera for shot k (0,1,2...) at progress p (0..1) -> (cx, cy, wcrop). Different framing each shot so it never sits still."""
    cw, ph = page["w"], page["h"]
    if focus:
        fx, fy = focus["x"] + focus["w"] / 2, focus["y"] + focus["h"] / 2
        tight = max(430, min(820, focus["w"] * 1.15))
        if focus["w"] > tight * 0.9:
            fx = focus["x"] + tight / 2 - 30        # a wide block: start at its left edge so the words begin on screen
        if k % 2 == 0:
            return fx, fy, tight * (1.0 - 0.10 * R.ease_out(p))          # push in on the part being talked about
        return fx, min(fy + 120, ph), min(cw, tight * 1.3) * (1.0 - 0.06 * p)  # wider, a little lower
    top = y_start + 260 * k + 90 * p
    return cw / 2, min(top + 300, ph), 720 - 30 * p


def headline_layer(text, size):
    d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    f = R.font(size, True)
    lines = R.wrap(d, text, f, 920)
    while len(lines) > 3 and size > 54:
        size -= 6
        f = R.font(size, True)
        lines = R.wrap(d, text, f, 920)
    lh = int(size * 1.16)
    img = Image.new("RGBA", (960, lh * len(lines) + 24), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    for i, ln in enumerate(lines):
        w = dd.textlength(ln, font=f)
        x = (960 - w) / 2
        dd.text((x + 3, i * lh + 5), ln, font=f, fill=(0, 0, 0, 110))      # soft shadow
        dd.text((x, i * lh), ln, font=f, fill=R.INK)
    return img


def render_beat(out, audio, dur, page, focus, text, name, domain, sponsor, t_off, total, hook=False, outro=False, y_start=0):
    bg = R.backdrop(SW + 200, SH + 200)
    pimg = Image.open(page["path"]).convert("RGB") if page else None
    pmeta = {"w": pimg.width, "h": pimg.height} if pimg else None
    mask = card_mask()
    head = headline_layer(text, 104 if hook else 88)
    pill = R.pill_layer(sponsor, R.font(34), (255, 255, 255, 46), R.INK)
    dom_l = R.pill_layer(domain, R.font(40), (110, 168, 255, 255), R.NAVY) if (outro and domain) else None
    enc = Enc(out, audio, dur)
    shots = max(1, int(dur // SHOT))
    for f in range(enc.n):
        t = f / FPS
        k = min(int(t // SHOT), shots - 1)
        p = (t - k * SHOT) / (SHOT if k < shots - 1 else max(dur - k * SHOT, 0.5))
        gx, gy = int(100 + 70 * R.math.sin(t / 3)), int(100 + 60 * R.math.cos(t / 4))
        img = bg.crop((gx, gy, gx + SW, gy + SH)).convert("RGBA")
        pop = 1.0 + 0.035 * max(0.0, 1 - (t - k * SHOT) / 0.14)       # a quick punch on every new shot
        if pimg is not None:
            cx, cy, wc = shot_cam(pmeta, focus, k, p, y_start)
            card = crop_for(pimg, cx, cy, wc).convert("RGBA")
            card.putalpha(mask)
            if pop > 1.001:
                sc = card.resize((int(CARD_W * pop), int(CARD_H * pop)), Image.BICUBIC)
                img.alpha_composite(sc, (CARD[0] - (sc.width - CARD_W) // 2, CARD[1] - (sc.height - CARD_H) // 2))
            else:
                img.alpha_composite(card, (CARD[0], CARD[1]))
            ImageDraw.Draw(img).rounded_rectangle(CARD, radius=36, outline=(255, 255, 255, 70), width=3)
        else:
            ImageDraw.Draw(img).rounded_rectangle(CARD, radius=36, fill=(255, 255, 255, 22), outline=(255, 255, 255, 70), width=3)
            big = R.text_layer(name, R.font(120, True), R.ACCENT)
            img.alpha_composite(big, (CARD[0] + max(20, (CARD_W - big.width) // 2), CARD[1] + CARD_H // 2 - 80))
        ka = R.ease_back(t / 0.28)
        h2 = head if ka >= 0.999 else head.resize((max(1, int(head.width * (0.9 + 0.1 * ka))), max(1, int(head.height * (0.9 + 0.1 * ka)))))
        img.alpha_composite(R.fade_alpha(h2, min(1, t / 0.18)), (60 + (960 - h2.width) // 2, 1110 + int(26 * (1 - min(1, ka)))))
        if dom_l:
            img.alpha_composite(dom_l, ((SW - dom_l.width) // 2, CARD[1] + CARD_H // 2 + 70))
        img.alpha_composite(pill, (60, 88))
        ImageDraw.Draw(img).rectangle((0, 0, int(SW * min(1, (t_off + t) / max(total, 1))), 9), fill=R.ACCENT)   # progress bar
        enc.write(img.convert("RGB"))
    enc.close()


def write_captions(lines, srt_path, ass_path):
    srt = []
    for i, (text, a, b, _) in enumerate(lines, 1):
        srt += [str(i), f"{R.ts(a, ',')} --> {R.ts(b + 0.05, ',')}", text, ""]
    srt_path.write_text("\n".join(srt), encoding="utf-8")
    fam = R.font_family()
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {SW}
PlayResY: {SH}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{fam},78,&H00FFFFFF,&H00FFFFFF,&H00301A0D,&H64000000,1,0,0,0,100,100,0,0,1,6,2,2,90,90,330,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    hi = R.ass_color(R.ACCENT)
    clean = lambda w: w.replace("{", "(").replace("}", ")")
    ev = []
    for text, a, b, words in lines:
        for k, (w, ws, we) in enumerate(words):
            t0 = a if k == 0 else ws
            t1 = words[k + 1][1] if k + 1 < len(words) else b + 0.05
            if t1 <= t0:
                continue
            body = " ".join((f"{{\\c{hi}}}{clean(x[0])}{{\\c&H00FFFFFF&}}" if j == k else clean(x[0])) for j, x in enumerate(words))
            ev.append(f"Dialogue: 0,{R.ts(t0, '.')},{R.ts(t1, '.')},Cap,,0,0,0,,{body}")
    ass_path.write_text(head + "\n".join(ev) + "\n", encoding="utf-8")


def join_short(parts, ass, final, total, music=None):
    n = len(parts)
    inputs = sum([["-i", str(p)] for p in parts], [])
    cat = "".join(f"[{i}:v][{i}:a]" for i in range(n)) + f"concat=n={n}:v=1:a=1[cv][ca]"
    ass_arg = str(ass).replace("\\", "/").replace(":", "\\:")
    fc = [cat, f"[cv]subtitles='{ass_arg}',fade=t=in:st=0:d=0.15[vout]"]
    if music:
        inputs += ["-stream_loop", "-1", "-i", str(music)]
        fc.append("[ca]loudnorm=I=-14:TP=-1.5:LRA=11,asplit=2[voice][key]")
        fc.append(f"[{n}:a]volume=0.2,afade=t=in:d=0.8[bgm]")
        fc.append("[bgm][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=500[ducked]")
        fc.append("[voice][ducked]amix=inputs=2:normalize=0:duration=first[aout]")
    else:
        fc.append("[ca]loudnorm=I=-14:TP=-1.5:LRA=11[aout]")
    R.run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]", "-t", f"{total:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final)])


def render_short(job, out, dry=False):
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    work.mkdir(exist_ok=True)
    script, co = job["script"], job["company"]
    name = co["name"]
    domain = re.sub(r"^https?://(www\.)?", "", co.get("website", "")).rstrip("/")
    sponsor = f"Paid promotion · {name}"
    segs = script["segments"]
    urls = list(dict.fromkeys([s["page"] for s in segs if s.get("page")] + job.get("pages", [])[:1]))
    shots = R.screenshot_pages(urls, work) if urls else {}
    if not shots:
        raise RuntimeError(f"Couldn't load {name}'s website to show it on screen.")

    # 1. voice every beat first, so we know the timeline (and the total length)
    auds, words, durs = [], [], []
    for i, s in enumerate(segs):
        a = work / f"a{i}.mp3"
        w = R.voice(s["say"], a, segs[i - 1]["say"] if i else "", segs[i + 1]["say"] if i + 1 < len(segs) else "", dry)
        auds.append(a)
        words.append(w)
        durs.append(R.duration(a) + (0.5 if i + 1 == len(segs) else 0.14))
    total = sum(durs)
    if total > MAX_TOTAL:
        raise RuntimeError(f"The short came out {total:.0f}s long (the limit is {MAX_TOTAL:.0f}s). Shorten the script.")

    # 2. one picture per beat (a new camera framing every ~2.4s inside it)
    used, parts, t = {}, [], 0.0
    hook_text = segs[0].get("text") or script.get("question") or script["title"]
    for i, s in enumerate(segs):
        last = i + 1 == len(segs)
        url = s.get("page") if s.get("page") in shots else next(iter(shots))
        page = shots[url] if not (last or s.get("visual") == "title") else None
        focus = None
        if page:
            focus = R.pick_focus(page["boxes"], s["say"], s.get("chapter", ""), used.setdefault(url, set()), page["h"])
            if focus:
                used[url].add((round(focus["x"]), round(focus["y"])))
        text = hook_text if last else (s.get("text") or s.get("chapter") or "")
        clip = work / f"p{i}.mp4"
        render_beat(clip, auds[i], durs[i], page, focus, text, name, domain, sponsor, t, total, hook=i == 0, outro=last, y_start=min(200 * i, 1200))
        parts.append(clip)
        R.log(f"beat {i + 1}/{len(segs)} done ({durs[i]:.1f}s){' zoom: ' + focus['t'][:36] if focus else ''}")
        t += durs[i]

    # 3. captions on the final timeline, then join
    lines, t = [], 0.0
    for i in range(len(segs)):
        for txt, a, b in R.caption_lines(words[i], max_chars=22):
            ws = [(w, x + t, y + t) for w, x, y in words[i] if x >= a - 1e-6 and y <= b + 1e-6]
            lines.append((txt, a + t, b + t, ws or [(txt, a + t, b + t)]))
        t += durs[i]
    srt, ass = out / "captions.srt", work / "captions.ass"
    write_captions(lines, srt, ass)
    final = out / "video.mp4"
    join_short(parts, ass, final, total, R.find_music())
    thumb = out / "thumbnail.jpg"
    description = script["description"]
    (out / "youtube.txt").write_text(f"TITLE\n{R.clean_text(script['title'], 100)}\n\nDESCRIPTION\n{R.clean_text(description, 4900)}\n\nTAGS\n{', '.join(script.get('tags', []))}\n\nMark it as a paid promotion: Details > Show more > Paid promotion.\n", encoding="utf-8")
    R.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "1.2", "-i", str(final), "-frames:v", "1", "-q:v", "3", str(thumb)])
    R.log(f"short ready: {total:.0f}s")
    return final, srt, thumb, description, total
