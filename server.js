const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

// Catch all errors so the server never crashes
process.on('uncaughtException', (err) => console.error('Caught exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

console.log('Generating strong SSL certificate for Router Method...');

const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
const interfaces = os.networkInterfaces();
for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
            altNames.push({ type: 7, ip: alias.address });
        }
    }
}

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 30,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }]
});

const httpServer = http.createServer(app);
const httpsServer = https.createServer({
    key: pems.private,
    cert: pems.cert,
    minVersion: 'TLSv1.2'
}, app);

const io = new Server();
io.attach(httpServer, { cors: { origin: '*' } });
io.attach(httpsServer, { cors: { origin: '*' } });

// React Router fallback - send all other requests to index.html
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

io.on('connection', (socket) => {
    socket.on('gyro-data', (data) => socket.volatile.broadcast.emit('gyro-data', data));
    
    // Bidirectional: PC can send a ping to the phone
    socket.on('ping-phone', () => {
        socket.broadcast.emit('haptic-ping');
    });
});

const HTTP_PORT = 3000;
const HTTPS_PORT = 3001;

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`\n================================`);
    console.log(`HTTP Server running on port ${HTTP_PORT}`);
    console.log(`[PC BROWSER ONLY] --> http://localhost:${HTTP_PORT}/pc`);
});

httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`================================`);
    console.log(`HTTPS Server running on port ${HTTPS_PORT}`);
    console.log('\n--- ZERO-LATENCY ROUTER METHOD FOR PHONE ---');
    console.log('Warning: This ONLY works if your Phone and PC are on the EXACT SAME HOME WI-FI Router.');
    console.log('Mobile Data MUST be off. Mobile Hotspots will BLOCK this.');
    console.log('When you click the link, tap "Advanced -> Accept Risk"');
    console.log('--------------------------------------------------\n');
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                console.log(`👉 https://${alias.address}:${HTTPS_PORT}/phone 👈`);
            }
        }
    }
});
