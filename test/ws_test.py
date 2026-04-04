#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WebSocket Test Script - Verify hos-scrcpy server functionality"""

import asyncio
import websockets
import json
import sys
import io
import urllib.request

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SERVER_URL = "ws://localhost:9523"
DEVICE_SN = "FMR0223B16009134"

async def test_device_list():
    """Test 1: Get device list"""
    print("\n=== Test 1: Device List ===")
    try:
        with urllib.request.urlopen(f"http://localhost:9523/api/devices") as response:
            data = json.loads(response.read().decode())
            print(f"[OK] Devices: {data}")
            return data.get("devices", [])
    except Exception as e:
        print(f"[ERROR] {e}")
        return []

async def test_websocket_connect():
    """Test 2: WebSocket connection and message stream"""
    print("\n=== Test 2: WebSocket Screen Cast ===")
    uri = f"{SERVER_URL}/ws/screen/{DEVICE_SN}"
    print(f"Connecting to: {uri}")

    try:
        async with websockets.connect(uri) as ws:
            print("[OK] WebSocket connected")

            # Send screen cast request
            screen_msg = json.dumps({
                "type": "screen",
                "sn": DEVICE_SN,
                "remoteIp": "127.0.0.1",
                "remotePort": "8710"
            })
            print(f"[SEND] {screen_msg}")
            await ws.send(screen_msg)

            message_count = 0
            max_messages = 50
            timeout = 20

            video_data_count = 0
            total_video_bytes = 0

            try:
                while message_count < max_messages:
                    msg = await asyncio.wait_for(ws.recv(), timeout=timeout)

                    # Handle both text (JSON) and binary messages
                    if isinstance(msg, bytes):
                        message_count += 1
                        video_data_count += 1
                        total_video_bytes += len(msg)
                        print(f"[MSG #{message_count}] Binary data: {len(msg)} bytes (total video: {video_data_count} frames, {total_video_bytes} bytes)")

                        # Check if it looks like H.264 data (starts with 00 00 00 01 or 00 00 01)
                        hex_start = msg[:4].hex()
                        if hex_start.startswith('000001') or hex_start.startswith('00000001'):
                            print(f"  -> H.264 NALU detected!")
                    else:
                        # Try to parse as JSON
                        try:
                            data = json.loads(msg)
                            msg_type = data.get("type", "unknown")
                            message_count += 1
                            print(f"[MSG #{message_count}] type={msg_type}")

                            if msg_type == "ready":
                                w = data.get('width')
                                h = data.get('height')
                                print(f"  -> Screen size: {w}x{h}")
                            elif msg_type == "data":
                                video_data = data.get("data", "")
                                video_len = len(video_data)
                                video_data_count += 1
                                total_video_bytes += video_len
                                print(f"  -> H.264 data: {video_len} bytes (total: {video_data_count} frames, {total_video_bytes} bytes)")
                            elif msg_type == "error":
                                print(f"  [ERROR] {data.get('message')}")
                            elif msg_type == "close":
                                print(f"  [INFO] Stream closed")
                                break
                        except json.JSONDecodeError:
                            message_count += 1
                            print(f"[MSG #{message_count}] Non-JSON text: {msg[:100]}")

                    if video_data_count >= 10:
                        print(f"\n[SUCCESS] Video streaming working! ({video_data_count} frames, {total_video_bytes} bytes)")
                        return True

            except asyncio.TimeoutError:
                print(f"[WARN] No messages for {timeout}s")

            print(f"\n[SUMMARY] Received {message_count} messages, {video_data_count} video frames, {total_video_bytes} bytes")
            return video_data_count > 0

    except Exception as e:
        print(f"[ERROR] WebSocket: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    print("=" * 50)
    print("hos-scrcpy WebSocket Test")
    print("=" * 50)

    # Test 1: Device list
    devices = await test_device_list()

    if not devices:
        print("\n[WARN] No devices found, check HDC connection")
        return

    # Test 2: WebSocket screen casting
    result = await test_websocket_connect()

    print("\n" + "=" * 50)
    if result:
        print("[PASS] Test completed - video streaming works!")
    else:
        print("[FAIL] Test failed - no video data received")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(main())
