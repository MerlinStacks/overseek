/** Start only the owned loopback PHP fixture server; leave it available for reruns. */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory=fs.realpathSync(process.argv[2]);
const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json'),'utf8'));
const origin=new URL(fixture.origin);
if(origin.hostname!=='127.0.0.1'||origin.protocol!=='http:'||!origin.port)throw Error('Loopback custom port required');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(Number(origin.port),'127.0.0.1',()=>probe.close(resolve));});
const log=fs.openSync(path.join(directory,'php-http.log'),'a');
const router=fileURLToPath(new URL('./native/delivery-native-browser-router.php',import.meta.url));
const child=spawn(process.env.PHP_BINARY||'php',['-d','sendmail_path=/bin/true','-S',origin.host,'-t',fixture.wpRoot,router],{
 detached:true,stdio:['ignore',log,log],env:{...process.env,OVERSEEK_RUN_DISPOSABLE_DB_TESTS:'1',OVERSEEK_NATIVE_BROWSER_WP_ROOT:fixture.wpRoot,OVERSEEK_NATIVE_BROWSER_HTTP:fixture.ownership.data.token}
});
fs.writeFileSync(path.join(directory,'http.pid'),String(child.pid));child.unref();fs.closeSync(log);
console.log(JSON.stringify({pid:child.pid,origin:fixture.origin,documentRoot:fixture.wpRoot}));
