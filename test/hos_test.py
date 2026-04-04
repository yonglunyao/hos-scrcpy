#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test hos-scrcpy with jar proxy"""

import asyncio
import websockets
import json

# hos-scrcpy 现在运行在 9523 端口
HOS_URL = "ws://localhost:9523/ws/screen/FMR0223B16009134"

async def test_video():
    print("Connecting to hos-scrcpy:", HOS_URL)

    async with websockets.connect(HOS_URL) as ws:
        print("Connected!")

        # 发送投屏请求
        msg = json.dumps({
            "type": "screen",
            "sn": "FMR0223B16009134",
            "remoteIp": "127.0.0.1",
            "remotePort": "8710"
        })
        print("Sending:", msg)
        await ws.send(msg)

        frame_count = 0
        total_bytes = 0

        try:
            while True:
                data = await asyncio.wait_for(ws.recv(), timeout=15)

                if isinstance(data, bytes):
                    frame_count += 1
                    total_bytes += len(data)
                    print(f"Frame #{frame_count}: {len(data)} bytes")

                    if frame_count >= 10:
                        print(f"\nSUCCESS! hos-scrcpy + JAR proxy works!")
                        print(f"Received {frame_count} frames, {total_bytes} bytes")
                        return True
                else:
                    print(f"Text message: {data[:100] if len(data) > 100 else data}")

        except asyncio.TimeoutError:
            pass

    print(f"Received {frame_count} frames, {total_bytes} bytes")
    return frame_count > 0

asyncio.run(test_video())