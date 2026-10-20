const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms))
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function launch(){
  const port=await freePort()
  const server=spawn(process.execPath,[path.join(__dirname,'browser-host.cjs')],{windowsHide:true,env:{...process.env,LIGHTING_QA_PORT:String(port)},stdio:['ignore','pipe','pipe']})
  let logs='';server.stdout.on('data',data=>logs+=data);server.stderr.on('data',data=>logs+=data);server.on('exit',(code,signal)=>{logs+=` Server exit ${code} ${signal}`})
  for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/__meta`)).ok)break}catch{}if(i===59)throw Error('QA server startup failed: '+logs);await delay(100)}
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tunebuddy-lighting-qa-'))
  const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']})
  let stderr=''
  const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome startup timeout: '+stderr)),20000);chrome.stderr.on('data',data=>{stderr+=data;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}});chrome.on('error',reject)})
  const target=await fetch(`http://${new URL(endpoint).host}/json/new?about:blank`,{method:'PUT'}).then(response=>response.json())
  const socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map(),networkErrors=[]
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data)),item=pending.get(message.id);if(message.method==='Network.loadingFailed')networkErrors.push(message.params);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);if(message.error)item.reject(Error(message.error.message));else item.resolve(message.result||{})})
  function send(method,params={}){return new Promise((resolve,reject)=>{const messageId=++id,timer=setTimeout(()=>{pending.delete(messageId);reject(Error('CDP timeout '+method))},25000);pending.set(messageId,{resolve,reject,timer});socket.send(JSON.stringify({id:messageId,method,params}))})}
  async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result?.value}
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable')
  async function viewport(width=390,height=844,theme='light',reducedMotion='no-preference'){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenWidth:width,screenHeight:height});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:reducedMotion}]})}
  async function navigate(params={}){await send('Page.navigate',{url:`http://127.0.0.1:${port}/tests/dmx-ui-round3-2026-10-18/browser.html?${new URLSearchParams(params)}`});for(let i=0;i<200;i++){const state=await evaluate('({ready:document.documentElement.dataset.ready,error:document.documentElement.dataset.error})');if(state.error)throw Error(state.error+'; '+logs+'; '+JSON.stringify(networkErrors));if(state.ready==='true')return;await delay(50)}throw Error('Lighting browser adapter did not become ready: '+logs)}
  async function screenshot(file){fs.mkdirSync(path.dirname(file),{recursive:true});const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(file,Buffer.from(result.data,'base64'));return file}
  async function close(){try{await send('Browser.close')}catch{}socket.close();chrome.kill();server.kill()}
  return {send,evaluate,viewport,navigate,screenshot,close,port,profile}
}
module.exports={launch,delay}
