import React, { useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { motion } from 'framer-motion';
import { Activity, Radio, WifiOff } from 'lucide-react';

export default function PhoneController() {
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('Tap to Start');
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const rafRef     = useRef(null);
  const latestRef  = useRef(null); // stores latest event, read by rAF
  const alphaEl    = useRef();
  const betaEl     = useRef();
  const gammaEl    = useRef();

  // Pre-allocate: [alpha, beta, gamma, screenOrientAngle] — reused every frame
  const sendBuffer = new Float32Array(4);

  const startConnection = async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') { alert('Permission denied'); return; }
      } catch (err) { console.error(err); return; }
    }

    setPhase('streaming');

    socketRef.current = io(window.location.origin, {
      transports: ['websocket'],
      upgrade: false,
      reconnectionDelay: 100,
    });

    socketRef.current.on('connect', () => {
      setConnected(true);
      setStatus('Live · ' + socketRef.current.id.slice(0, 6));
    });
    socketRef.current.on('connect_error', (e) => setStatus('Error: ' + e.message));
    socketRef.current.on('disconnect', (r) => { setConnected(false); setStatus('Disconnected: ' + r); });

    // Handle Incoming Pings from PC
    socketRef.current.on('haptic-ping', () => {
      if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200]);
      document.body.style.transition = 'background-color 0.1s';
      document.body.style.backgroundColor = '#7f1d1d';
      setTimeout(() => { document.body.style.backgroundColor = ''; }, 300);
    });

    let lastX = 0, lastY = 0, lastZ = 0;
    // New: Shake to Reset Forward Direction
    window.addEventListener('devicemotion', (e) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const delta = Math.abs(acc.x - lastX) + Math.abs(acc.y - lastY) + Math.abs(acc.z - lastZ);
      if (delta > 35) { // Shake threshold
          socketRef.current?.emit('reset-yaw');
          if (window.navigator?.vibrate) window.navigator.vibrate(50);
      }
      lastX = acc.x; lastY = acc.y; lastZ = acc.z;
    });

    // Store the latest sensor reading — no processing here
    window.addEventListener('deviceorientation', (e) => { latestRef.current = e; });

    // rAF loop — synced to screen refresh rate (60fps on most phones)
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const e = latestRef.current;
      if (!e || e.alpha === null) return;
      latestRef.current = null; // consume it

      const { alpha, beta, gamma } = e;

      // Direct DOM update — no React re-render
      if (alphaEl.current) alphaEl.current.textContent = alpha.toFixed(1) + '°';
      if (betaEl.current)  betaEl.current.textContent  = beta.toFixed(1)  + '°';
      if (gammaEl.current) gammaEl.current.textContent = gamma.toFixed(1) + '°';

      // Binary Float32 transport: 16 bytes (4 floats instead of 50-byte JSON)
      if (socketRef.current?.connected) {
        sendBuffer[0] = alpha;
        sendBuffer[1] = beta;
        sendBuffer[2] = gamma;
        sendBuffer[3] = window.screen.orientation?.angle ?? 0; // 0=portrait, 90=landscape
        socketRef.current.volatile.emit('gyro-data', sendBuffer.buffer.slice(0));
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 50% -20%, #1e1b4b, #0f172a)',
      color: 'white', fontFamily: 'system-ui, sans-serif', padding: '2rem',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
    }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px',
          padding: '2rem', width: '100%', maxWidth: '400px', textAlign: 'center',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
        }}>

        <h1 style={{ margin: 0, fontSize: '1.8rem', background: 'linear-gradient(135deg, #a855f7, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Mobile Node
        </h1>

        {phase === 'idle' ? (
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={startConnection}
            style={{
              marginTop: '2rem', background: '#6366f1', color: 'white', border: 'none',
              padding: '1rem 2rem', fontSize: '1.2rem', borderRadius: '50px', width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              cursor: 'pointer', fontFamily: 'inherit'
            }}>
            <Activity size={20} /> Start Sensors
          </motion.button>
        ) : (
          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: connected ? '#10b981' : '#ef4444', marginBottom: '2rem', fontSize: '0.9rem' }}>
              {connected ? <Radio size={18} /> : <WifiOff size={18} />}
              <span>{status}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <DataRow label="Alpha (Z)" color="#3b82f6" valueRef={alphaEl} />
              <DataRow label="Beta  (X)" color="#ef4444" valueRef={betaEl} />
              <DataRow label="Gamma (Y)" color="#22c55e" valueRef={gammaEl} />
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function DataRow({ label, color, valueRef }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '16px' }}>
      <span style={{ color: '#cbd5e1', fontSize: '0.9rem', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
        {label}
      </span>
      <span ref={valueRef} style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'white', fontVariantNumeric: 'tabular-nums' }}>0.0°</span>
    </div>
  );
}
