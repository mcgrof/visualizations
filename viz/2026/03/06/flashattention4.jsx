import { useState, useEffect, useRef } from "react";

const palette = {
  bg: "#080c14",
  surface: "#0d1421",
  panel: "#111827",
  border: "#1e2d45",
  accent: "#00d4ff",
  accentDim: "#0099bb",
  green: "#00ff88",
  orange: "#ff8c42",
  red: "#ff4d6d",
  purple: "#a855f7",
  yellow: "#fbbf24",
  muted: "#4a6080",
  text: "#c9d8ec",
  textDim: "#5a7090",
};

const fonts = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
`;

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${palette.bg}; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: ${palette.surface}; }
  ::-webkit-scrollbar-thumb { background: ${palette.border}; border-radius: 3px; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes slideRight { from{transform:translateX(-100%);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes glow { 0%,100%{box-shadow:0 0 8px ${palette.accent}44} 50%{box-shadow:0 0 20px ${palette.accent}88} }
  @keyframes flow { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }
  @keyframes blink { 0%,100%{background:${palette.accent}22} 50%{background:${palette.accent}66} }
`;

// ─── SECTION: Evolution timeline ───────────────────────────────────────────
const versions = [
  {
    ver: "FA1",
    year: "2022",
    hw: "A100",
    color: palette.muted,
    tagline: "IO-Aware Attention",
    points: [
      "Tiling: never materialize full N² attention matrix",
      "Online softmax via running max/sum",
      "HBM reads/writes → O(N) memory complexity",
      "3–4× fewer HBM ops vs standard attention",
    ],
  },
  {
    ver: "FA2",
    year: "2023",
    hw: "A100/H100",
    color: palette.purple,
    tagline: "Better Parallelism",
    points: [
      "Reduced non-matmul FLOPs in forward pass",
      "Sequence-length parallelism for long contexts",
      "Improved work partitioning across warps",
      "~2× speedup over FA1 in practice",
    ],
  },
  {
    ver: "FA3",
    year: "2024",
    hw: "H100 (Hopper)",
    color: palette.orange,
    tagline: "Async + Warp Specialization",
    points: [
      "Producer/consumer warp split (TMA loads)",
      "WGMMA asynchronous matrix-multiply",
      "Ping-pong softmax/GEMM overlap (2 warpgroups)",
      "FP8 low-precision with incoherent processing",
    ],
  },
  {
    ver: "FA4",
    year: "2025",
    hw: "B200 (Blackwell)",
    color: palette.accent,
    tagline: "Algorithm + Kernel Co-Design",
    points: [
      "Tensor Memory (TMEM) for accumulator storage",
      "5-warp specialization pipeline (fully async)",
      "Software-emulated exp on FMA units",
      "Conditional softmax rescaling + 2-CTA MMA",
    ],
  },
];

// ─── SECTION: Roofline data ─────────────────────────────────────────────────
const rooflineData = [
  { label: "MMA\n(QK^T)", cycles: 512, color: palette.green, type: "compute" },
  { label: "MMA\n(PV)", cycles: 512, color: palette.green, type: "compute" },
  { label: "Softmax\n(exp)", cycles: 1024, color: palette.red, type: "bottleneck" },
  { label: "SMEM\nTraffic", cycles: 1536, color: palette.orange, type: "bottleneck" },
];

// ─── SECTION: Warp types ────────────────────────────────────────────────────
const warps = [
  { id: "load", label: "Load Warp", color: palette.purple, icon: "⬇", desc: "TMA-driven async loads of Q, K, V tiles from global memory → shared memory. Never blocks MMA." },
  { id: "mma", label: "MMA Warp", color: palette.green, icon: "⊗", desc: "tcgen05.mma (5th-gen tensor cores). Computes QK^T → S tiles and PV → O tiles fully asynchronously. Accumulates in TMEM." },
  { id: "softmax", label: "Softmax Warps ×2", color: palette.red, icon: "σ", desc: "Per-tile softmax using software-emulated exp on FMA units (not SFUs). Runs while MMA is computing the next tile." },
  { id: "correction", label: "Correction Warp", color: palette.yellow, icon: "↻", desc: "Rescales previously accumulated O tiles when the running max changes. Runs conditionally — skipped when max doesn't change." },
  { id: "store", label: "Store Warp", color: palette.accentDim, icon: "⬆", desc: "Writes final normalized output tiles back to HBM. Fully decoupled from compute pipeline." },
];

// ─── Animated Pipeline Diagram ──────────────────────────────────────────────
function PipelineDiagram() {
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(t => (t + 1) % 16), 500);
    return () => clearInterval(id);
  }, [running]);

  const stages = ["Load K/V", "MMA QK^T", "Softmax", "MMA PV", "Correct O", "Store O"];
  const stageColors = [palette.purple, palette.green, palette.red, palette.green, palette.yellow, palette.accentDim];

  // Two query tiles H and L interleaved
  const tiles = [
    { name: "Q^H tile 0", color: palette.accent },
    { name: "Q^L tile 0", color: palette.orange },
    { name: "Q^H tile 1", color: palette.accent },
    { name: "Q^L tile 1", color: palette.orange },
  ];

  // Each tile takes 6 stages; stagger by 2 between H and L (ping-pong)
  const getStage = (tileIdx) => {
    const offset = tileIdx * 2;
    const adjusted = tick - offset;
    if (adjusted < 0 || adjusted >= stages.length) return -1;
    return adjusted;
  };

  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {stages.map((s, i) => (
          <div key={i} style={{
            background: stageColors[i] + "22",
            border: `1px solid ${stageColors[i]}66`,
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            color: stageColors[i],
          }}>{s}</div>
        ))}
      </div>

      <div style={{ position: "relative", minHeight: 180 }}>
        {/* Stage columns */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4, marginBottom: 12 }}>
          {stages.map((s, si) => (
            <div key={si} style={{
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              borderRadius: 6,
              padding: "6px 4px",
              textAlign: "center",
              fontSize: 10,
              color: palette.textDim,
            }}>{s}</div>
          ))}
        </div>

        {/* Tiles in pipeline */}
        {tiles.map((tile, ti) => {
          const stage = getStage(ti);
          return (
            <div key={ti} style={{
              display: "grid",
              gridTemplateColumns: "repeat(6,1fr)",
              gap: 4,
              marginBottom: 8,
            }}>
              {stages.map((_, si) => (
                <div key={si} style={{
                  height: 28,
                  borderRadius: 5,
                  background: stage === si ? tile.color + "44" : "transparent",
                  border: `1px solid ${stage === si ? tile.color : palette.border + "44"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  color: stage === si ? tile.color : "transparent",
                  transition: "all 0.3s ease",
                  fontWeight: "bold",
                }}>
                  {stage === si ? tile.name : "·"}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 16, alignItems: "center" }}>
        <button
          onClick={() => setRunning(r => !r)}
          style={{
            background: running ? palette.accent + "22" : palette.surface,
            border: `1px solid ${running ? palette.accent : palette.border}`,
            borderRadius: 6,
            color: running ? palette.accent : palette.textDim,
            padding: "6px 16px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
          }}>
          {running ? "⏸ Pause" : "▶ Play"}
        </button>
        <div style={{ fontSize: 11, color: palette.textDim }}>
          Tick {tick}/15 — Q^H & Q^L tiles interleave in ping-pong fashion, keeping tensor cores busy
        </div>
      </div>
    </div>
  );
}

// ─── Roofline Bar Chart ──────────────────────────────────────────────────────
function RooflineChart({ showFA4 }) {
  const maxCycles = 1600;
  const fa4Data = [
    { label: "MMA\n(QK^T)", cycles: 512, color: palette.green, type: "compute" },
    { label: "MMA\n(PV)", cycles: 512, color: palette.green, type: "compute" },
    { label: "Softmax\n(exp)", cycles: 480, color: palette.yellow, type: "overlap", note: "Overlapped!" },
    { label: "SMEM\nTraffic", cycles: 600, color: palette.accentDim, type: "reduced", note: "TMEM!" },
  ];
  const data = showFA4 ? fa4Data : rooflineData;

  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: palette.green }}>
          <div style={{ width: 12, height: 12, background: palette.green, borderRadius: 2 }} /> Compute (MMA)
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: palette.red }}>
          <div style={{ width: 12, height: 12, background: palette.red, borderRadius: 2 }} /> Bottleneck
        </div>
        {showFA4 && <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: palette.yellow }}>
            <div style={{ width: 12, height: 12, background: palette.yellow, borderRadius: 2 }} /> Overlapped
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: palette.accentDim }}>
            <div style={{ width: 12, height: 12, background: palette.accentDim, borderRadius: 2 }} /> TMEM-Reduced
          </div>
        </>}
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", height: 180 }}>
        {data.map((d, i) => {
          const h = (d.cycles / maxCycles) * 160;
          const isBottleneck = d.type === "bottleneck";
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 11, color: d.color, fontWeight: "bold" }}>{d.cycles}c</div>
              {d.note && <div style={{ fontSize: 10, color: d.color, background: d.color + "22", borderRadius: 4, padding: "2px 6px" }}>{d.note}</div>}
              <div style={{
                width: "100%",
                height: h,
                background: d.color + (isBottleneck ? "55" : "33"),
                border: `2px solid ${d.color}${isBottleneck ? "" : "88"}`,
                borderRadius: "4px 4px 0 0",
                transition: "all 0.5s ease",
                position: "relative",
                overflow: "hidden",
              }}>
                {isBottleneck && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: `repeating-linear-gradient(45deg, transparent, transparent 4px, ${palette.red}22 4px, ${palette.red}22 8px)`,
                  }} />
                )}
              </div>
              <div style={{
                fontSize: 10, color: palette.textDim, textAlign: "center",
                whiteSpace: "pre-line", lineHeight: 1.4,
              }}>{d.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, padding: "8px 12px", background: palette.surface, borderRadius: 6, border: `1px solid ${palette.border}`, fontSize: 11, color: palette.textDim }}>
        {showFA4
          ? "✓ FA4 hides softmax latency behind MMA and uses TMEM to slash shared memory traffic"
          : "⚠ On B200: tensor cores 2× faster than Hopper, but exp units & SMEM bandwidth did NOT scale — now the bottleneck"}
      </div>
    </div>
  );
}

// ─── Memory Hierarchy ────────────────────────────────────────────────────────
function MemoryDiagram() {
  const layers = [
    { label: "HBM (Global)", size: "80 GB", bw: "3.35 TB/s", color: palette.muted, detail: "Q, K, V inputs + output O" },
    { label: "Shared Memory (SMEM)", size: "256 KB/SM", bw: "~30 TB/s", color: palette.orange, detail: "K/V tiles staged by TMA loads" },
    { label: "Tensor Memory (TMEM) ← NEW", size: "256 KB/SM", bw: "~100 TB/s", color: palette.accent, detail: "S, P, O accumulators — wired to tensor cores. Blackwell-only!" },
    { label: "Registers", size: "256 KB/SM", bw: "fastest", color: palette.green, detail: "Softmax running max/sum, loop vars" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "'JetBrains Mono', monospace" }}>
      {layers.map((l, i) => (
        <div key={i} style={{
          padding: "12px 16px",
          background: palette.surface,
          border: `1px solid ${l.color}66`,
          borderLeft: `4px solid ${l.color}`,
          borderRadius: 6,
          display: "flex",
          gap: 16,
          alignItems: "center",
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: l.color, fontWeight: "bold", marginBottom: 3 }}>{l.label}</div>
            <div style={{ fontSize: 11, color: palette.textDim }}>{l.detail}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ color: palette.text }}>{l.size}</div>
            <div style={{ color: palette.muted }}>{l.bw}</div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: palette.textDim, marginTop: 4, padding: "8px 12px", background: palette.surface, borderRadius: 6, border: `1px solid ${palette.border}` }}>
        💡 TMEM is the killer feature: FA3 kept accumulators in registers → register pressure → serial schedule. FA4 dumps them in TMEM → multiple MMAs in flight simultaneously.
      </div>
    </div>
  );
}

// ─── Techniques detail ────────────────────────────────────────────────────────
const techniques = [
  {
    id: "pipeline",
    title: "① Redesigned Async Pipeline",
    color: palette.accent,
    summary: "Two Q tiles (Q^H and Q^L), each 128 tokens, processed in ping-pong. Fully async tcgen05.mma accumulates into TMEM while CUDA cores handle softmax.",
    detail: [
      "FA3's WGMMA was async but accumulators lived in registers — register pressure throttled parallelism.",
      "FA4 uses tcgen05.mma (Blackwell Gen-5 tensor cores) — fully asynchronous, accumulators in TMEM.",
      "A warp can fire off an MMA and immediately move on — the hardware notifies completion via a barrier.",
      "Two query tiles H and L alternate: while softmax runs for tile j, MMA is already running for tile j+1.",
      "Five specialized warp roles: Load → MMA → Softmax → Correction → Store. Zero idle time on tensor cores.",
    ],
  },
  {
    id: "softmax",
    title: "② Software-Emulated Exp + Conditional Rescaling",
    color: palette.red,
    summary: "SFU (MUFU.EX2) units didn't scale with Blackwell tensor cores. FA4 distributes exp computation across abundant FMA units using polynomial approximation.",
    detail: [
      "On B200: softmax exp takes ~1024 cycles; each MMA only ~512. The exp unit is now the critical path.",
      "Hardware SFUs are scarce (few per SM). When thousands of threads need exp(), they queue up.",
      "FA4 software-emulates 2^x via polynomial FMA approximation — trades accuracy margin for parallelism.",
      "Online softmax normally rescales O every iteration when running max changes. FA4 skips rescaling when max doesn't change (conditional rescaling) — often saves 30-50% of correction operations.",
      "A dedicated Correction warpgroup handles rescaling, removed from the critical MMA path.",
    ],
  },
  {
    id: "tmem",
    title: "③ Tensor Memory + 2-CTA MMA (Backward Pass)",
    color: palette.yellow,
    summary: "Backward pass recomputes S and P in transposed tile layout, stores P^T and dS^T directly in TMEM in operand-A layout ready for dV and dK MMAs — zero transposition overhead.",
    detail: [
      "Backward pass needs dQ, dK, dV. Naively requires reading S and P from shared memory multiple times.",
      "FA4 backward recomputes S and P in transposed tile orientation so the intermediate IS already S^T / P^T.",
      "P^T can be stored directly in TMEM in the exact operand-A layout consumed by dV's MMA — no layout transform.",
      "TMEM can't hold all 5 accumulators (S, P, dP, dS, dQ) simultaneously, so FA4 reuses TMEM columns across stages.",
      "2-CTA MMA mode (new in Blackwell): two CTAs collaborate on one large GEMM, halving atomic add reductions for dK and dV.",
    ],
  },
  {
    id: "scheduler",
    title: "④ New Tile Scheduler",
    color: palette.purple,
    summary: "Causal masking and variable-length sequences create severe load imbalance. FA4's tile scheduler dynamically assigns work to SMs to keep all 148 SMs busy.",
    detail: [
      "Causal attention: early tiles have more valid tokens than late tiles (lower-triangular mask).",
      "With a static schedule, some SMs finish early and idle while others crunch through dense tiles.",
      "FA4's tile scheduler is persistent-kernel style — SMs pull work from a queue rather than being statically assigned.",
      "Handles variable-length sequences (packing multiple short sequences into one batch) natively.",
      "Combined with GQA (grouped-query attention) packing, allows KV heads to be broadcast across Q heads efficiently.",
    ],
  },
];

// ─── Perf numbers ──────────────────────────────────────────────────────────
function PerfSection() {
  const bars = [
    { label: "FA3 (H100)", val: 60, color: palette.orange, note: "Hopper baseline" },
    { label: "cuDNN (B200)", val: 75, color: palette.muted, note: "NVIDIA closed-source" },
    { label: "FA4 (B200)", val: 91, color: palette.accent, note: "~20% over cuDNN" },
  ];
  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <div style={{ marginBottom: 16, fontSize: 12, color: palette.textDim }}>
        % of theoretical peak MFU (model FLOP utilization) — forward pass, BF16
      </div>
      {bars.map((b, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: b.color, fontWeight: "bold" }}>{b.label}</span>
            <span style={{ fontSize: 12, color: palette.textDim }}>{b.note}</span>
          </div>
          <div style={{ background: palette.surface, borderRadius: 6, overflow: "hidden", height: 28, border: `1px solid ${palette.border}` }}>
            <div style={{
              height: "100%",
              width: `${b.val}%`,
              background: `linear-gradient(90deg, ${b.color}66, ${b.color}33)`,
              borderRight: `2px solid ${b.color}`,
              display: "flex",
              alignItems: "center",
              paddingLeft: 10,
              fontSize: 12,
              color: b.color,
              fontWeight: "bold",
              transition: "width 1s ease",
            }}>{b.val}%</div>
          </div>
        </div>
      ))}
      <div style={{ padding: "10px 14px", background: palette.accent + "11", border: `1px solid ${palette.accent}44`, borderRadius: 8, fontSize: 12, color: palette.text, marginTop: 8 }}>
        FA4 also beats cuBLAS 13.0 on a standalone A@B+C GEMM on Blackwell — the TMEM-based accumulation + async epilogue overlap is generically useful, not just for attention.
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
const SECTIONS = ["Overview", "Problem", "Pipeline", "Techniques", "Results"];

export default function FlashAttention4() {
  const [activeSection, setActiveSection] = useState(0);
  const [showFA4Roofline, setShowFA4Roofline] = useState(false);
  const [activeTech, setActiveTech] = useState(0);
  const [activeWarp, setActiveWarp] = useState(null);

  return (
    <>
      <style>{fonts + css}</style>
      <div style={{
        background: palette.bg,
        minHeight: "100vh",
        fontFamily: "'Syne', sans-serif",
        color: palette.text,
        padding: "0 0 60px",
      }}>
        {/* Header */}
        <div style={{
          padding: "32px 32px 24px",
          borderBottom: `1px solid ${palette.border}`,
          background: `linear-gradient(180deg, ${palette.surface} 0%, ${palette.bg} 100%)`,
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: `radial-gradient(ellipse at 20% 50%, ${palette.accent}08 0%, transparent 60%),
              radial-gradient(ellipse at 80% 20%, ${palette.purple}08 0%, transparent 50%)`,
          }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 11, color: palette.accent, letterSpacing: 3, textTransform: "uppercase", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
              arXiv:2603.05451 — Zadouri et al.
            </div>
            <h1 style={{ fontSize: "clamp(22px,4vw,40px)", fontWeight: 800, color: "#fff", lineHeight: 1.1, marginBottom: 10 }}>
              FlashAttention-4
              <span style={{ color: palette.accent, display: "block", fontSize: "clamp(14px,2.5vw,22px)", fontWeight: 400, marginTop: 4 }}>
                Algorithm &amp; Kernel Pipelining Co-Design for Asymmetric Hardware Scaling
              </span>
            </h1>
            <div style={{ fontSize: 13, color: palette.textDim, maxWidth: 600 }}>
              Blackwell (B200) doubled tensor core throughput but left exp units and shared memory bandwidth in the dust.
              FA4 redesigns everything to attack these new bottlenecks.
            </div>
          </div>
        </div>

        {/* Nav */}
        <div style={{
          display: "flex",
          gap: 4,
          padding: "12px 32px",
          borderBottom: `1px solid ${palette.border}`,
          background: palette.surface,
          flexWrap: "wrap",
        }}>
          {SECTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSection(i)}
              style={{
                background: activeSection === i ? palette.accent + "22" : "transparent",
                border: `1px solid ${activeSection === i ? palette.accent : "transparent"}`,
                borderRadius: 6,
                color: activeSection === i ? palette.accent : palette.textDim,
                padding: "6px 16px",
                cursor: "pointer",
                fontFamily: "'Syne', sans-serif",
                fontSize: 13,
                fontWeight: activeSection === i ? 700 : 400,
                transition: "all 0.2s",
              }}>
              {s}
            </button>
          ))}
        </div>

        <div style={{ padding: "32px", maxWidth: 900, margin: "0 auto" }}>

          {/* OVERVIEW */}
          {activeSection === 0 && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 6 }}>The Big Picture</h2>
              <p style={{ fontSize: 14, color: palette.textDim, marginBottom: 28, lineHeight: 1.7 }}>
                FlashAttention-4 is the fourth generation of the IO-aware fused attention kernel family,
                purpose-built for NVIDIA Blackwell GPUs (B200, GB200). It's not just an update — it's a
                ground-up co-design of the algorithm and kernel to handle a fundamentally shifted bottleneck profile.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16, marginBottom: 32 }}>
                {versions.map((v) => (
                  <div key={v.ver} style={{
                    background: palette.surface,
                    border: `1px solid ${v.color}44`,
                    borderTop: `3px solid ${v.color}`,
                    borderRadius: 8,
                    padding: 16,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: v.color }}>{v.ver}</span>
                      <span style={{ fontSize: 11, color: palette.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{v.year}</span>
                    </div>
                    <div style={{ fontSize: 11, color: v.color, marginBottom: 6, fontWeight: 600 }}>{v.hw}</div>
                    <div style={{ fontSize: 12, color: palette.text, marginBottom: 10, fontStyle: "italic" }}>{v.tagline}</div>
                    <ul style={{ listStyle: "none", padding: 0 }}>
                      {v.points.map((p, i) => (
                        <li key={i} style={{ fontSize: 11, color: palette.textDim, marginBottom: 4, paddingLeft: 12, position: "relative" }}>
                          <span style={{ position: "absolute", left: 0, color: v.color }}>›</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div style={{
                padding: 20, background: palette.surface,
                border: `1px solid ${palette.border}`, borderRadius: 8,
                fontSize: 13, color: palette.textDim, lineHeight: 1.7,
              }}>
                <span style={{ color: palette.accent, fontWeight: 700 }}>Core insight:</span>{" "}
                Attention = two GEMMs (QK^T and PV) with softmax in between. Every FA version has found new ways
                to hide the non-GEMM work inside the GEMM's execution time. FA4 does this more aggressively than ever
                by exploiting TMEM (new in Blackwell) and distributing exp computation onto underutilized FMA units.
              </div>
            </div>
          )}

          {/* PROBLEM */}
          {activeSection === 1 && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 6 }}>The Problem: Asymmetric Scaling</h2>
              <p style={{ fontSize: 14, color: palette.textDim, marginBottom: 24, lineHeight: 1.7 }}>
                NVIDIA Blackwell doubled tensor core FLOPS (again) but left the exponential units and shared memory
                bandwidth roughly unchanged. This demolished the assumptions FA3 was built on.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
                {[
                  { label: "Tensor Core FLOPS", hopper: "1×", blackwell: "2×", color: palette.green, note: "Doubled again" },
                  { label: "SMEM Bandwidth", hopper: "1×", blackwell: "~1.5×", color: palette.orange, note: "Modest gain" },
                  { label: "Exp Unit (MUFU.EX2)", hopper: "1×", blackwell: "~1×", color: palette.red, note: "Did NOT scale" },
                  { label: "HBM Bandwidth", hopper: "3.35 TB/s", blackwell: "8 TB/s", color: palette.purple, note: "2.4× (HBM3e)" },
                ].map((r, i) => (
                  <div key={i} style={{
                    background: palette.surface,
                    border: `1px solid ${r.color}44`,
                    borderRadius: 8, padding: 14,
                  }}>
                    <div style={{ fontSize: 12, color: palette.textDim, marginBottom: 6 }}>{r.label}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: palette.muted }}>H100: {r.hopper}</span>
                      <span style={{ color: r.color, fontWeight: 700 }}>B200: {r.blackwell}</span>
                    </div>
                    <div style={{ fontSize: 11, color: r.color, marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>{r.note}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, color: "#fff" }}>Roofline Analysis (M=N=256, d=128)</h3>
                  <button
                    onClick={() => setShowFA4Roofline(v => !v)}
                    style={{
                      background: showFA4Roofline ? palette.accent + "22" : palette.surface,
                      border: `1px solid ${showFA4Roofline ? palette.accent : palette.border}`,
                      borderRadius: 6,
                      color: showFA4Roofline ? palette.accent : palette.textDim,
                      padding: "5px 14px",
                      cursor: "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                    }}>
                    {showFA4Roofline ? "← Show B200 Bottlenecks" : "Show FA4 Fixes →"}
                  </button>
                </div>
                <div style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 20 }}>
                  <RooflineChart showFA4={showFA4Roofline} />
                </div>
              </div>

              <div style={{
                padding: "14px 18px",
                background: palette.red + "11",
                border: `1px solid ${palette.red}44`,
                borderRadius: 8,
                fontSize: 13, color: palette.text, lineHeight: 1.7,
              }}>
                <span style={{ color: palette.red, fontWeight: 700 }}>The brutal math:</span>{" "}
                With M=N=256, d=128: MMA takes ~512 cycles per matmul. Softmax exp takes ~1024 cycles.
                Shared memory traffic: ~1536 cycles. Tensor cores sit idle more than half the time in a naive kernel.
                FA4 was built to fix exactly this.
              </div>
            </div>
          )}

          {/* PIPELINE */}
          {activeSection === 2 && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 6 }}>The FA4 Pipeline</h2>
              <p style={{ fontSize: 14, color: palette.textDim, marginBottom: 24, lineHeight: 1.7 }}>
                FA4 uses 5 warp specializations operating concurrently, plus a ping-pong Q tile schedule
                to keep the tensor cores continuously fed.
              </p>

              {/* Warp cards */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
                {warps.map((w, i) => (
                  <div
                    key={w.id}
                    onClick={() => setActiveWarp(activeWarp === i ? null : i)}
                    style={{
                      flex: "1 1 140px",
                      background: activeWarp === i ? w.color + "22" : palette.surface,
                      border: `1px solid ${activeWarp === i ? w.color : palette.border}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{w.icon}</div>
                    <div style={{ fontSize: 12, color: w.color, fontWeight: 700, marginBottom: 3 }}>{w.label}</div>
                    {activeWarp === i && (
                      <div style={{ fontSize: 11, color: palette.textDim, marginTop: 8, lineHeight: 1.6, animation: "fadeIn 0.2s ease" }}>
                        {w.desc}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: palette.textDim, marginBottom: 24, fontFamily: "'JetBrains Mono', monospace" }}>
                ↑ Click any warp to expand details
              </div>

              <h3 style={{ fontSize: 16, color: "#fff", marginBottom: 12 }}>Ping-Pong Pipeline Simulation</h3>
              <div style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 20, marginBottom: 20 }}>
                <PipelineDiagram />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: palette.surface, border: `1px solid ${palette.orange}44`, borderRadius: 8, padding: 16 }}>
                  <h4 style={{ fontSize: 14, color: palette.orange, marginBottom: 8 }}>FA3: WGMMA Ping-Pong</h4>
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {["2 warpgroups alternate softmax/GEMM", "Accumulators in registers", "Register pressure → serial schedule", "Async WGMMA but sync softmax"].map((t, i) => (
                      <li key={i} style={{ fontSize: 12, color: palette.textDim, marginBottom: 5, paddingLeft: 14, position: "relative" }}>
                        <span style={{ position: "absolute", left: 0, color: palette.orange }}>›</span>{t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ background: palette.surface, border: `1px solid ${palette.accent}44`, borderRadius: 8, padding: 16 }}>
                  <h4 style={{ fontSize: 14, color: palette.accent, marginBottom: 8 }}>FA4: 5-Stage Full Async</h4>
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {["5 specialized warp roles", "tcgen05.mma → accumulate in TMEM", "Multiple MMAs in flight simultaneously", "Softmax on CUDA cores, not SFUs"].map((t, i) => (
                      <li key={i} style={{ fontSize: 12, color: palette.textDim, marginBottom: 5, paddingLeft: 14, position: "relative" }}>
                        <span style={{ position: "absolute", left: 0, color: palette.accent }}>›</span>{t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TECHNIQUES */}
          {activeSection === 3 && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Key Techniques</h2>
              <p style={{ fontSize: 14, color: palette.textDim, marginBottom: 24, lineHeight: 1.7 }}>
                Four interlocking innovations address the shifted bottleneck profile. None works alone — they reinforce each other.
              </p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
                {techniques.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTech(i)}
                    style={{
                      background: activeTech === i ? t.color + "22" : palette.surface,
                      border: `1px solid ${activeTech === i ? t.color : palette.border}`,
                      borderRadius: 6,
                      color: activeTech === i ? t.color : palette.textDim,
                      padding: "6px 14px",
                      cursor: "pointer",
                      fontFamily: "'Syne', sans-serif",
                      fontSize: 12,
                      fontWeight: activeTech === i ? 700 : 400,
                    }}>
                    {t.title.split(" ")[0]}
                  </button>
                ))}
              </div>

              {(() => {
                const t = techniques[activeTech];
                return (
                  <div style={{ animation: "fadeIn 0.25s ease" }} key={activeTech}>
                    <div style={{
                      background: palette.surface,
                      border: `1px solid ${t.color}55`,
                      borderTop: `3px solid ${t.color}`,
                      borderRadius: 8,
                      padding: 20,
                      marginBottom: 16,
                    }}>
                      <h3 style={{ fontSize: 18, color: t.color, fontWeight: 800, marginBottom: 10 }}>{t.title}</h3>
                      <p style={{ fontSize: 14, color: palette.text, lineHeight: 1.7, marginBottom: 16 }}>{t.summary}</p>
                      <div style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 14 }}>
                        {t.detail.map((d, i) => (
                          <div key={i} style={{
                            display: "flex", gap: 12, marginBottom: 12,
                            padding: "10px 14px",
                            background: palette.bg,
                            borderRadius: 6,
                            border: `1px solid ${palette.border}`,
                          }}>
                            <span style={{ color: t.color, fontWeight: 700, fontSize: 12, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span style={{ fontSize: 13, color: palette.textDim, lineHeight: 1.65 }}>{d}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <h3 style={{ fontSize: 16, color: "#fff", marginBottom: 12, marginTop: 24 }}>Memory Hierarchy in FA4</h3>
              <div style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 20 }}>
                <MemoryDiagram />
              </div>
            </div>
          )}

          {/* RESULTS */}
          {activeSection === 4 && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Results &amp; Impact</h2>
              <p style={{ fontSize: 14, color: palette.textDim, marginBottom: 24, lineHeight: 1.7 }}>
                FA4 beats NVIDIA's own closed-source cuDNN attention kernels on their own hardware.
              </p>

              <div style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 20, marginBottom: 24 }}>
                <PerfSection />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 24 }}>
                {[
                  { stat: "~20%", label: "Faster than cuDNN on B200", color: palette.accent },
                  { stat: "5", label: "Specialized warp roles", color: palette.green },
                  { stat: "256KB", label: "TMEM per SM (Blackwell)", color: palette.yellow },
                  { stat: "2×", label: "Atomic reductions cut by 2-CTA MMA", color: palette.purple },
                ].map((s, i) => (
                  <div key={i} style={{
                    background: palette.surface,
                    border: `1px solid ${s.color}44`,
                    borderRadius: 8,
                    padding: "16px 20px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 32, fontWeight: 800, color: s.color, marginBottom: 6 }}>{s.stat}</div>
                    <div style={{ fontSize: 12, color: palette.textDim }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 16 }}>
                  <h4 style={{ fontSize: 14, color: palette.accent, marginBottom: 10 }}>🔓 What's Open Source</h4>
                  {[
                    "Full CUDA/CuTe DSL implementation",
                    "Forward + backward pass kernels",
                    "FP8, FP16, BF16 precision support",
                    "Variable-length sequence support",
                    "FlexAttention integration (PyTorch)",
                  ].map((t, i) => (
                    <div key={i} style={{ fontSize: 12, color: palette.textDim, marginBottom: 5, display: "flex", gap: 8 }}>
                      <span style={{ color: palette.green }}>✓</span>{t}
                    </div>
                  ))}
                </div>
                <div style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 16 }}>
                  <h4 style={{ fontSize: 14, color: palette.orange, marginBottom: 10 }}>⚠ ROCm / AMD Caveat</h4>
                  <p style={{ fontSize: 12, color: palette.textDim, lineHeight: 1.7 }}>
                    FA4 is written in CUTLASS CuTe Python DSL — ~10× harder to port to ROCm HIP than vanilla CUDA C++.
                    TMEM is a Blackwell-only feature with no AMD equivalent yet.
                    AMD MI300X users are stuck on FA2/FA3-era kernels for now.
                  </p>
                </div>
              </div>

              <div style={{
                marginTop: 20,
                padding: "16px 20px",
                background: palette.surface,
                border: `1px solid ${palette.accent}33`,
                borderRadius: 8,
                fontSize: 13, color: palette.textDim, lineHeight: 1.8,
              }}>
                <span style={{ color: palette.accent, fontWeight: 700 }}>Why this matters for LLM inference:</span>{" "}
                Attention is the bottleneck in long-context workloads. FA4 directly reduces time-per-token on B200 systems
                like GB200 NVLink racks. Combined with quantization (FP8/FP4) and speculative decoding, this is a meaningful
                multiplier on inference throughput per dollar — right when the industry is scaling toward million-token contexts.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
