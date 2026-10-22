// Apply only to WhatsApp. The stable account seed never enters HTTP headers.
// This partitions Canvas text readback; it does not spoof OS/GPU or change audio.
const haituoProfileArg = process.argv.find(value => /^--haituo-canvas-profile=[a-f0-9]{64}$/.test(value));
if (haituoProfileArg && (location.hostname === 'web.whatsapp.com' || (process.argv.includes('--haituo-environment-fixture') && location.protocol === 'file:'))) {
    const profileSeed = haituoProfileArg.split('=')[1];
    require('electron').contextBridge.executeInMainWorld({
        func: function(seed) {
            const tagged = new WeakSet();
            const ctxProto = CanvasRenderingContext2D.prototype;
            const read = ctxProto.getImageData;
            const put = ctxProto.putImageData;
            const getContext = HTMLCanvasElement.prototype.getContext;
            const bytes = seed.match(/../g).map(value => parseInt(value,16));
            for (const name of ['fillText','strokeText']) {
                const original = ctxProto[name];
                ctxProto[name] = function(...args) { const result=Reflect.apply(original,this,args);tagged.add(this.canvas);return result; };
            }
            const protectedCanvas = canvas => tagged.has(canvas) && canvas.width>0 && canvas.height>0 && canvas.width<=1024 && canvas.height<=512;
            const noise = image => {
                // Touch RGB only, on opaque pixels: transparent pixels and alpha are preserved.
                let index=0;
                for(let offset=0;offset<image.data.length && index<bytes.length*8;offset+=4) {
                    if(image.data[offset+3]!==255)continue;
                    image.data[offset] ^= (bytes[Math.floor(index/8)] >>> (index%8)) & 1; index++;
                }
                return image;
            };
            ctxProto.getImageData = function(...args) {
                const result=Reflect.apply(read,this,args);
                return protectedCanvas(this.canvas) ? noise(result) : result;
            };
            const copy = canvas => {
                const source=Reflect.apply(getContext,canvas,['2d']);
                if(!source)return canvas;
                const image=noise(Reflect.apply(read,source,[0,0,canvas.width,canvas.height]));
                const clone=document.createElement('canvas');clone.width=canvas.width;clone.height=canvas.height;
                Reflect.apply(put,Reflect.apply(getContext,clone,['2d']),[image,0,0]);return clone;
            };
            for(const name of ['toDataURL','toBlob']) {
                const original=HTMLCanvasElement.prototype[name];
                HTMLCanvasElement.prototype[name]=function(...args) {
                    return Reflect.apply(original,protectedCanvas(this)?copy(this):this,args);
                };
            }
        }, args: [profileSeed]
    });
}
