import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {EventEmitter,once} from 'node:events';
import {hasOpenClients,installListenErrorHandler} from '../../runtimeSafety.js';

test('idle or closing dashboard transports do not require snapshot serialization',()=>{
  assert.equal(hasOpenClients(new Set()),false);
  assert.equal(hasOpenClients(new Set([{readyState:0},{readyState:2},{readyState:3}])),false);
  assert.equal(hasOpenClients(new Set([{readyState:1}])),true);
});
test('a real port bind collision requests a non-zero exit',async()=>{
  const holder=createServer();holder.listen(0,'127.0.0.1');await once(holder,'listening');
  const candidate=createHttpServer();const webSocket=new WebSocketServer({server:candidate});let code,logged;
  installListenErrorHandler(candidate,'127.0.0.1',holder.address().port,{webSocket,exit:n=>{code=n;},log:m=>{logged=m;}});
  const error=once(candidate,'error');candidate.listen(holder.address().port,'127.0.0.1');await error;
  assert.equal(code,1);assert.match(logged,/cannot listen.*EADDRINUSE/);
  await new Promise(resolve=>webSocket.close(()=>resolve()));
  await new Promise(resolve=>holder.close(resolve));
});
test('errors on a listening server do not force an exit',()=>{
  const server=new EventEmitter();server.listening=true;let exits=0;
  installListenErrorHandler(server,'fixture',0,{exit:()=>exits++,log:()=>{}});
  server.emit('error',new Error('fixture'));assert.equal(exits,0);
});
