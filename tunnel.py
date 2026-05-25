#!/usr/bin/env python3
"""SSH tunnel manager for localhost.run"""
import subprocess, sys, os, signal, time, re

def start_tunnel():
    cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=30",
        "-o", "ExitOnForwardFailure=yes",
        "-R", "80:localhost:5001",
        "nokey@localhost.run"
    ]
    
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    
    url = None
    for line in proc.stdout:
        print(line, end='', flush=True)
        m = re.search(r'https://([a-z0-9]+)\.lhr\.life', line)
        if m:
            url = m.group(0)
            print(f"\n🎯 TUNEL AKTYWNY: {url}")
            # Save URL to file
            with open('/tmp/tunnel_url.txt', 'w') as f:
                f.write(url)
            break
    
    if not url:
        print("❌ Nie udało się uzyskać URL tunelu")
        return None
    
    # Keep reading to maintain connection
    try:
        for line in proc.stdout:
            pass
    except:
        pass
    
    proc.wait()
    return url

if __name__ == "__main__":
    url = start_tunnel()
    if url:
        print(f"URL: {url}")
