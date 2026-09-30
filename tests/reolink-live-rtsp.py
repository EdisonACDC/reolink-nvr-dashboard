"""Integration regression: real FFmpeg, local RTSP fixture, no NVR credentials.
Run: python tests/reolink-live-rtsp.py (requires ffmpeg and installed JS dependencies).
"""
import json
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / 'artifacts/api-server'

class Fixture:
    def __init__(self, data, mode):
        self.data, self.mode, self.connections = data, mode, 0
        self.closed = threading.Event()
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.server.settimeout(.2)
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self):
        while not self.closed.is_set():
            try:
                conn, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self.connections += 1
            threading.Thread(target=self.handle, args=(conn,), daemon=True).start()

    def handle(self, conn):
        conn.settimeout(20)
        buf, udp_port, udp = b'', None, None
        try:
            while not self.closed.is_set():
                chunk = conn.recv(4096)
                if not chunk:
                    return
                buf += chunk
                if b'\r\n\r\n' not in buf:
                    continue
                request, buf = buf.split(b'\r\n\r\n', 1)
                lines = request.decode().split('\r\n')
                method = lines[0].split()[0]
                headers = dict(x.split(': ', 1) for x in lines[1:] if ': ' in x)
                body, extra, status = '', '', '200 OK'
                if method == 'DESCRIBE':
                    body = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Fixture\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=video 0 RTP/AVP 33\r\na=rtpmap:33 MP2T/90000\r\na=control:track1\r\n'
                    extra = 'Content-Type: application/sdp\r\n'
                    if self.mode == 'missing' or self.mode == 'path-fallback' and '/h264Preview_' in lines[0]:
                        status, body = '404 Stream Not Found', ''
                if method == 'SETUP':
                    transport = headers['Transport']
                    if self.mode == 'udp' and 'TCP' in transport:
                        status = '461 Unsupported Transport'
                    elif 'client_port=' in transport:
                        udp_port = int(re.search(r'client_port=(\d+)', transport)[1])
                        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                        udp.bind(('127.0.0.1', 0))
                        extra = f'Transport: {transport};server_port={udp.getsockname()[1]}-{udp.getsockname()[1]+1}\r\nSession: 12345\r\n'
                    else:
                        extra = 'Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\nSession: 12345\r\n'
                if method == 'OPTIONS':
                    extra = 'Public: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN\r\n'
                conn.sendall((f'RTSP/1.0 {status}\r\nCSeq: {headers.get("CSeq", "1")}\r\n' + extra + f'Content-Length: {len(body)}\r\n\r\n' + body).encode())
                if status.startswith(('404', '461')):
                    return
                if method == 'PLAY':
                    if self.mode == 'udp-timeout' and udp_port is None:
                        self.closed.wait(17)
                        return
                    if self.mode == 'slow':
                        self.closed.wait(10)
                    for seq, offset in enumerate(range(0, len(self.data), 1316)):
                        if self.closed.is_set():
                            break
                        packet = struct.pack('!BBHII', 128, 33, seq % 65536, seq * 1800, 1) + self.data[offset:offset+1316]
                        if udp_port:
                            udp.sendto(packet, ('127.0.0.1', udp_port))
                        else:
                            conn.sendall(b'$\x00' + struct.pack('!H', len(packet)) + packet)
                        time.sleep(.02)
                    return
        except (OSError, ValueError):
            pass
        finally:
            conn.close()
            if udp:
                udp.close()

    def close(self):
        self.closed.set()
        self.server.close()

NODE = r'''
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {pollReolinkLive: poll} = require('./.rtsp-regression.cjs');
const sources = [process.argv[1]];
const missing = process.argv[2] === 'missing';
(async () => {
  try {
    assert.equal(poll(sources, 99123, 'segment-000001.ts').status, 'missing');
    const started = Date.now();
    let result;
    while (Date.now() - started < 40000) {
      // Concurrent viewers must share one attempt, not switch/restart FFmpeg.
      for (let i = 0; i < 20; i++) result = poll(sources, 99123, 'index.m3u8');
      if (result.status !== 'starting') break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (missing) {
      assert.equal(result.status, 'failed');
      assert.match(result.detail, /404/);
      assert.ok(!result.detail.includes('secret-password'));
    } else {
      assert.equal(result.status, 'ready', JSON.stringify(result));
      const playlist = fs.readFileSync(result.filePath, 'utf8');
      assert.match(playlist, /#EXTINF/);
      const segment = playlist.split('\n').find(x => x.endsWith('.ts'));
      const videoSegment = poll(sources, 99123, segment);
      assert.equal(videoSegment.status, 'ready');
      const probe = JSON.parse(require('node:child_process').execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','json',videoSegment.filePath]));
      assert.equal(probe.streams[0].codec_name, 'h264');
      assert.equal(poll(sources, 99123, 'segment-999999.ts').status, 'missing');
      assert.equal(poll(sources, 99123, 'index.m3u8').filePath, result.filePath);
    }
    console.log(JSON.stringify({mode:process.argv[2], status:result.status, elapsedMs:Date.now()-started}));
  } finally { process.emit('SIGTERM'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
'''

def main():
    bundle = API / '.rtsp-regression.cjs'
    subprocess.run(['node', '-e', "require('esbuild').buildSync({entryPoints:['src/lib/reolink-stream.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:'.rtsp-regression.cjs'})"], cwd=API, check=True)
    try:
        with tempfile.TemporaryDirectory() as directory:
            media = Path(directory) / 'video.ts'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '10', '-f', 'mpegts', '-y', str(media)], check=True)
            hevc = Path(directory) / 'hevc.ts'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t','30','-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1:log-level=error','-g','10','-f','mpegts','-y',str(hevc)],check=True)
            for mode, connections in [('hevc', 1), ('slow', 1), ('udp', 2), ('udp-timeout', 2), ('missing', 2)]:
                fixture = Fixture((hevc if mode == 'hevc' else media).read_bytes(), mode)
                try:
                    subprocess.run(['node', '-e', NODE, f'rtsp://test:secret-password@127.0.0.1:{fixture.port}/Preview_01_sub', mode], cwd=API, env={**os.environ, 'NODE_ENV':'production', 'LOG_LEVEL':'silent'}, check=True, timeout=45)
                    assert fixture.connections == connections, (mode, fixture.connections)
                    print(f'PASS {mode}: {connections} RTSP session(s) despite concurrent polling')
                finally:
                    fixture.close()
    finally:
        bundle.unlink(missing_ok=True)

if __name__ == '__main__':
    main()

