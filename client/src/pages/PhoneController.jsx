import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Radio, WifiOff, Zap } from 'lucide-react';

// ── Inline Quaternion Math (no Three.js dependency) ──────────
// Replicates Three.js deviceOrientationToQuat exactly.
const S = Math.SQRT1_2; // 0.7071…
const DEG = Math.PI / 180;

// Quaternion multiply: out = a * b
function qMul(ax, ay, az, aw, bx, by, bz, bw) {
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function eulerYXZToQuat(ex, ey, ez) {
  const c1 = Math.cos(ex / 2), s1 = Math.sin(ex / 2);
  const c2 = Math.cos(ey / 2), s2 = Math.sin(ey / 2);
  const c3 = Math.cos(ez / 2), s3 = Math.sin(ez / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

// Full pipeline: Euler angles → Three.js-ready quaternion
// Screen is portrait-locked so orient=0 (skip that multiply)
function orientToQuat(alpha, beta, gamma) {
  // Step 1: Euler(beta, alpha, -gamma) in YXZ order
  const [qx, qy, qz, qw] = eulerYXZToQuat(beta * DEG, alpha * DEG, -gamma * DEG);
  // Step 2: Right-multiply by _q1 = (-S, 0, 0, S) — camera faces out the back
  return qMul(qx, qy, qz, qw, -S, 0, 0, S);
}

export default function PhoneController() {
  const [phase, setPhase]           = useState('idle');
  const [status, setStatus]         = useState('Ready to link');
  const [connected, setConnected]   = useState(false);
  const [localTorch, setLocalTorch] = useState(false);
  const [sensorHz, setSensorHz]     = useState(0);
  const [sensorType, setSensorType] = useState('—');

  const socketRef      = useRef(null);
  const torchTrackRef  = useRef(null);
  const hiddenVideoRef = useRef(null);
  const alphaEl        = useRef();
  const betaEl         = useRef();
  const gammaEl        = useRef();
  const hzCounter      = useRef(0);
  const sendBuf        = useRef(new Float32Array(4)); // [qx, qy, qz, qw]
  const hzTimerRef     = useRef(null);
  const orientationHandlerRef = useRef(null);
  const batteryStateRef = useRef({ battery: null, send: null });
  const isStartingRef  = useRef(false);

  const initTorch = async () => {
    try {
      if (!hiddenVideoRef.current) {
        hiddenVideoRef.current = document.createElement('video');
        hiddenVideoRef.current.setAttribute('playsinline', '');
        hiddenVideoRef.current.muted = true;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      hiddenVideoRef.current.srcObject = stream;
      await hiddenVideoRef.current.play();
      torchTrackRef.current = stream.getVideoTracks()[0];
    } catch (e) {
      console.warn('Torch unavailable:', e.message);
    }
  };

  const toggleLocalTorch = async () => {
    const track = torchTrackRef.current;
    if (!track) return;
    const next = !localTorch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setLocalTorch(next);
    } catch (e) { console.warn('Torch toggle failed:', e); }
  };

  const stopConnection = () => {
    if (orientationHandlerRef.current) {
      window.removeEventListener('deviceorientation', orientationHandlerRef.current);
      orientationHandlerRef.current = null;
    }

    const { battery, send } = batteryStateRef.current;
    if (battery && send) {
      battery.removeEventListener('levelchange', send);
      battery.removeEventListener('chargingchange', send);
    }
    batteryStateRef.current = { battery: null, send: null };

    if (hzTimerRef.current) {
      clearInterval(hzTimerRef.current);
      hzTimerRef.current = null;
    }

    const sock = socketRef.current;
    if (sock) {
      sock.removeAllListeners();
      sock.disconnect();
      socketRef.current = null;
    }

    const track = torchTrackRef.current;
    if (track) {
      track.stop();
      torchTrackRef.current = null;
    }

    if (hiddenVideoRef.current?.srcObject) {
      const stream = hiddenVideoRef.current.srcObject;
      stream.getTracks().forEach((t) => t.stop());
      hiddenVideoRef.current.srcObject = null;
    }

    setConnected(false);
  };

  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, []);

  // ── Common send function ─────────────────────────────────────
  const sendQuat = (sock, qx, qy, qz, qw, a, b, g) => {
    hzCounter.current++;
    if (alphaEl.current) alphaEl.current.textContent = a.toFixed(1) + '°';
    if (betaEl.current)  betaEl.current.textContent  = b.toFixed(1) + '°';
    if (gammaEl.current) gammaEl.current.textContent = g.toFixed(1) + '°';
    if (sock.connected) {
      const buf = sendBuf.current;
      buf[0] = qx; buf[1] = qy; buf[2] = qz; buf[3] = qw;
      sock.volatile.emit('q', buf); // Typed arrays are transferable and avoid extra copies.
    }
  };

  // ── Start connection ─────────────────────────────────────────
  const startConnection = async () => {
    if (isStartingRef.current || socketRef.current?.connected) return;
    isStartingRef.current = true;

    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') {
          alert('Motion permission denied');
          isStartingRef.current = false;
          return;
        }
      } catch {
        setStatus('Motion permission unavailable');
        isStartingRef.current = false;
        return;
      }
    }

    setPhase('streaming');
    setStatus('Initialising...');
    // Safely lock orientation — throws on Mobile Chrome if not full screen
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('portrait').catch(e => console.warn('Orientation lock skipped:', e));
      }
    } catch (e) {
      console.warn('Orientation lock failed:', e);
    }

    stopConnection();
    await initTorch();

    const sock = io(window.location.origin, {
      transports: ['websocket'],
      upgrade: false,
      reconnectionDelay: 200,
    });
    socketRef.current = sock;

    sock.on('connect', () => {
      setConnected(true);
      setStatus('Linked · ' + sock.id.slice(0, 8));
    });
    sock.on('disconnect', () => { setConnected(false); setStatus('Disconnected'); });
    sock.on('connect_error', (e) => setStatus('Error: ' + e.message));

    sock.on('toggle-flashlight', async (state) => {
      const track = torchTrackRef.current;
      if (!track) return;
      try {
        await track.applyConstraints({ advanced: [{ torch: state }] });
        setLocalTorch(state);
      } catch (e) {
        console.warn('Remote torch toggle failed:', e);
      }
    });

    sock.on('vibrate', (ms) => {
      if (navigator.vibrate) navigator.vibrate(ms || 250);
    });

    // The most bulletproof API that works across all mobile browsers
    const onDeviceOrientation = (e) => {
      if (e.alpha === null || e.alpha === undefined) return;
      if (e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return;
      const [qx, qy, qz, qw] = orientToQuat(e.alpha, e.beta, e.gamma);
      sendQuat(sock, qx, qy, qz, qw, e.alpha, e.beta, e.gamma);
    };
    orientationHandlerRef.current = onDeviceOrientation;
    window.addEventListener('deviceorientation', onDeviceOrientation);
    setSensorType('DeviceOrientation Tracking');

    // Battery
    if (typeof navigator.getBattery === 'function') {
      try {
        const bat = await navigator.getBattery();
        const send = () => sock.emit('battery-update', {
          level: Math.floor(bat.level * 100), charging: bat.charging
        });
        send();
        bat.addEventListener('levelchange', send);
        bat.addEventListener('chargingchange', send);
        batteryStateRef.current = { battery: bat, send };
      } catch (e) {
        console.warn('Battery API unavailable:', e);
      }
    }

    // Hz counter
    hzTimerRef.current = setInterval(() => {
      setSensorHz(hzCounter.current);
      hzCounter.current = 0;
    }, 1000);

    isStartingRef.current = false;
  };

  const btnBase = {
    padding: '0.85rem', borderRadius: '14px', fontWeight: '700',
    cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
    fontFamily: 'inherit', width: '100%', border: 'none',
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
      color: 'white', fontFamily: "'Inter', system-ui, sans-serif",
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '1.5rem', boxSizing: 'border-box'
    }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{
          background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: '28px',
          padding: '2rem', width: '100%', maxWidth: '380px',
          boxShadow: '0 30px 60px rgba(0,0,0,0.6)'
        }}>

        <div style={{ textAlign: 'center', marginBottom: '1.8rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, borderRadius: '16px', marginBottom: '0.8rem',
            background: 'linear-gradient(135deg,#6366f1,#a855f7)',
            boxShadow: '0 8px 24px rgba(99,102,241,0.4)'
          }}>
            <Activity size={26} color="white" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800',
            background: 'linear-gradient(135deg, #a78bfa, #60a5fa)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Sensor Bridge
          </h1>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
            Vivo V60e · Zero-Latency Pipeline
          </p>
        </div>

        <AnimatePresence mode="wait">
          {phase === 'idle' ? (
            <motion.div key="idle"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={startConnection}
                style={{
                  ...btnBase,
                  background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                  color: 'white', fontSize: '1.05rem', padding: '1.1rem',
                  boxShadow: '0 12px 30px rgba(99,102,241,0.4)'
                }}>
                <Activity size={20} /> Start Sensors
              </motion.button>
            </motion.div>
          ) : (
            <motion.div key="active"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'rgba(0,0,0,0.25)', borderRadius: '12px', padding: '0.75rem 1rem',
                marginBottom: '0.8rem', border: `1px solid ${connected ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {connected ? <Radio size={16} color="#10b981" /> : <WifiOff size={16} color="#ef4444" />}
                  <span style={{ fontSize: '0.85rem', color: connected ? '#10b981' : '#ef4444' }}>{status}</span>
                </div>
                {connected && (
                  <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)',
                    background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '20px' }}>
                    {sensorHz} Hz
                  </span>
                )}
              </div>

              {/* Sensor type badge */}
              <div style={{
                textAlign: 'center', fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)',
                marginBottom: '1rem', letterSpacing: '0.05em'
              }}>
                {sensorType}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <motion.button whileTap={{ scale: 0.97 }} onClick={toggleLocalTorch}
                  style={{
                    ...btnBase,
                    background: localTorch
                      ? 'linear-gradient(135deg, rgba(234,179,8,0.5), rgba(251,146,60,0.3))'
                      : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${localTorch ? 'rgba(234,179,8,0.6)' : 'rgba(255,255,255,0.1)'}`,
                    color: localTorch ? '#fef08a' : 'rgba(255,255,255,0.7)',
                    boxShadow: localTorch ? '0 0 24px rgba(234,179,8,0.25)' : 'none'
                  }}>
                  <Zap size={18} fill={localTorch ? '#fef08a' : 'none'} />
                  {localTorch ? 'Torch ON' : 'Test Torch'}
                </motion.button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.4rem' }}>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Live Orientation
                  </div>
                  <DataRow label="Yaw (Z)"   color="#3b82f6" valueRef={alphaEl} />
                  <DataRow label="Pitch (X)" color="#ef4444" valueRef={betaEl}  />
                  <DataRow label="Roll (Y)"  color="#22c55e" valueRef={gammaEl} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function DataRow({ label, color, valueRef }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      background: 'rgba(0,0,0,0.2)', padding: '0.65rem 0.9rem', borderRadius: '10px'
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#94a3b8' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        {label}
      </span>
      <span ref={valueRef} style={{ fontWeight: '700', fontSize: '1rem', color: 'white', fontVariantNumeric: 'tabular-nums' }}>
        0.0°
      </span>
    </div>
  );
}
