import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, RoundedBox, Environment, MeshReflectorMaterial, Trail } from '@react-three/drei';
import { io } from 'socket.io-client';
import * as THREE from 'three';
import { Activity, Bell } from 'lucide-react';

// Module-level shared state — completely outside React
const gyroRef = new Float32Array(4); // [alpha, beta, gamma, screenAngle]

// Canonical Three.js DeviceOrientationControls algorithm (from Three.js source)
const _zee     = new THREE.Vector3(0, 0, 1);
const _euler   = new THREE.Euler();
const _q0      = new THREE.Quaternion();
const _q1      = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X
const _deviceQ = new THREE.Quaternion();
const _targetQ = new THREE.Quaternion();
const _degToRad = THREE.MathUtils.degToRad;

let yawOffset = 0; // State for zeroing out the forward direction

function deviceOrientationToQuat(out, alpha, beta, gamma, orient) {
  // W3C intrinsic ZXY order → Three.js YXZ
  _euler.set(_degToRad(beta), _degToRad(alpha - yawOffset), -_degToRad(gamma), 'YXZ');
  _deviceQ.setFromEuler(_euler);
  _deviceQ.multiply(_q1);                                    // camera faces out the back
  _q0.setFromAxisAngle(_zee, -_degToRad(orient));            // correct for screen rotation
  _deviceQ.multiply(_q0);
  out.copy(_deviceQ);
}

// Phone dimensions (realistic proportions)
const W = 2.4, H = 5.2, D = 0.38;

// ---------- Live Screen Texture ----------
function useScreenTexture() {
  const canvasRef = useRef(document.createElement('canvas'));
  const textureRef = useRef(null);

  useMemo(() => {
    const c = canvasRef.current;
    c.width = 512; c.height = 1024;
    textureRef.current = new THREE.CanvasTexture(c);
  }, []);

  const update = () => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0f0c29');
    bg.addColorStop(0.5, '#302b63');
    bg.addColorStop(1, '#24243e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Time
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 140px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(timeStr, w / 2, 340);

    // Date
    ctx.font = '42px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    ctx.fillText(dateStr, w / 2, 410);

    // Gyro cards
    const data = [
      { label: 'Alpha', val: gyroRef[0], color: '#3b82f6' },
      { label: 'Beta',  val: gyroRef[1], color: '#ef4444' },
      { label: 'Gamma', val: gyroRef[2], color: '#22c55e' },
    ];
    data.forEach((d, i) => {
      const x = w / 2 - 160, y = 520 + i * 130;
      // Card bg
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(ctx, x, y, 320, 100, 20);
      ctx.fill();
      // Accent
      ctx.fillStyle = d.color;
      roundRect(ctx, x, y, 8, 100, [20, 0, 0, 20]);
      ctx.fill();
      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '28px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(d.label, x + 28, y + 42);
      // Value
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 48px system-ui';
      ctx.fillText(d.val.toFixed(1) + '°', x + 28, y + 86);
    });

    // Pulse dot
    ctx.beginPath();
    ctx.arc(w / 2, h - 70, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.fillStyle = 'rgba(16,185,129,0.3)';
    ctx.beginPath();
    ctx.arc(w / 2, h - 70, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('LIVE', w / 2, h - 25);

    textureRef.current.needsUpdate = true;
  };

  return { texture: textureRef.current, update };
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === 'number') r = [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + r[0], y);
  ctx.lineTo(x + w - r[1], y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r[1]);
  ctx.lineTo(x + w, y + h - r[2]);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
  ctx.lineTo(x + r[3], y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r[3]);
  ctx.lineTo(x, y + r[0]);
  ctx.quadraticCurveTo(x, y, x + r[0], y);
  ctx.closePath();
}

// ---------- Camera Lens ----------
function Lens({ position, radius = 0.22 }) {
  return (
    <group position={position}>
      {/* Outer ring */}
      <mesh>
        <cylinderGeometry args={[radius + 0.05, radius + 0.05, 0.08, 32]} />
        <meshStandardMaterial color="#111827" metalness={0.9} roughness={0.1} />
      </mesh>
      {/* Glass lens */}
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[radius, radius, 0.04, 32]} />
        <meshStandardMaterial color="#1d4ed8" metalness={0.1} roughness={0} transparent opacity={0.85} />
      </mesh>
      {/* Lens glint */}
      <mesh position={[-radius * 0.3, 0.07, radius * 0.3]}>
        <sphereGeometry args={[radius * 0.15, 8, 8]} />
        <meshStandardMaterial color="white" emissive="white" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

// ---------- Phone Model ----------
function PhoneModel() {
  const group = useRef();
  const { texture, update } = useScreenTexture();

  useFrame((state) => {
    if (!group.current) return;
    // Use canonical Three.js DeviceOrientationControls algorithm
    deviceOrientationToQuat(_targetQ, gyroRef[0], gyroRef[1], gyroRef[2], gyroRef[3]);
    group.current.quaternion.slerp(_targetQ, 0.5);
    group.current.position.y = Math.sin(state.clock.elapsedTime * 1.2) * 0.12;
    update();
  });

  return (
    <group ref={group}>
      {/* === BACK BODY (glass) === */}
      <RoundedBox args={[W, H, D]} radius={0.22} smoothness={6} castShadow>
        <meshPhysicalMaterial
          color="#1a1a2e"
          metalness={0.0}
          roughness={0.05}
          transmission={0.08}
          reflectivity={1}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </RoundedBox>

      {/* === METALLIC FRAME (sides) === */}
      <RoundedBox args={[W + 0.04, H + 0.04, D - 0.1]} radius={0.22} smoothness={6}>
        <meshStandardMaterial color="#d1d5db" metalness={1} roughness={0.1} side={THREE.BackSide} />
      </RoundedBox>

      {/* === FRONT SCREEN GLASS === */}
      <mesh position={[0, 0, D / 2 + 0.005]}>
        <planeGeometry args={[W - 0.18, H - 0.22]} />
        <meshPhysicalMaterial
          map={texture}
          metalness={0}
          roughness={0.0}
          clearcoat={1}
          clearcoatRoughness={0.0}
          transparent
          opacity={1}
        />
      </mesh>

      {/* === PUNCH-HOLE CAMERA (front, centered top) === */}
      <mesh position={[0, H / 2 - 0.32, D / 2 + 0.012]}>
        <circleGeometry args={[0.1, 32]} />
        <meshStandardMaterial color="#000000" metalness={0.5} roughness={0} />
      </mesh>

      {/* === CAMERA ISLAND (back) === */}
      <mesh position={[-W / 2 + 0.72, H / 2 - 0.9, -D / 2 - 0.04]} castShadow>
        <boxGeometry args={[1.15, 1.15, 0.08]} />
        <meshStandardMaterial color="#111827" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Rounded mask on camera island */}
      <RoundedBox args={[1.12, 1.12, 0.09]} radius={0.18} smoothness={4}
        position={[-W / 2 + 0.72, H / 2 - 0.9, -D / 2 - 0.038]}>
        <meshStandardMaterial color="#0d1117" metalness={0.9} roughness={0.1} />
      </RoundedBox>

      {/* Triple camera lenses */}
      <Lens position={[-W / 2 + 0.42, H / 2 - 0.68, -D / 2 - 0.04]} />
      <Lens position={[-W / 2 + 1.02, H / 2 - 0.68, -D / 2 - 0.04]} />
      <Lens position={[-W / 2 + 0.42, H / 2 - 1.12, -D / 2 - 0.04]} radius={0.17} />

      {/* Flash */}
      <mesh position={[-W / 2 + 1.01, H / 2 - 1.12, -D / 2 - 0.04]}>
        <cylinderGeometry args={[0.1, 0.1, 0.06, 16]} />
        <meshStandardMaterial color="#fef9c3" emissive="#fef9c3" emissiveIntensity={0.5} />
      </mesh>

      {/* === VOLUME BUTTONS (left side) === */}
      <RoundedBox args={[0.06, 0.35, 0.14]} radius={0.025} smoothness={4}
        position={[-W / 2 - 0.025, H / 2 - 1.5, 0]}>
        <meshStandardMaterial color="#9ca3af" metalness={1} roughness={0.1} />
      </RoundedBox>
      <RoundedBox args={[0.06, 0.35, 0.14]} radius={0.025} smoothness={4}
        position={[-W / 2 - 0.025, H / 2 - 2.05, 0]}>
        <meshStandardMaterial color="#9ca3af" metalness={1} roughness={0.1} />
      </RoundedBox>

      {/* === POWER BUTTON (right side) === */}
      <RoundedBox args={[0.06, 0.45, 0.14]} radius={0.025} smoothness={4}
        position={[W / 2 + 0.025, H / 2 - 1.7, 0]}>
        <meshStandardMaterial color="#9ca3af" metalness={1} roughness={0.1} />
      </RoundedBox>

      {/* === SPEAKER GRILLE (bottom) === */}
      {[-0.25, -0.1, 0.05, 0.2, 0.35].map((x, i) => (
        <mesh key={i} position={[x, -H / 2 + 0.1, D / 2 - 0.01]}>
          <cylinderGeometry args={[0.025, 0.025, 0.05, 8]} rotation={[Math.PI / 2, 0, 0]} />
          <meshStandardMaterial color="#374151" />
        </mesh>
      ))}

      {/* === USB-C PORT (bottom center) === */}
      <mesh position={[0, -H / 2 + 0.05, 0]}>
        <boxGeometry args={[0.38, 0.1, D * 0.5]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
    </group>
  );
}

export default function PCViewer() {
  const [connected, setConnected] = useState(false);
  const alphaEl = useRef();
  const betaEl  = useRef();
  const gammaEl = useRef();
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = io('/', { transports: ['websocket'], upgrade: false });
    
    socketRef.current.on('connect',    () => setConnected(true));
    socketRef.current.on('disconnect', () => setConnected(false));

    socketRef.current.on('reset-yaw', () => {
        yawOffset = gyroRef[0]; // Set current alpha as the new zero
    });

    socketRef.current.on('gyro-data', (buf) => {
      const view = new Float32Array(buf instanceof ArrayBuffer ? buf : buf.buffer ?? buf);
      gyroRef[0] = view[0]; // alpha
      gyroRef[1] = view[1]; // beta
      gyroRef[2] = view[2]; // gamma
      gyroRef[3] = view[3] ?? 0; // screen orientation angle
      if (alphaEl.current) alphaEl.current.textContent = gyroRef[0].toFixed(1) + '°';
      if (betaEl.current)  betaEl.current.textContent  = gyroRef[1].toFixed(1) + '°';
      if (gammaEl.current) gammaEl.current.textContent = gyroRef[2].toFixed(1) + '°';
    });
    return () => socketRef.current.disconnect();
  }, []);

  const pingPhone = () => {
    socketRef.current?.emit('ping-phone');
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0a0a14', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        position: 'absolute', top: '2rem', left: '2rem', zIndex: 10,
        background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px',
        padding: '1.8rem', width: '280px', color: 'white', fontFamily: 'sans-serif',
        pointerEvents: 'none', boxShadow: '0 25px 50px rgba(0,0,0,0.5)'
      }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', background: 'linear-gradient(135deg,#60a5fa,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Device Telemetry
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem 0 1.5rem', color: connected ? '#10b981' : '#ef4444', fontSize: '0.82rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', display: 'inline-block', boxShadow: '0 0 8px currentColor' }} />
          {connected ? 'Receiving Live Data' : 'Waiting for connection...'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <AxisRow label="Alpha (Yaw)"  color="#3b82f6" valueRef={alphaEl} />
          <AxisRow label="Beta (Pitch)" color="#ef4444" valueRef={betaEl}  />
          <AxisRow label="Gamma (Roll)" color="#22c55e" valueRef={gammaEl} />
        </div>

        <button 
          onClick={pingPhone}
          style={{
            marginTop: '1.5rem', width: '100%', padding: '0.8rem', borderRadius: '12px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            cursor: 'pointer', pointerEvents: 'auto', transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
        >
          <Bell size={18} /> Ping Phone
        </button>

        <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
          Binary WebSocket · 60 FPS
        </div>
      </div>

      {/* 3D Canvas */}
      <Canvas shadows camera={{ position: [0, 2, 10], fov: 40 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}>
        <color attach="background" args={['#0a0a14']} />
        <fog attach="fog" args={['#0a0a14', 14, 28]} />

        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 10, 7]} intensity={1.2} castShadow
          shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <rectAreaLight position={[3, 4, 3]} intensity={4} width={3} height={3} color="#c4b5fd" />
        <pointLight position={[-5, 2, -3]} color="#60a5fa" intensity={1.5} />
        <pointLight position={[4, -2, 4]} color="#a855f7" intensity={1} />
        <pointLight position={[0, -3, 5]} color="#1d4ed8" intensity={0.5} />

        <Environment preset="city" />

        <Trail width={1.5} length={5} color="#6366f1" attenuation={(t) => t * t}>
          <PhoneModel />
        </Trail>

        {/* Reflective floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.5, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <MeshReflectorMaterial
            blur={[400, 100]} resolution={512} mixBlur={1} mixStrength={20}
            roughness={1} depthScale={1.2} minDepthThreshold={0.4} maxDepthThreshold={1.4}
            color="#0a0a14" metalness={0.8}
          />
        </mesh>

        <ContactShadows position={[0, -3.49, 0]} opacity={0.8} scale={15} blur={3} far={5} />
      </Canvas>
    </div>
  );
}

function AxisRow({ label, color, valueRef }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '0.7rem' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        {label}
      </span>
      <span ref={valueRef} style={{ fontWeight: '700', fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums', color: 'white' }}>
        0.0°
      </span>
    </div>
  );
}
