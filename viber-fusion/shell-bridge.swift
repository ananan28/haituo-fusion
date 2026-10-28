// Concatenate after main.swift and compile with -D FUSION_BRIDGE.
// A private stdio pipe owned by the Electron parent; never a listening network server.
let bridgeApp=NSApplication.shared
bridgeApp.setActivationPolicy(.accessory)
let bridgeDelegate=Delegate()
bridgeDelegate.showHost=false
bridgeDelegate.window=NSWindow(contentRect:NSRect(x:0,y:0,width:1100,height:780),styleMask:[.titled],backing:.buffered,defer:false)
bridgeDelegate.viewer=FusionView(frame:NSRect(x:0,y:0,width:1000,height:650))
bridgeDelegate.window.contentView=bridgeDelegate.viewer
bridgeDelegate.status=NSTextField(labelWithString:"未连接")
var clientEpoch=0
var lastImageAt=Date.distantPast
var lastState=""
func emit(_ value: [String:Any]) {
    guard let data=try? JSONSerialization.data(withJSONObject:value),data.count<8*1024*1024 else { return }
    FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data([10]))
}
bridgeDelegate.viewer.imageChanged={ image in
    guard let image=image else { emit(["type":"clear","epoch":clientEpoch]); return }
    guard bridgeDelegate.geometryValid,bridgeDelegate.selected>0,Date().timeIntervalSince(lastImageAt)>0.15 else { return }
    let representation=NSBitmapImageRep(cgImage:image)
    guard let data=representation.representation(using:.jpeg,properties:[.compressionFactor:0.65]),data.count<6*1024*1024 else { return }
    lastImageAt=Date()
    emit(["type":"frame","epoch":clientEpoch,"slot":bridgeDelegate.selected,"image":data.base64EncodedString(),"width":image.width,"height":image.height])
}
bridgeDelegate.viewer.feedback={ bridgeDelegate.status.stringValue=$0 }
func frame(_ object: [String:Any]) -> CGRect? {
    guard let x=object["x"] as? Double,let y=object["y"] as? Double,let width=object["width"] as? Double,let height=object["height"] as? Double,
          [x,y,width,height].allSatisfy({$0.isFinite}),width>0,height>0,width<20000,height<20000 else { return nil }
    return CGRect(x:x,y:y,width:width,height:height)
}
func minimizeSource() {
    if let app=bridgeDelegate.viewer.target,let source=largestAXWindow(AXUIElementCreateApplication(app.processIdentifier)) {
        _=AXUIElementSetAttributeValue(source,kAXMinimizedAttribute as CFString,kCFBooleanTrue)
    }
}
func command(_ object: [String:Any]) {
    guard let type=object["type"] as? String else { return }
    if type=="select" {
        guard let epoch=object["epoch"] as? Int,epoch>clientEpoch,let slot=object["slot"] as? Int,(1...5).contains(slot),let bounds=object["bounds"] as? [String:Any],let host=frame(bounds) else { return }
        clientEpoch=epoch;lastState="";lastImageAt = .distantPast
        if let pid=object["hostPID"] as? Int32 { bridgeDelegate.hostApplication=NSRunningApplication(processIdentifier:pid) }
        bridgeDelegate.externalHostFrame=host
        // Superseding a selection owns pending; invalidateConnection itself never changes it.
        bridgeDelegate.pending=false
        let button=NSButton(title:"",target:nil,action:nil);button.tag=slot
        bridgeDelegate.selectSlot(button)
    } else if type=="hide" {
        guard let epoch=object["epoch"] as? Int,epoch>=clientEpoch else { return }
        clientEpoch=epoch;minimizeSource();bridgeDelegate.invalidateConnection()
    } else {
        guard (object["epoch"] as? Int)==clientEpoch else { return }
        if type=="bounds",let bounds=object["bounds"] as? [String:Any],let host=frame(bounds) {
            bridgeDelegate.externalHostFrame=host;bridgeDelegate.alignSourceWindow()
        } else if type=="click",bridgeDelegate.geometryValid,let target=bridgeDelegate.viewer.target,
                  let x=object["x"] as? Double,let y=object["y"] as? Double,x.isFinite,y.isFinite,(0...1).contains(x),(0...1).contains(y) {
            let r=bridgeDelegate.viewer.targetFrame
            bridgeDelegate.viewer.forwardMouse(CGPoint(x:r.minX+x*r.width,y:r.minY+y*r.height),target:target)
        }
    }
}
let stateTimer=Timer.scheduledTimer(withTimeInterval:0.1,repeats:true) { _ in
    let title=bridgeDelegate.window.title
    let state=title+bridgeDelegate.status.stringValue+String(bridgeDelegate.pending)
    if state != lastState {
        lastState=state
        emit(["type":"state","epoch":clientEpoch,"slot":bridgeDelegate.selected,"ready":bridgeDelegate.geometryValid && title.hasPrefix("Fusion: Ready"),"pending":bridgeDelegate.pending,"status":bridgeDelegate.status.stringValue])
    }
}
DispatchQueue.global(qos:.userInitiated).async {
    while let line=readLine() {
        guard line.utf8.count<65536,let data=line.data(using:.utf8),let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else { continue }
        DispatchQueue.main.async { command(object) }
    }
    DispatchQueue.main.async { minimizeSource();bridgeDelegate.invalidateConnection();bridgeApp.terminate(nil) }
}
emit(["type":"started","protocol":1])
bridgeApp.run()
