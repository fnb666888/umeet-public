/** Local SMTP sink only. No relay, no HTTP debug endpoint, never part of an API build. */
import {SMTPServer} from 'smtp-server';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const output=resolve('.runtime/smtp-fixture/deliveries.json');
await mkdir(dirname(output),{recursive:true});await writeFile(output,'[]');
const deliveries:{recipient:string;code:string}[]=[];
const server=new SMTPServer({secure:true,key:await readFile(resolve('.runtime/smtp-fixture/key.pem')),cert:await readFile(resolve('.runtime/smtp-fixture/cert.pem')),logger:false,
 onAuth(auth,_session,callback){if(auth.username!=='test-sender'||auth.password!=='local-test-password')return callback(new Error('Invalid test credentials'));callback(null,{user:'local-test-only'});},
 onRcptTo(address,_session,callback){if(!address.address.endsWith('@fixture.invalid'))return callback(new Error('Test sink accepts only fixture.invalid'));callback();},
 onData(stream,session,callback){const chunks:Buffer[]=[];stream.on('data',(chunk:Buffer)=>chunks.push(chunk));stream.on('error',callback);stream.on('end',()=>{
  const raw=Buffer.concat(chunks).toString('utf8'),separator=raw.indexOf('\r\n\r\n'),headers=raw.slice(0,separator),body=raw.slice(separator+4);
  const decoded=/content-transfer-encoding:\s*base64/i.test(headers)?Buffer.from(body.replace(/\s/g,''),'base64').toString('utf8'):/content-transfer-encoding:\s*quoted-printable/i.test(headers)?Buffer.from(body.replace(/=\r?\n/g,'').replace(/=([0-9a-f]{2})/gi,(_match,hex:string)=>String.fromCharCode(Number.parseInt(hex,16))),'latin1').toString('utf8'):body;
  const code=/验证码是 (\d{6})/.exec(decoded)?.[1];if(!code)return callback(new Error('Test code missing'));
  for(const recipient of session.envelope.rcptTo)deliveries.push({recipient:recipient.address,code});
  void writeFile(output,JSON.stringify(deliveries)).then(()=>callback()).catch(()=>callback(new Error('Fixture storage failed')));
 });}
});
server.on('error',()=>{process.stderr.write('SMTP_FIXTURE_FAILED\n');process.exitCode=1;});
await new Promise<void>(resolveReady=>server.listen(2465,'127.0.0.1',resolveReady));
process.stdout.write('Local TLS SMTP fixture ready on loopback:2465\n');
process.once('SIGINT',()=>server.close());process.once('SIGTERM',()=>server.close());
