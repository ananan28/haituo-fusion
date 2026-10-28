// GitHub Actions fixture only. Renders generated text; never opens Viber or a user file.
import AppKit
import Foundation
_ = NSApplication.shared
let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:640,pixelsHigh:180,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
NSColor.white.setFill();NSRect(x:0,y:0,width:640,height:180).fill()
("SYNTHETIC HELLO" as NSString).draw(at:NSPoint(x:25,y:70),withAttributes:[.font:NSFont.systemFont(ofSize:40),.foregroundColor:NSColor.black])
NSGraphicsContext.restoreGraphicsState()
let synthetic=rep.representation(using:.jpeg,properties:[.compressionFactor:0.9])!.base64EncodedString()
let lock=NSLock()
func send(_ value:[String:Any]) { lock.lock();defer{lock.unlock()};let data=try! JSONSerialization.data(withJSONObject:value);FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data([10])) }
var selectedSlot=0,selectedEpoch=0
while let line=readLine() {
    guard let data=line.data(using:.utf8),let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let epoch=object["epoch"] as? Int else { continue }
    if object["type"] as? String == "select",let slot=object["slot"] as? Int {
        selectedSlot=slot;selectedEpoch=epoch
        DispatchQueue.global().asyncAfter(deadline:.now()+0.2) {
            send(["type":"state","epoch":epoch,"slot":slot,"ready":true,"pending":false,"status":"Synthetic native helper ready"])
            send(["type":"frame","epoch":epoch,"slot":slot,"image":synthetic,"width":640,"height":180])
        }
    } else if object["type"] as? String == "insert",epoch==selectedEpoch {
        send(["type":"state","epoch":epoch,"slot":selectedSlot,"ready":true,"pending":false,"status":"译文已填入 Viber 输入框（尚未发送）"])
    } else if object["type"] as? String == "hide" { send(["type":"clear","epoch":epoch]) }
}
