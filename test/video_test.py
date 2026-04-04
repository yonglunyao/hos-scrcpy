#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Test video streaming via Python server"""

import asyncio
import websockets
import json

SERVER_URL = "ws://localhost:8899/ws/screen/FMR0223B16009134"

async def test_video():
    print("Connecting to:", SERVER_URL)

    async with websockets.connect(SERVER_URL) as ws:
        print("Connected!")

        frame_count = 0
        total_bytes = 0

        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=15)
                if isinstance(msg, bytes):
                    frame_count += 1
                    total_bytes += len(msg)
                    print(f"Frame #{frame_count}: {len(msg)} bytes")

                    if frame_count >= 10:
                        print(f"\nSUCCESS! Received {frame_count} frames, {total_bytes} bytes")
                        return True
        except asyncio.TimeoutError:
            pass

    print(f"Received {frame_count} frames, {total_bytes} bytes")
    return frame_count > 0

asyncio.run(test_video())