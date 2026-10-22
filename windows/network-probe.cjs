const {createRequire}=require('node:module');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const load=createRequire(path.join(process.env.HAITUO_PACKED_APP,'resources','app.asar','package.json'));
const signal=load('@signalapp/libsignal-client');
const versions=[['previous','1.1.22'],['baseline','8.29.0-alpha.1']];
async function check(label,version){
 const net=new signal.Net.Net({env:signal.Net.Environment.Production,userAgent:`Signal-Desktop/${version} Windows ${os.release()}`});
 const result={label,version};
 try{
  const connection=await net.connectUnauthenticatedChat({onConnectionInterrupted(){}},{abortSignal:AbortSignal.timeout(30000)});
  result.chat=true;await connection.disconnect();
 }catch(error){result.chat=false;result.chatError=String(error?.message||error)}
 let connection;
 try{
  let done;const received=new Promise(resolve=>{done=resolve});
  connection=await net.connectProvisioning({onReceivedAddress(){done(true)},onReceivedEnvelope(){},onConnectionInterrupted(){done(false)}},{abortSignal:AbortSignal.timeout(30000)});
  const timer=setTimeout(()=>done(false),10000);
  result.provisioningAddress=await received;clearTimeout(timer);
 }catch(error){result.provisioningAddress=false;result.provisioningError=String(error?.message||error)}
 finally{if(connection)await connection.disconnect()}
 return result;
}
(async()=>{
 const results=[];for(const [label,version] of versions)results.push(await check(label,version));
 const reportPath=process.env.HAITUO_NETWORK_REPORT;
 if(reportPath){fs.writeFileSync(reportPath,JSON.stringify({results},null,2))}
 console.log(JSON.stringify({results},null,2));
 process.exit(results[1].chat&&results[1].provisioningAddress?0:1);
})().catch(error=>{console.error(error);process.exit(1)});
