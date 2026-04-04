#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test UiTest image mode - alternative to video streaming"""

import asyncio
import websockets
import json
import sys
import io
import base64

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SERVER_URL = "ws://localhost:9523"
DEVICE_SN = "FMR0223B16009134"

async def test_uitest_mode():
    """Test UiTest image capture mode"""
    print("\n=== UiTest Image Mode Test ===")
    uri = f"{SERVER_URL}/ws/uitest/{DEVICE_SN}"
    print(f"Connecting to: {uri}")

    try:
        async with websockets.connect(uri) as ws:
            print("[OK] WebSocket connected")

            # Send uitest request
            uitest_msg = json.dumps({
                "type": "uitest",
                "sn": DEVICE_SN,
                "remoteIp": "127.0.0.1",
                "remotePort": "8710"
            })
            print(f"[SEND] {uitest_msg}")
            await ws.send(uitest_msg)

            message_count = 0
            image_count = 0

            while message_count < 20:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=10)

                    # Check if message is bytes or string
                    is_binary = isinstance(msg, bytes)
                    message_count += 1

                    if is_binary:
                        print(f"[MSG #{message_count}] Binary: {len(msg)} bytes, hex: {msg[:16].hex()}")
                    else:
                        print(f"[MSG #{message_count}] Text: {msg[:100] if len(msg) > 100 else msg}")

                    # Try to parse as JSON
                    try:
                        text_msg = msg if isinstance(msg, str) else msg.decode('utf-8', errors='ignore')
                        data = json.loads(text_msg)
                        msg_type = data.get("type", "unknown")

                        if msg_type == "data":
                            image_data = data.get("data", "")
                            if image_data:
                                image_count += 1
                                print(f"  -> Image frame #{image_count}: {len(image_data)} bytes")
                                if image_count >= 3:
                                    print(f"\n[SUCCESS] UiTest image mode working! ({image_count} frames)")
                                    return True
                        elif msg_type == "ready":
                            print(f"  -> Ready: {data.get('message', '')[:50]}")
                        elif msg_type == "error":
                            print(f"  [ERROR] {data.get('message')}")
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        # Binary data, ignore
                        pass

                except asyncio.TimeoutError:
                    break

            print(f"\n[SUMMARY] {message_count} messages, {image_count} images")
            return image_count > 0

    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    print("=" * 50)
    print("hos-scrcpy UiTest Mode Test")
    print("=" * 50)

    result = await test_uitest_mode()

    print("\n" + "=" * 50)
    if result:
        print("[PASS] UiTest mode works!")
    else:
        print("[FAIL] UiTest mode failed")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(main())
