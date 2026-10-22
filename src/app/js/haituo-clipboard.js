'use strict';
// Electron 44 uses asynchronous ClipboardItem APIs; retain compatibility with older runtimes.
async function writeImage(e,image){
 if(typeof e.clipboard.writeImage==='function')return await e.clipboard.writeImage(image);
 await e.clipboard.write([new e.ClipboardItem({'image/png':new Blob([image.toPNG()],{type:'image/png'})})]);
}
async function readImage(e){
 if(typeof e.clipboard.readImage==='function')return await e.clipboard.readImage();
 const items=await e.clipboard.read();
 for(const item of items){const type=item.types.find(t=>t==='image/png')||item.types.find(t=>t.startsWith('image/'));if(!type)continue;const blob=await item.getType(type);if(blob.size>32*1024*1024)throw Error('剪贴板图片过大');return e.nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))}
 return null;
}
module.exports={readImage,writeImage};
