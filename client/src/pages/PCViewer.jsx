import { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { io } from 'socket.io-client';
import * as THREE from 'three';

// ── Module-level shared state ─────────────────────────────────
// Phone computes quaternion and sends it directly.
// PC just stores and applies — zero math.
const quatRef = new Float32Array(4); // [qx, qy, qz, qw] — pre-computed by phone
const _targetQ = new THREE.Quaternion();

// ── Phone Dimensions ─────────────────────────────────────────
const W = 2.4, H = 5.2, D = 0.34;

// ── Telemetry Graph (Engineering HUD) ─────────────────────────
function TelemetryGraph() {
  const canvasRef = useRef();
  const buf = useRef(Array.from({ length: 100 }, () => [0, 0, 0]));

  useEffect(() => {
    let rid;
    const tick = () => {
      rid = requestAnimationFrame(tick);
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const { width: w, height: h } = cv;

      buf.current.push([quatRef[0], quatRef[1], quatRef[2]]);
      if (buf.current.length > 100) buf.current.shift();

      ctx.clearRect(0, 0, w, h);
      // Scanline bg
      ctx.fillStyle = 'rgba(0,255,100,0.02)';
      for (let y = 0; y < h; y += 4) { ctx.fillRect(0, y, w, 2); }

      const plot = (idx, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        buf.current.forEach((v, i) => {
          const x = (i / 100) * w;
          const y = h / 2 - v[idx] * (h / 2.2);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
      };
      plot(0, '#60a5fa');
      plot(1, '#f87171');
      plot(2, '#4ade80');
    };
    tick();
    return () => cancelAnimationFrame(rid);
  }, []);

  return <canvas ref={canvasRef} width={260} height={72}
    style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ── Camera Lens ────────────────────────────────────────────────
function Lens({ position, radius = 0.22 }) {
  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[radius + 0.04, radius + 0.04, 0.07, 32]} />
        <meshStandardMaterial color="#0f172a" metalness={0.95} roughness={0.05} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[radius, radius, 0.04, 32]} />
        <meshPhysicalMaterial color="#1e3a8a" metalness={0.1} roughness={0}
          transparent opacity={0.9} transmission={0.3} />
      </mesh>
      <mesh position={[-radius * 0.3, 0.07, radius * 0.3]}>
        <sphereGeometry args={[radius * 0.12, 8, 8]} />
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={3} />
      </mesh>
    </group>
  );
}

// ── Screen Texture (Home UI) ───────────────────────────────────
function useScreenTexture() {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 1024;
    return c;
  }, []);
  const texture = useMemo(() => new THREE.CanvasTexture(canvas), [canvas]);

  const update = (battery, flashlight) => {
    const c = canvas;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const now = new Date();
    const hhmm = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const date = now.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });

    // Wallpaper
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0,   '#0d1b2a');
    bg.addColorStop(0.5, '#1b2838');
    bg.addColorStop(1,   '#0a0f1e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for (let y = 0; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

    // Dynamic Island — expands with gyro activity
    const motion = Math.min((Math.abs(quatRef[0]) + Math.abs(quatRef[1])) * 300, 180);
    const iw = 120 + motion;
    ctx.fillStyle = '#000';
    roundRect(ctx, w/2 - iw/2, 48, iw, 40, 20);
    ctx.fill();

    // Status bar
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 26px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(hhmm, 40, 80);
    ctx.textAlign = 'right';
    ctx.fillText(`${battery?.level ?? 100}%`, w - 40, 80);

    // Clock
    ctx.textAlign = 'center';
    ctx.font = 'bold 108px system-ui';
    ctx.fillStyle = 'white';
    ctx.fillText(hhmm, w/2, 290);
    ctx.font = '28px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(date, w/2, 340);

    // Flashlight indicator on screen
    if (flashlight) {
      const grd = ctx.createRadialGradient(w/2, 380, 0, w/2, 380, 100);
      grd.addColorStop(0, 'rgba(254,240,138,0.3)');
      grd.addColorStop(1, 'rgba(254,240,138,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 280, w, 200);
    }

    // App grid
    const apps = [
      { n: 'Camera', c: '#f59e0b' }, { n: 'Gallery', c: '#10b981' },
      { n: 'Music',  c: '#8b5cf6' }, { n: 'Maps',   c: '#3b82f6' },
      { n: 'Chat',   c: '#ec4899' }, { n: 'Store',  c: '#06b6d4' },
      { n: 'Clock',  c: '#f97316' }, { n: 'Settings',c: '#64748b' },
    ];
    apps.forEach((a, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = 52 + col * 108, y = 420 + row * 130;
      const r = ctx.createLinearGradient(x, y, x+78, y+78);
      r.addColorStop(0, a.c);
      r.addColorStop(1, shadeColor(a.c, -40));
      ctx.fillStyle = r;
      roundRect(ctx, x, y, 78, 78, 20); ctx.fill();
      // Sheen
      const s = ctx.createLinearGradient(x, y, x+78, y+78);
      s.addColorStop(0, 'rgba(255,255,255,0.25)');
      s.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      roundRect(ctx, x, y, 78, 78, 20); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '17px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(a.n, x + 39, y + 100);
    });

    // Dock
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, 36, h - 130, w - 72, 94, 28); ctx.fill();
    [0,1,2,3].forEach(i => {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(80 + i * 90, h - 83, 26, 0, Math.PI * 2);
      ctx.fill();
    });

    // Home indicator
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    roundRect(ctx, w/2 - 50, h - 24, 100, 6, 3); ctx.fill();

    // eslint-disable-next-line react-hooks/immutability
    texture.needsUpdate = true;
  };

  return { texture, update };
}

function shadeColor(hex, pct) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + pct));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + pct));
  const b = Math.min(255, Math.max(0, (num & 0xff) + pct));
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── 3D Phone Model ─────────────────────────────────────────────
// The phone pre-computes the quaternion. PC does ZERO math.
// quaternion.set(x, y, z, w) — that's the entire tracking logic.

function PhoneModel({ battery, flashlight, autoRotate }) {
  const group = useRef();
  const { texture, update } = useScreenTexture();
  const t = useRef(0);

  useFrame((state, delta) => {
    if (!group.current) return;
    t.current += delta;

    if (autoRotate) {
      group.current.rotation.y = Math.sin(t.current * 0.4) * 0.6;
      group.current.rotation.x = Math.sin(t.current * 0.25) * 0.15;
    } else {
      // Re-add high-speed slerp for sub-frame interpolation.
      // Why? If the phone sends at 60Hz but the PC monitor is 120Hz,
      // zero-smoothing means the model holds still for 2 frames then jumps.
      // Speed 45 = almost instant, but smoothly bridges the micro-gaps.
      _targetQ.set(quatRef[0], quatRef[1], quatRef[2], quatRef[3]);
      
      const cur = group.current.quaternion;
      if (cur.dot(_targetQ) < 0) { // Shortest path fix
        _targetQ.set(-_targetQ.x, -_targetQ.y, -_targetQ.z, -_targetQ.w);
      }
      
      // If jump is huge, teleport to avoid trailing
      if (Math.abs(cur.dot(_targetQ)) < 0.5) {
        cur.copy(_targetQ);
      } else {
        const dt = Math.min(delta, 0.05);
        cur.slerp(_targetQ, 1.0 - Math.exp(-45 * dt));
      }
    }

    group.current.position.y = Math.sin(t.current * 1.1) * 0.08;
    update(battery, flashlight);
  });

  return (
    <group ref={group}>
      {/* Body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
        <meshPhysicalMaterial color="#1e293b" metalness={0.65} roughness={0.12}
          clearcoat={1} clearcoatRoughness={0.08} reflectivity={1} />
      </mesh>

      {/* Aluminium frame */}
      <mesh>
        <boxGeometry args={[W + 0.04, H + 0.02, D - 0.12]} />
        <meshStandardMaterial color="#334155" metalness={1} roughness={0.12} />
      </mesh>

      {/* Screen */}
      <group position={[0, 0, D / 2 + 0.008]}>
        <mesh>
          <planeGeometry args={[W - 0.14, H - 0.14]} />
          <meshBasicMaterial map={texture} />
        </mesh>
        {/* Curved edge glow */}
        <mesh position={[W/2 - 0.07, 0, -0.04]} rotation={[0, 0.7, 0]}>
          <planeGeometry args={[0.14, H - 0.14]} />
          <meshBasicMaterial color="#000" transparent opacity={0.6} />
        </mesh>
        <mesh position={[-W/2 + 0.07, 0, -0.04]} rotation={[0, -0.7, 0]}>
          <planeGeometry args={[0.14, H - 0.14]} />
          <meshBasicMaterial color="#000" transparent opacity={0.6} />
        </mesh>
      </group>

      {/* Punch hole selfie cam */}
      <mesh position={[0, H/2 - 0.22, D/2 + 0.012]}>
        <circleGeometry args={[0.055, 32]} />
        <meshBasicMaterial color="#050505" />
      </mesh>

      {/* Camera Module (Vivo V60e vertical strip) */}
      <group position={[-W/2 + 0.56, H/2 - 1.15, -D/2 - 0.04]}>
        <mesh castShadow>
          <boxGeometry args={[0.85, 1.75, 0.09]} />
          <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.15} />
        </mesh>
        <Lens position={[0,  0.5, 0.06]} radius={0.2} />
        <Lens position={[0, -0.1, 0.06]} radius={0.18} />
        {/* LED flash ring */}
        <mesh position={[0, -0.65, 0.06]}>
          <ringGeometry args={[0.09, 0.13, 32]} />
          <meshStandardMaterial
            color={flashlight ? '#fef08a' : '#374151'}
            emissive={flashlight ? '#fef08a' : '#000'}
            emissiveIntensity={flashlight ? 5 : 0} />
        </mesh>
        <mesh position={[0, -0.65, 0.025]}>
          <circleGeometry args={[0.055, 16]} />
          <meshStandardMaterial color={flashlight ? '#fff8dc' : '#111827'} />
        </mesh>
      </group>

      {/* Flashlight cone */}
      {flashlight && (
        <spotLight position={[0, 1.2, -D/2]}
          target-position={[0, 1.2, -20]}
          intensity={6} distance={20} angle={0.28} penumbra={0.8}
          color="#fffde7" castShadow />
      )}

      {/* Volume buttons */}
      {[H/2 - 1.45, H/2 - 1.95].map((y, i) => (
        <mesh key={i} position={[-W/2 - 0.02, y, 0]}>
          <boxGeometry args={[0.055, 0.32, 0.13]} />
          <meshStandardMaterial color="#1e293b" metalness={1} roughness={0.08} />
        </mesh>
      ))}

      {/* Power button */}
      <mesh position={[W/2 + 0.02, H/2 - 1.65, 0]}>
        <boxGeometry args={[0.055, 0.42, 0.13]} />
        <meshStandardMaterial color="#1e293b" metalness={1} roughness={0.08} />
      </mesh>

      {/* Speaker & USB-C */}
      <group position={[0, -H/2 + 0.04, 0]}>
        <mesh rotation={[Math.PI/2, 0, 0]}>
          <cylinderGeometry args={[0.15, 0.15, D * 0.6, 6]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        {[-0.18, -0.06, 0.06, 0.18].map(x => (
          <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI/2, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, D * 0.7, 8]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ── Main PC Dashboard ──────────────────────────────────────────
export default function PCViewer() {
  const [connected,  setConnected]  = useState(false);
  const [ping,       setPing]       = useState(0);
  const [battery,    setBattery]    = useState({ level: 100, charging: false });
  const [flashlight, setFlashlight] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [hapticAnim, setHapticAnim] = useState(false);

  const alphaEl   = useRef();
  const betaEl    = useRef();
  const gammaEl   = useRef();
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io('/', { transports: ['websocket'], upgrade: false });

    socketRef.current.on('connect',    () => { setConnected(true);  setAutoRotate(false); });
    socketRef.current.on('disconnect', () => { setConnected(false); setAutoRotate(true);  });

    socketRef.current.on('battery-update', setBattery);

    // Receive pre-computed quaternion from phone — zero conversion
    socketRef.current.on('q', (buf) => {
      const v = new Float32Array(buf instanceof ArrayBuffer ? buf : buf.buffer ?? buf);
      quatRef[0] = v[0]; quatRef[1] = v[1];
      quatRef[2] = v[2]; quatRef[3] = v[3];
    });

    const pingTimer = setInterval(() => {
      const t0 = Date.now();
      socketRef.current.emit('ping', () => setPing(Date.now() - t0));
    }, 2000);

    return () => { socketRef.current.disconnect(); clearInterval(pingTimer); };
  }, []);

  const toggleFlashlight = () => {
    const next = !flashlight;
    setFlashlight(next);
    socketRef.current?.emit('toggle-flashlight', next);
  };

  const sendHaptic = () => {
    socketRef.current?.emit('vibrate', 250);
    setHapticAnim(true);
    setTimeout(() => setHapticAnim(false), 600);
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh',
      background: '#070b14', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Ambient background glow */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(99,102,241,0.08) 0%, transparent 70%)' }} />

      {/* ── Sidebar ── */}
      <div style={{
        position: 'absolute', top: '1.5rem', left: '1.5rem', zIndex: 10,
        background: 'rgba(10,15,28,0.82)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: '22px',
        padding: '1.5rem', width: '272px', color: 'white',
        boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
        maxHeight: 'calc(100vh - 3rem)', overflowY: 'auto',
        // Custom scrollbar
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent'
      }}>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800',
              background: 'linear-gradient(135deg,#60a5fa,#a855f7)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Vivo V60e
            </h1>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}>3D Gyro Controller</p>
          </div>
          <span style={{ fontSize: '9px', fontWeight: '800', padding: '3px 6px',
            background: 'linear-gradient(135deg,#3b82f6,#6366f1)', borderRadius: '5px', letterSpacing: '0.05em' }}>
            5G
          </span>
        </div>

        {/* Connection Status */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '0.65rem 0.9rem',
          marginBottom: '1.2rem',
          border: `1px solid ${connected ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#10b981' : '#ef4444',
              boxShadow: `0 0 8px ${connected ? '#10b981' : '#ef4444'}`
            }} />
            <span style={{ fontSize: '0.8rem', color: connected ? '#10b981' : '#94a3b8' }}>
              {connected ? 'Device Linked' : 'Waiting...'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>
            <span>{battery.level}%{battery.charging ? ' ⚡' : ''}</span>
            <span>{ping}ms</span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.2rem' }}>
          {/* Flashlight */}
          <button onClick={toggleFlashlight} style={{
            padding: '0.8rem', borderRadius: '12px', fontWeight: '700', cursor: 'pointer',
            border: `1px solid ${flashlight ? 'rgba(234,179,8,0.5)' : 'rgba(255,255,255,0.1)'}`,
            background: flashlight
              ? 'linear-gradient(135deg, rgba(234,179,8,0.35), rgba(251,146,60,0.2))'
              : 'rgba(255,255,255,0.04)',
            color: flashlight ? '#fef08a' : 'rgba(255,255,255,0.7)',
            boxShadow: flashlight ? '0 0 20px rgba(234,179,8,0.2)' : 'none',
            transition: 'all 0.25s cubic-bezier(.4,0,.2,1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            fontFamily: 'inherit', fontSize: '0.88rem',
          }}>
            <span style={{ fontSize: '1rem' }}>🔦</span>
            {flashlight ? 'Torch · ON' : 'Torch · OFF'}
          </button>

          {/* Haptic */}
          <button onClick={sendHaptic} style={{
            padding: '0.8rem', borderRadius: '12px', fontWeight: '700', cursor: 'pointer',
            border: `1px solid ${hapticAnim ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.2)'}`,
            background: hapticAnim ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.06)',
            color: '#fca5a5', transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            fontFamily: 'inherit', fontSize: '0.88rem',
            transform: hapticAnim ? 'scale(0.97)' : 'scale(1)',
          }}>
            🫨 Haptic Pulse
          </button>
        </div>

        {/* Telemetry Graph */}
        <div style={{ marginBottom: '1.2rem' }}>
          <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginBottom: '5px',
            letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Signal Log — Yaw / Pitch / Roll
          </div>
          <div style={{
            height: '72px', borderRadius: '10px', overflow: 'hidden',
            background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.07)'
          }}>
            <TelemetryGraph />
          </div>
        </div>

        {/* Axis Values */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <AxisRow label="Yaw"   color="#60a5fa" valueRef={alphaEl} />
          <AxisRow label="Pitch" color="#f87171" valueRef={betaEl}  />
          <AxisRow label="Roll"  color="#4ade80" valueRef={gammaEl} />
        </div>

        <div style={{ marginTop: '1.2rem', paddingTop: '1rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
          {connected ? `🟢 Binary Stream · ${ping}ms latency` : '⚫ Waiting for device'}
        </div>
      </div>

      {/* ── 3D Canvas ── */}
      <Canvas shadows camera={{ position: [0, 1.5, 9], fov: 38 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}>
        <color attach="background" args={['#070b14']} />
        <fog attach="fog" args={['#070b14', 16, 30]} />

        {/* Lighting */}
        <ambientLight intensity={0.25} />
        <directionalLight position={[4, 8, 6]} intensity={0.9} castShadow
          shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <rectAreaLight position={[3, 4, 3]} intensity={5} width={3} height={3} color="#c4b5fd" />
        <pointLight position={[-4, 2, -3]} color="#60a5fa" intensity={2} />
        <pointLight position={[0, 0, 2]} color="#a855f7"
          intensity={connected ? 1.5 : 0.3} distance={5} />

        <PhoneModel battery={battery} flashlight={flashlight} autoRotate={autoRotate} />

        {/* Floor */}
        <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -3.6, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#07080d" metalness={0.85} roughness={1} />
        </mesh>
      </Canvas>
    </div>
  );
}

function AxisRow({ label, color, valueRef }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem',
        fontSize: '0.78rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color,
          boxShadow: `0 0 6px ${color}88` }} />
        {label}
      </span>
      <span ref={valueRef} style={{ fontWeight: '700', fontSize: '1rem',
        fontVariantNumeric: 'tabular-nums', color: 'white' }}>
        0.0°
      </span>
    </div>
  );
}
