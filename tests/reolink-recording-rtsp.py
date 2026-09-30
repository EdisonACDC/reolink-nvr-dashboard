"""Real FFmpeg regression: failed URL fallback, truthful REC, H.265 archive and H.264 playback."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / 'artifacts/api-server'
spec = importlib.util.spec_from_file_location('rtsp_fixture', ROOT/'tests/reolink-live-rtsp.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

NODE = r'''
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {jsonStore} = require('./.recording-store.cjs');
const recorder = require('./.recording-regression.cjs');
const {pollRecordingPlayback} = require('./.playback-regression.cjs');
const wait = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ready = false;
  try {
    const config = jsonStore.createNvrConfig({host:'127.0.0.1', port:80, rtspPort:Number(process.argv[1]), username:'test', password:'secret-password', name:'Fixture', configured:true, channelCount:1, httpPort:80});
    const camera = jsonStore.createCamera({nvrId:config.id, channel:1, name:'Test', status:'online', recordingEnabled:true, motionDetection:false, resolution:null});
    assert.equal(recorder.getStorageStatus().recordingProcesses, 0);
    assert.notEqual(recorder.recorderCameraStatus(camera.id), 'recording');
    const started = Date.now();
    let recordings = [];
    while(Date.now()-started < 45000) {
      if (recorder.recorderCameraStatus(camera.id) === 'recording') ready = true;
      recordings = await recorder.listRecordedFiles(camera.id);
      if (ready && recordings.length) break;
      await wait(150);
    }
    assert.ok(ready, 'must confirm frames AND bytes on disk');
    assert.ok(recordings.length, 'must contain a finalized, probeable segment');
    const rec = recordings[0];
    assert.ok(rec.duration > 0 && rec.duration < 15);
    const name = new URL(rec.playbackUrl, 'http://test').searchParams.get('file');
    const original = recorder.recordingFilePath(camera.id, name);
    const probe = file => JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','json',file]));
    assert.equal(probe(original).streams[0].codec_name, 'hevc');
    // A corrupt/unfinished MP4 must never be listed as a playable recording.
    const bad = require('node:path').join(require('node:path').dirname(original), '2000-01-01_00-00-00.mp4');
    fs.writeFileSync(bad, Buffer.alloc(4096));
    assert.equal((await recorder.listRecordedFiles(camera.id,'2000-01-01')).length, 0);
    let playback;
    for(let i=0;i<200;i++) {
      playback = pollRecordingPlayback(original,'index.m3u8');
      if(playback.status === 'ready' && fs.readFileSync(playback.filePath,'utf8').includes('#EXT-X-ENDLIST')) break;
      await wait(100);
    }
    assert.equal(playback.status,'ready');
    const playlist = fs.readFileSync(playback.filePath,'utf8');
    assert.match(playlist, /#EXT-X-ENDLIST/);
    const segment = playlist.split('\n').find(x=>x.endsWith('.ts'));
    const streamed = pollRecordingPlayback(original,segment);
    assert.equal(probe(streamed.filePath).streams[0].codec_name,'h264');
    assert.equal(probe(original).streams[0].codec_name,'hevc','download original remains untouched');
    jsonStore.updateCamera(camera.id,{recordingEnabled:false});
    assert.equal(recorder.recorderCameraStatus(camera.id),'off');
    assert.equal(recorder.getStorageStatus().recordingProcesses,0);
    console.log('PASS: alternate RTSP path, real recording state, HEVC archive, valid durations, reject corrupt MP4, H264 playback, original preserved');
  } finally {process.emit('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
'''

def main():
    bundles = {'.recording-regression.cjs':'src/lib/nvr-recorder.ts', '.recording-store.cjs':'src/store/json-store.ts', '.playback-regression.cjs':'src/lib/recording-playback.ts'}
    for target, source in bundles.items():
        subprocess.run(['node','-e',f"require('esbuild').buildSync({{entryPoints:['{source}'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:'{target}'}})"],cwd=API,check=True)
    archive = Path(tempfile.mkdtemp(prefix='nvr-regression-',dir='/media'))
    try:
        with tempfile.TemporaryDirectory() as tmp:
            video=Path(tmp)/'video.ts'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=15','-t','40','-c:v','libx265','-preset','ultrafast','-x265-params','pools=1:frame-threads=1:log-level=error','-g','15','-f','mpegts','-y',str(video)],check=True)
            # The preferred URL returns 404, the alternative is a real HEVC stream.
            fixture=module.Fixture(video.read_bytes(),'path-fallback')
            try:
                env={**os.environ,'NODE_ENV':'production','LOG_LEVEL':'silent','NVR_SEGMENT_SECONDS':'10','ADDON_DB_PATH':str(Path(tmp)/'db.json'),'NVR_RECORDINGS_PATH':str(archive)}
                subprocess.run(['node','-e',NODE,str(fixture.port)],cwd=API,env=env,check=True,timeout=55)
                assert fixture.connections >= 2, fixture.connections
            finally:fixture.close()
    finally:
        shutil.rmtree(archive)
        for target in bundles:(API/target).unlink(missing_ok=True)

if __name__=='__main__':main()
