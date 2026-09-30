import http.server,threading,json,tempfile,os,subprocess,time,urllib.request,socket,shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class NVR(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  result=[]
  for entry in data:
   cmd=entry['cmd'];value={}
   if cmd=='Login':value={'Token':{'name':'fake-session'}}
   if cmd=='GetChannelstatus':value={'status':[{'channel':0,'name':'TrackMix fixture','online':1},{'channel':1,'name':'empty','online':0}]}
   if cmd=='GetNetPort':value={'NetPort':{'rtspPort':554}}
   if cmd=='GetRtspUrl':value={'rtspUrl':{'channel':0,'mainStream':'rtsp://fake:fake@127.0.0.1:554/Preview_01_main','subStream':'rtsp://fake:fake@127.0.0.1:554/Preview_01_sub'}}
   result.append({'cmd':cmd,'code':0,'value':value})
  body=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
nvr=http.server.ThreadingHTTPServer(('127.0.0.1',0),NVR);threading.Thread(target=nvr.serve_forever,daemon=True).start()
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
media=tempfile.mkdtemp(prefix='nvr-api-test-',dir='/media')
with tempfile.TemporaryDirectory() as tmp:
 env={**os.environ,'PORT':str(port),'NODE_ENV':'production','ADDON_MODE':'true','ADDON_DB_PATH':tmp+'/db.json','NVR_RECORDINGS_PATH':media,'LOG_LEVEL':'silent'}
 p=subprocess.Popen(['node','artifacts/api-server/dist/index.mjs'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 def request(path,data=None,method=None):
  req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/api'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
  with urllib.request.urlopen(req,timeout=5) as response:return json.load(response)
 try:
  for _ in range(50):
   try:request('/health');break
   except Exception:time.sleep(.1)
  request('/nvr/config',{'host':'127.0.0.1','port':nvr.server_port,'username':'fake','password':'fake','channelCount':4},'PUT')
  request('/nvr/sync',{},'POST')
  cameras=request('/nvr/cameras');assert len(cameras)==1,cameras
  camera=cameras[0];assert camera['name']=='TrackMix fixture';assert camera['recordingStatus']!='recording'
  request('/nvr/cameras/'+str(camera['id']),{'channel':1,'name':camera['name'],'recordingEnabled':False},'PUT')
  assert request('/nvr/status')['recordingActive']==False
  assert request('/recordings')==[]
  print('PASS API: automatic channel discovery, no empty cameras created, truthful REC, recording list, shutdown')
 finally:
  p.terminate();p.wait(timeout=10)
  err=p.stderr.read().decode();assert not err,err
nvr.shutdown();shutil.rmtree(media)
