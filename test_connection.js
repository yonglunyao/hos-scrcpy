// Test WebSocket and video reception
const WebSocket = require('ws');

console.log('Testing hos-scrcpy WebSocket connection...\n');

const ws = new WebSocket('ws://localhost:9523/ws/screen/FMR0223B16009134', { 
  binaryType: 'arraybuffer' 
});

let frameCount = 0;
let totalBytes = 0;
let startTime = Date.now();

ws.on('open', () => {
  console.log('✓ WebSocket connected');
  
  // Send screen start message
  ws.send(JSON.stringify({
    type: 'screen',
    sn: 'FMR0223B16009134',
    remoteIp: '127.0.0.1',
    remotePort: '8710'
  }));
  console.log('✓ Sent screen start request');
});

ws.on('message', (data) => {
  const isBinary = Buffer.isBuffer(data);
  if (isBinary) {
    frameCount++;
    totalBytes += data.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (frameCount === 1) {
      console.log(`\n✓ First video frame received!`);
      console.log(`  Size: ${data.length} bytes`);
    } else if (frameCount % 30 === 0) {
      console.log(`  Frames: ${frameCount}, Bytes: ${totalBytes}, Time: ${elapsed}s`);
    }
  } else {
    console.log(`  Text message: ${data.toString()}`);
  }
});

ws.on('error', (err) => {
  console.error(`✗ Error: ${err.message}`);
});

ws.on('close', () => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nWebSocket closed after ${elapsed}s`);
  console.log(`Total frames: ${frameCount}`);
  console.log(`Total bytes: ${totalBytes}`);
  if (frameCount > 0) {
    console.log(`\n✓ VIDEO STREAMING WORKS!`);
  } else {
    console.log(`\n✗ NO VIDEO DATA RECEIVED`);
  }
  process.exit(0);
});

// Timeout after 15 seconds
setTimeout(() => {
  console.log('\nTimeout reached...');
  ws.close();
}, 15000);
