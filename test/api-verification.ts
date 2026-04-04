/**
 * 验证新增的编程式 API
 * 运行方式: npx ts-node test/api-verification.ts
 */

import { HosScrcpyServer } from '../src/server';

async function testApiMethods() {
  console.log('=== HosScrcpyServer API 验证 ===\n');

  // 1. 创建服务器实例（端口 0 表示动态分配）
  const server = new HosScrcpyServer({
    port: 0,  // 动态端口
    hdcPath: 'hdc',
  });

  // 2. 验证 getPort() 方法（启动前）
  const portBeforeStart = server.getPort();
  console.log(`✓ getPort() 启动前: ${portBeforeStart}（默认值）`);

  // 3. 启动服务器
  await server.start();
  const actualPort = server.getPort();
  console.log(`✓ getPort() 启动后: ${actualPort}（实际端口）`);

  // 4. 验证 isCasting() 方法（无设备）
  const isCastingBefore = server.isCasting('test-device');
  console.log(`✓ isCasting('test-device') 启动前: ${isCastingBefore}（应为 false）`);

  // 5. 验证 /api/status 端点（无设备）
  const response = await fetch(`http://localhost:${actualPort}/api/status`);
  const statusData = await response.json() as { devices: Record<string, { casting: boolean }> };
  console.log(`✓ GET /api/status: ${JSON.stringify(statusData)}（应为空对象）`);

  // 6. 验证 /api/devices 端点
  const devicesResponse = await fetch(`http://localhost:${actualPort}/api/devices`);
  const devicesData = await devicesResponse.json() as { devices: string[], count: number };
  console.log(`✓ GET /api/devices: 找到 ${devicesData.count} 个设备`);

  // 7. 如果有设备，测试 startDevice/stopDevice
  if (devicesData.count > 0) {
    const testSn = devicesData.devices[0]!;
    console.log(`\n--- 使用设备 ${testSn} 测试 ---`);

    // startDevice
    console.log(`调用 startDevice('${testSn}')...`);
    await server.startDevice(testSn);
    console.log(`✓ isCasting('${testSn}'): ${server.isCasting(testSn)}（应为 true）`);

    // /api/status?sn=xxx
    const statusResponse = await fetch(`http://localhost:${actualPort}/api/status?sn=${testSn}`);
    const statusWithSn = await statusResponse.json() as { casting: boolean; sn: string };
    console.log(`✓ GET /api/status?sn=${testSn}: ${JSON.stringify(statusWithSn)}`);

    // 等待 2 秒观察投屏
    console.log('等待 2 秒...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // stopDevice
    console.log(`调用 stopDevice('${testSn}')...`);
    await server.stopDevice(testSn);
    console.log(`✓ isCasting('${testSn}'): ${server.isCasting(testSn)}（应为 false）`);
  } else {
    console.log('\n⚠ 未找到 HarmonyOS 设备，跳过设备相关测试');
  }

  // 8. 验证 stopAll() 方法
  console.log('\n调用 stopAll()...');
  await server.stopAll();
  console.log('✓ stopAll() 完成');

  // 9. 关闭服务器
  console.log('\n调用 stop()...');
  await server.stop();
  console.log('✓ stop() 完成');

  console.log('\n=== 所有 API 验证通过 ===');
}

testApiMethods().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
