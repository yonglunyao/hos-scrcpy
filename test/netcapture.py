#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Capture raw TCP data from scrcpy server"""

import asyncio
import socket

async def capture_raw_data():
    """Connect and capture raw data"""
    print("\n=== Raw TCP Capture ===")
    print("Connecting to scrcpy server...")

    # First, start scrcpy on device
    import subprocess
    try:
        print("Starting scrcpy on device...")
        subprocess.run([
            'hdc', 'shell', '/system/bin/uitest', 'start-daemon', 'singleness',
            '--extension-name', 'libscreen_casting.z.so',
            '-scale', '2',
            '-frameRate', '60',
            '-bitRate', '8388608',
            '-p', '5000',
            '-screenId', '0',
            '-encodeType', '0',
            '-iFrameInterval', '500',
            '-repeatInterval', '33'
        ], check=False, timeout=5)
        await asyncio.sleep(2)
    except Exception as e:
        print(f"Start scrcpy warning: {e}")

    # Find the abstract socket
    result = subprocess.run(['hdc', 'shell', 'cat', '/proc/net/unix', '|', 'grep', 'scrcpy_grpc_socket'],
                          capture_output=True, text=True)
    print(f"Socket check: {result.stdout[:100] if result.stdout else 'not found'}")

    # Create abstract socket forward (this may not work on Windows)
    # For now, just report the status
    print("\nNote: Abstract socket forwarding requires hdc or custom implementation")
    print("The scrcpy server is likely running but not accessible via standard TCP")

    return False

async def main():
    print("=" * 50)
    print("Raw TCP Data Capture")
    print("=" * 50)

    await capture_raw_data()

    print("\n" + "=" * 50)
    print("Analysis: Need to use Java client or reverse engineer protocol")
    print("=" * 50)

if __name__ == "__main__":
    asyncio.run(main())
