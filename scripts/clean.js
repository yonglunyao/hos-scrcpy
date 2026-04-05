const fs = require('fs');
const path = require('path');

const dirs = [
  'dist',
  'package',
  'coverage',
  'test-results',
  'playwright-report',
];

let cleaned = [];

for (const dir of dirs) {
  const dirPath = path.join(process.cwd(), dir);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    cleaned.push(dir);
  }
}

if (cleaned.length > 0) {
  console.log('Cleaned: ' + cleaned.join(', '));
} else {
  console.log('Already clean');
}
