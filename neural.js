// Neural-network-style background for hero + workspace.
// Canvas of drifting nodes; lines drawn between near neighbors.
// Occasional red pulses travel along the edges.
// Respects prefers-reduced-motion, pauses when off-screen or tab hidden.

(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const ACCENT = [163, 0, 18];
  const NODE_COLOR = [100, 100, 100];
  const LINE_COLOR = [120, 120, 120];

  function makeScene(canvas, opts = {}) {
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    const LINK_DIST = opts.linkDist ?? 160;
    const DENSITY = opts.density ?? 0.00011;
    const PULSE_PROB = opts.pulseProb ?? 0.02;

    let W = 0, H = 0, dpr = 1;
    let nodes = [];
    let pulses = [];
    let rafId = null;
    let last = 0;

    class Node {
      constructor() {
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        const speed = 0.12 + Math.random() * 0.22;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.r = 1.1 + Math.random() * 1.1;
        this.phase = Math.random() * Math.PI * 2;
      }
      step(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.x < -40) this.x = W + 40;
        if (this.x > W + 40) this.x = -40;
        if (this.y < -40) this.y = H + 40;
        if (this.y > H + 40) this.y = -40;
        this.phase += 0.01 * dt;
      }
      draw() {
        const pulse = 0.6 + 0.4 * Math.sin(this.phase);
        ctx.fillStyle = `rgba(${NODE_COLOR.join(",")}, ${0.28 * pulse})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    class Pulse {
      constructor(a, b) {
        this.a = a; this.b = b;
        this.t = 0;
        this.speed = 0.012 + Math.random() * 0.012;
        this.alive = true;
      }
      step(dt) {
        this.t += this.speed * dt;
        if (this.t >= 1) this.alive = false;
      }
      draw() {
        const x = this.a.x + (this.b.x - this.a.x) * this.t;
        const y = this.a.y + (this.b.y - this.a.y) * this.t;
        const a = 1 - Math.abs(0.5 - this.t) * 2;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 18);
        glow.addColorStop(0, `rgba(${ACCENT.join(",")}, ${0.7 * a})`);
        glow.addColorStop(1, `rgba(${ACCENT.join(",")}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${ACCENT.join(",")}, ${a})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      if (W === 0 || H === 0) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.max(26, Math.min(90, Math.floor(W * H * DENSITY)));
      if (!nodes.length) {
        nodes = Array.from({ length: target }, () => new Node());
      } else if (nodes.length < target) {
        while (nodes.length < target) nodes.push(new Node());
      } else {
        nodes.length = target;
      }
    }

    function drawLinks() {
      const n = nodes.length;
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST * LINK_DIST) {
            const d = Math.sqrt(d2);
            const alpha = (1 - d / LINK_DIST) * 0.2;
            ctx.strokeStyle = `rgba(${LINE_COLOR.join(",")}, ${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }

    function maybeEmitPulse() {
      if (Math.random() > PULSE_PROB) return;
      if (nodes.length < 2) return;
      const a = nodes[Math.floor(Math.random() * nodes.length)];
      let best = null, bestD = Infinity;
      for (const n of nodes) {
        if (n === a) continue;
        const dx = n.x - a.x, dy = n.y - a.y;
        const d = dx * dx + dy * dy;
        if (d < bestD && d < LINK_DIST * LINK_DIST) { bestD = d; best = n; }
      }
      if (best) pulses.push(new Pulse(a, best));
    }

    function loop(now) {
      const dtMs = now - last; last = now;
      const dt = Math.min(dtMs, 50) / 16.67;
      ctx.clearRect(0, 0, W, H);
      for (const n of nodes) n.step(dt);
      drawLinks();
      for (const n of nodes) n.draw();
      maybeEmitPulse();
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.step(dt);
        if (!p.alive) pulses.splice(i, 1); else p.draw();
      }
      rafId = requestAnimationFrame(loop);
    }

    function start() {
      if (rafId) return;
      last = performance.now();
      rafId = requestAnimationFrame(loop);
    }
    function stop() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          resize();
          start();
        } else {
          stop();
        }
      }
    }, { threshold: 0.01 });
    io.observe(canvas);

    // Also trigger start when parent becomes visible (for canvas inside hidden section)
    const mo = new MutationObserver(() => {
      if (!canvas.offsetParent) { stop(); return; }
      resize();
      start();
    });
    if (canvas.parentElement) {
      mo.observe(canvas.parentElement, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
    }

    resize();
    return { start, stop, resize };
  }

  const heroScene = makeScene(document.getElementById("neuralCanvas"));
  const workspaceScene = makeScene(document.getElementById("neuralCanvasWorkspace"), {
    density: 0.00008,
    pulseProb: 0.025,
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      heroScene?.stop(); workspaceScene?.stop();
    } else {
      heroScene?.start(); workspaceScene?.start();
    }
  });
})();
