const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读取 package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

// 创建 package 目录
const packageDir = path.join(process.cwd(), 'package');
if (!fs.existsSync(packageDir)) {
  fs.mkdirSync(packageDir, { recursive: true });
}

console.log(`\n📦 Packing ${pkg.name}@${pkg.version}...`);

// 运行 npm pack
try {
  execSync('npm pack --pack-destination package', {
    stdio: 'inherit',
    shell: true
  });

  // 查找生成的 tgz 文件
  const files = fs.readdirSync(packageDir);
  const tgzFile = files.find(f => f.endsWith('.tgz'));

  if (tgzFile) {
    const tgzPath = path.join(packageDir, tgzFile);
    const stats = fs.statSync(tgzPath);
    const sizeKB = (stats.size / 1024).toFixed(1);

    console.log('\n✓ Package created:');
    console.log(`  File: package/${tgzFile}`);
    console.log(`  Version: ${pkg.version}`);
    console.log(`  Size: ${sizeKB} KB`);
  }
} catch (err) {
  console.error('Pack failed:', err.message);
  process.exit(1);
}
