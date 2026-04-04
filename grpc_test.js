const grpc = require('@grpc/grpc-js');

let frameCount = 0, totalBytes = 0, startTime = null;

console.log('Connecting to 127.0.0.1:19012...');
const client = new grpc.Client('127.0.0.1:19012', grpc.credentials.createInsecure(), {
  'grpc.max_receive_message_length': 104857600,
});

console.log('Calling /ScrcpyService/onStart...');
const call = client.makeServerStreamRequest(
  '/ScrcpyService/onStart',
  function serialize(v) { return Buffer.alloc(0); },
  function deserialize(buf) { return buf; },
  {}
);

call.on('data', function(data) {
  if (!startTime) startTime = Date.now();
  frameCount++;
  totalBytes += data.length;
  if (frameCount <= 5) {
    console.log('Frame #' + frameCount + ':', data.length, 'bytes');
    console.log('  hex:', data.toString('hex').substring(0, 100));
  }
  if (frameCount % 50 === 0) {
    console.log('  ... #' + frameCount + ', ' + totalBytes + ' bytes');
  }
});

call.on('error', function(err) {
  console.error('gRPC error:', err.code, err.message);
});

call.on('end', function() {
  var elapsed = startTime ? Date.now() - startTime : 'N/A';
  console.log('Stream ended. Frames:', frameCount, 'Bytes:', totalBytes, 'Elapsed:', elapsed + 'ms');
  client.close();
});

call.on('status', function(status) {
  console.log('Status:', status.code, status.details);
});

setTimeout(function() {
  console.log('Timeout. Frames:', frameCount, 'Bytes:', totalBytes);
  call.cancel();
  client.close();
  process.exit(0);
}, 12000);
