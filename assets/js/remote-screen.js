/**
 * remote-screen.js
 * Paints a simulated remote desktop onto a canvas.
 *
 * Nothing here touches the network. The scene is procedurally drawn in a fixed
 * 1600x900 logical space and letterboxed into whatever size the stage gives us.
 */

const W = 1600;
const H = 900;

const QUALITY = {
  speed:    { scale: 0.55, resolution: '1280×720',  label: 'Speed' },
  balanced: { scale: 1.00, resolution: '1600×900',  label: 'Balanced' },
  quality:  { scale: 1.35, resolution: '1920×1080', label: 'Quality' },
};

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const TERMINAL_LINES = [
  { t: 0.0,  text: '$ ./build.sh --target begonia --release', color: '#8bd5a8' },
  { t: 0.9,  text: '  resolving toolchain ........ ok', color: '#6f7b90' },
  { t: 1.4,  text: '  compiling kernel ............ 812/812', color: '#6f7b90' },
  { t: 2.1,  text: '  packaging boot image ....... ok', color: '#6f7b90' },
  { t: 2.6,  text: '✓ build finished in 04:12', color: '#5fd6a0' },
  { t: 3.3,  text: '$ scp out/boot.img desk:/tmp/', color: '#8bd5a8' },
  { t: 4.1,  text: '  boot.img   64%  ██████████░░░░  24.1MB/s', color: '#c8d2e4' },
  { t: 4.9,  text: '  boot.img  100%  ██████████████  26.8MB/s', color: '#c8d2e4' },
  { t: 5.6,  text: '✓ transfer complete', color: '#5fd6a0' },
];

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class RemoteScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.quality = 'balanced';
    this.elapsed = 0;
    this.raf = 0;
    this.last = 0;
    this.ripples = [];
    this.nextRipple = 2.8;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._onResize = () => this.resize();
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(canvas.parentElement || canvas);
    this.resize();
  }

  resize() {
    const box = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // keep the backing store sane on high-dpi screens in "quality" mode
    const factor = Math.min(dpr * QUALITY[this.quality].scale, 2.2);
    const w = Math.max(320, Math.round(box.width * dpr * factor));
    const h = Math.max(180, Math.round(box.height * dpr * factor));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.draw();
  }

  setQuality(quality) {
    if (!QUALITY[quality]) return;
    this.quality = quality;
    this.resize();
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    // seed a little history so the terminal is never empty on open
    this.elapsed = 2.4;
    const loop = (now) => {
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.elapsed += dt;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    if (this.reduced) {
      // single static frame, no cursor drift
      this.draw();
      return;
    }
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this._ro.disconnect();
  }

  update(dt) {
    // occasional click ripples at the cursor position
    if (this.elapsed > this.nextRipple) {
      const p = this.cursorPos(this.elapsed);
      this.ripples.push({ x: p.x, y: p.y, age: 0 });
      this.nextRipple = this.elapsed + 2.4 + Math.random() * 2.6;
    }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < 0.9);
  }

  cursorPos(t) {
    return {
      x: 800 + 470 * Math.sin(t * 0.31) + 130 * Math.sin(t * 0.87 + 1.7),
      y: 460 + 240 * Math.sin(t * 0.43 + 0.6) + 70 * Math.cos(t * 1.13),
    };
  }

  draw() {
    const { ctx, canvas } = this;
    const cw = canvas.width;
    const ch = canvas.height;
    if (!cw || !ch) return;

    const k = Math.min(cw / W, ch / H);
    const ox = (cw - W * k) / 2;
    const oy = (ch - H * k) / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, cw, ch);

    ctx.setTransform(k, 0, 0, k, ox, oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    this.drawWallpaper(ctx);
    this.drawMenubar(ctx);
    this.drawTerminal(ctx);
    this.drawNotes(ctx);
    this.drawDock(ctx);
    this.drawRipples(ctx);
    this.drawCursor(ctx);
    this.drawVignette(ctx);

    ctx.restore();
  }

  /* ---------------------------------------------------------------- scene */

  drawWallpaper(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1a2233');
    g.addColorStop(0.55, '#111726');
    g.addColorStop(1, '#080b12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(330, 160, 20, 330, 160, 900);
    glow.addColorStop(0, 'rgba(255, 86, 96, 0.20)');
    glow.addColorStop(0.5, 'rgba(255, 86, 96, 0.05)');
    glow.addColorStop(1, 'rgba(255, 86, 96, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const cool = ctx.createRadialGradient(1320, 760, 40, 1320, 760, 760);
    cool.addColorStop(0, 'rgba(86, 118, 255, 0.16)');
    cool.addColorStop(1, 'rgba(86, 118, 255, 0)');
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, W, H);
  }

  drawMenubar(ctx) {
    ctx.fillStyle = 'rgba(8, 10, 16, 0.62)';
    ctx.fillRect(0, 0, W, 36);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 35.5);
    ctx.lineTo(W, 35.5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 13px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('begonia-build', 22, 18);

    const items = ['Session', 'View', 'Input', 'Help'];
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    let x = 210;
    for (const it of items) {
      ctx.fillText(it, x, 18);
      x += ctx.measureText(it).width + 26;
    }

    // clock (drifts with session time so it feels alive)
    const total = 14 * 3600 + 32 * 60 + Math.floor(this.elapsed);
    const hh = String(Math.floor(total / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(total / 60) % 60).padStart(2, '0');
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = `500 13px ${MONO}`;
    ctx.fillText(`${hh}:${mm}`, W - 26, 18);

    // fake wifi / battery glyphs
    ctx.textAlign = 'left';
    for (let i = 0; i < 4; i++) {
      const bh = 3 + i * 3;
      ctx.fillStyle = i < 3 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(W - 132 + i * 7, 24 - bh, 4, bh);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, W - 100, 11, 22, 12, 3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(96, 214, 160, 0.85)';
    ctx.fillRect(W - 98, 13, 14, 8);
  }

  drawTerminal(ctx) {
    const x = 84;
    const y = 104;
    const w = 706;
    const h = 452;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 22;
    ctx.fillStyle = '#0c1017';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 12);
    ctx.stroke();

    // title bar
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    roundRect(ctx, x, y, w, 38, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y + 38.5);
    ctx.lineTo(x + w, y + 38.5);
    ctx.stroke();

    const dots = ['#ff5f57', '#febc2e', '#28c840'];
    dots.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(x + 22 + i * 19, y + 19, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });

    ctx.font = `500 12px ${SANS}`;
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.textAlign = 'center';
    ctx.fillText('build — bash — 120×36', x + w / 2, y + 20);
    ctx.textAlign = 'left';

    // terminal text
    ctx.font = `13.5px ${MONO}`;
    ctx.textBaseline = 'middle';
    let ly = y + 74;
    const visible = [];
    for (const line of TERMINAL_LINES) {
      if (this.elapsed < line.t) break;
      visible.push(line);
    }
    const lastLine = visible[visible.length - 1];
    const intro = Math.max(0, this.elapsed - 6.4);

    for (const line of visible) {
      // type-in effect for the newest line
      let text = line.text;
      if (line === lastLine) {
        const age = this.elapsed - line.t;
        const chars = Math.min(text.length, Math.max(1, Math.floor(age * 90)));
        text = text.slice(0, chars);
        if (age * 90 < line.text.length) {
          ctx.fillStyle = line.color;
          ctx.globalAlpha = 0.55;
          ctx.fillText('\u2588', x + 24 + ctx.measureText(text).width, ly);
          ctx.globalAlpha = 1;
        }
      }
      ctx.fillStyle = line.color;
      ctx.fillText(text, x + 24, ly);
      ly += 25;
    }

    // prompt with blinking caret
    if (this.elapsed > 6.0) {
      ctx.fillStyle = '#8bd5a8';
      ctx.fillText('$ ', x + 24, ly + 26);
      const px = x + 24 + ctx.measureText('$ ').width;
      if (Math.floor(this.elapsed * 1.6) % 2 === 0) {
        ctx.fillStyle = 'rgba(200, 210, 228, 0.75)';
        ctx.fillRect(px, ly + 18, 8, 17);
      }
      // command being typed by the remote user
      const typed = ['ls -lh out/', 'reboot fastboot', 'fastboot flash boot out/boot.img'][Math.floor(intro / 4) % 3];
      const n = Math.min(typed.length, Math.floor((intro % 4) * 9));
      ctx.fillStyle = 'rgba(200, 210, 228, 0.9)';
      ctx.fillText(typed.slice(0, n), px + 12, ly + 26);
      if (n > 0 && n < typed.length) {
        ctx.fillRect(px + 12 + ctx.measureText(typed.slice(0, n)).width, ly + 18, 7, 17);
      }
    }
  }

  drawNotes(ctx) {
    const x = 742;
    const y = 196;
    const w = 772;
    const h = 492;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 26;
    ctx.fillStyle = '#f3f5fa';
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.restore();

    // sidebar
    ctx.save();
    roundRect(ctx, x, y, w, h, 12);
    ctx.clip();
    ctx.fillStyle = '#e8ecf4';
    ctx.fillRect(x, y, 196, h);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(x + 195, y, 1, h);

    ctx.font = `600 11px ${SANS}`;
    ctx.fillStyle = '#8a93a8';
    ctx.textBaseline = 'middle';
    ctx.fillText('WORKSPACE', x + 22, y + 30);

    const nav = ['Overview', 'Builds', 'Devices', 'Notes', 'Settings'];
    nav.forEach((n, i) => {
      const ny = y + 64 + i * 38;
      if (i === 3) {
        ctx.fillStyle = 'rgba(255,59,70,0.10)';
        roundRect(ctx, x + 12, ny - 13, 172, 30, 8);
        ctx.fill();
        ctx.fillStyle = '#d62b36';
        ctx.fillRect(x + 12, ny - 13, 3, 30);
      }
      ctx.fillStyle = i === 3 ? '#1d2333' : '#6c7588';
      ctx.font = `${i === 3 ? 600 : 450} 13px ${SANS}`;
      ctx.fillText(n, x + 28, ny + 1);
    });
    ctx.restore();

    // document body
    const bx = x + 230;
    ctx.font = `650 21px ${SANS}`;
    ctx.fillStyle = '#151a26';
    ctx.fillText('Flash notes — begonia', bx, y + 62);

    ctx.font = `450 12px ${SANS}`;
    ctx.fillStyle = '#8a93a8';
    ctx.fillText('edited 2 min ago · autosaved', bx, y + 90);

    // text placeholder lines
    const lines = [0.86, 0.94, 0.72, 0.0, 0.9, 0.81, 0.55];
    let ly = y + 126;
    lines.forEach((len, i) => {
      if (!len) { ly += 14; return; }
      ctx.fillStyle = i === 3 ? 'transparent' : 'rgba(21,26,38,0.16)';
      roundRect(ctx, bx, ly, (w - 290) * len, 9, 4.5);
      ctx.fill();
      ly += 22;
    });

    // checklist
    const checks = [
      ['Unlock bootloader', true],
      ['Flash vbmeta --disable-verity', true],
      ['Boot test image', false],
    ];
    let cy = ly + 8;
    checks.forEach(([label, done]) => {
      ctx.strokeStyle = done ? '#2fa06f' : '#c2c9d8';
      ctx.fillStyle = done ? '#2fa06f' : 'transparent';
      ctx.lineWidth = 1.4;
      roundRect(ctx, bx, cy - 7, 15, 15, 4);
      if (done) ctx.fill();
      ctx.stroke();
      if (done) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(bx + 4, cy);
        ctx.lineTo(bx + 7, cy + 3.2);
        ctx.lineTo(bx + 11.5, cy - 3.4);
        ctx.stroke();
      }
      ctx.font = `450 13px ${SANS}`;
      ctx.fillStyle = done ? '#7b8497' : '#3a4356';
      ctx.fillText(label, bx + 26, cy + 1);
      cy += 28;
    });

    // mini bar chart
    const chartX = bx;
    const chartY = y + 372;
    const chartW = w - 290;
    ctx.fillStyle = '#dfe4ee';
    roundRect(ctx, chartX, chartY, chartW, 96, 10);
    ctx.fill();

    const bars = [0.42, 0.66, 0.38, 0.81, 0.57, 0.94, 0.71, 0.49];
    const bw = (chartW - 60) / bars.length;
    bars.forEach((v, i) => {
      const bh = v * 64;
      ctx.fillStyle = i === 5 ? '#ff3b46' : 'rgba(21,26,38,0.22)';
      roundRect(ctx, chartX + 30 + i * bw, chartY + 84 - bh, bw - 10, bh, 4);
      ctx.fill();
    });

    // window controls
    ctx.textAlign = 'right';
    ctx.font = `450 15px ${SANS}`;
    ctx.fillStyle = '#a8b0c0';
    ctx.fillText('—   ▢   ×', x + w - 22, y + 20);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  drawDock(ctx) {
    const dw = 428;
    const dh = 66;
    const dx = (W - dw) / 2;
    const dy = H - dh - 26;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = 'rgba(12, 15, 23, 0.62)';
    roundRect(ctx, dx, dy, dw, dh, 20);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, dx + 0.5, dy + 0.5, dw - 1, dh - 1, 20);
    ctx.stroke();

    const icons = ['#ff5f57', '#4c8dff', '#35d39a', '#ffb648', '#a78bfa', '#5ac8fa'];
    icons.forEach((c, i) => {
      const ix = dx + 26 + i * 52;
      const iy = dy + 17;
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.9;
      roundRect(ctx, ix, iy, 34, 34, 9);
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000';
      roundRect(ctx, ix + 6, iy + 6, 22, 22, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // active-session indicator under the third icon
    ctx.beginPath();
    ctx.arc(dx + 26 + 2 * 52 + 17, dy + dh - 8, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
  }

  drawRipples(ctx) {
    for (const r of this.ripples) {
      const p = easeOutCubic(Math.min(r.age / 0.7, 1));
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + p * 34, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 120, 128, ${0.75 * (1 - p)})`;
      ctx.fill();
    }
  }

  drawCursor(ctx) {
    const { x, y } = this.cursorPos(this.elapsed);

    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 26);
    ctx.lineTo(7.4, 19.4);
    ctx.lineTo(12.2, 30.4);
    ctx.lineTo(17.4, 28);
    ctx.lineTo(12.6, 17.4);
    ctx.lineTo(22.4, 16.6);
    ctx.closePath();

    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#101521';
    ctx.stroke();
    ctx.restore();
  }

  drawVignette(ctx) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

export { QUALITY };
