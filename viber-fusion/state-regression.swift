// Concatenate after main.swift and compile with -D STATE_REGRESSION (see STATE-REGRESSION.md).
// No screen capture, AX permission, installed Viber, chat data, or filesystem fixtures required.
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError("STATE_REGRESSION_FAILED: \(message)") }
}
let regressionApp=NSApplication.shared
let subject=Delegate()
subject.window=NSWindow(contentRect:NSRect(x:0,y:0,width:900,height:700),styleMask:[.titled],backing:.buffered,defer:false)
subject.viewer=FusionView(frame:NSRect(x:0,y:0,width:500,height:500))
subject.status=NSTextField(labelWithString:"synthetic")
subject.buttons=[NSButton(title:"synthetic",target:nil,action:nil)]
let pixels=CGContext(data:nil,width:8,height:8,bitsPerComponent:8,bytesPerRow:32,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
pixels.setFillColor(CGColor(red:0.2,green:0.6,blue:0.9,alpha:1)); pixels.fill(CGRect(x:0,y:0,width:8,height:8))
let syntheticImage=pixels.makeImage()!
func connection(_ slot: Int, valid: Bool = true) -> FrameSink {
    subject.selected=slot; subject.geometryValid=valid
    subject.viewer.target=NSRunningApplication.current
    subject.viewer.targetFrame=CGRect(x:1,y:2,width:300,height:250)
    subject.window.title="Fusion: Loading slot \(slot)"
    let sink=FrameSink(subject.viewer)
    subject.installCallbacks(sink,token:subject.generation,slot:slot)
    subject.sink=sink
    return sink
}
let early=connection(1,valid:false)
early.deliver(syntheticImage)
check(subject.viewer.image == nil,"geometry-invalid frame was displayed")
check(!subject.window.title.contains("Ready"),"geometry-invalid frame became Ready")
check(early.onFrame != nil,"discarded frame consumed first-frame callback")
subject.geometryValid=true; early.deliver(syntheticImage)
check(subject.viewer.image != nil && subject.window.title == "Fusion: Ready slot 1","first valid frame must become Ready")
check(early.onFrame == nil,"accepted first-frame callback should be consumed")
// Each invalid geometry route shares this exact production cleanup operation.
for error in ["AX main window missing","source geometry rejected","host geometry unavailable"] {
    let old=connection(2); old.deliver(syntheticImage)
    subject.pending=true; subject.buttons[0].isEnabled=false
    let token=subject.generation
    subject.geometryFailed(error,source:nil,application:nil)
    check(subject.generation == token+1 && !subject.geometryValid,"geometry failure must invalidate generation")
    check(subject.selected == 0 && subject.viewer.target == nil,"geometry failure must clear selected and target")
    check(subject.viewer.targetFrame == .zero && subject.viewer.image == nil,"geometry failure must clear frame and image")
    check(subject.sink == nil && old.onFrame == nil && old.isCurrent == nil,"geometry failure must cancel sink")
    check(subject.pending && !subject.buttons[0].isEnabled,"cleanup must preserve pending and disabled buttons")
    old.deliver(syntheticImage)
    check(subject.viewer.image == nil && !subject.window.title.contains("Ready"),"late frame revived failed connection")
    check(subject.status.stringValue == error,"cleanup replaced the real error")
    subject.pending=false; subject.buttons[0].isEnabled=true
}
// Wrong slot and stale generation independently reject frames without consuming callbacks.
let wrong=connection(3); subject.selected=4; wrong.deliver(syntheticImage)
check(subject.viewer.image == nil && wrong.onFrame != nil,"wrong slot accepted frame or consumed callback")
subject.selected=3; subject.generation += 1; wrong.deliver(syntheticImage)
check(subject.viewer.image == nil && !subject.window.title.contains("Ready"),"stale generation accepted frame")
subject.invalidateConnection()
// A stream error owns only its own connection, including a buffered callback after cancellation.
let failedSink=connection(4)
let stopped=StreamTermination();subject.installTermination(stopped,frameSink:failedSink,token:subject.generation);subject.termination=stopped
let bufferedStop=stopped.onStop
subject.pending=true;subject.buttons[0].isEnabled=false
stopped.deliverStop(NSError(domain:"synthetic",code:1,userInfo:[NSLocalizedDescriptionKey:"synthetic capture closed"]))
check(subject.selected==0 && subject.viewer.image==nil && subject.sink==nil,"stream error did not invalidate capture")
check(!subject.pending && subject.buttons[0].isEnabled,"owned stream failure did not finish its connection")
check(subject.window.title=="Fusion: Capture failed" && subject.status.stringValue.contains("synthetic capture closed"),"stream error lost its real failure")
check(stopped.onStop==nil,"retired stream delegate callback was not discarded")
let afterStop=connection(5);let afterStopToken=subject.generation
subject.pending=true;subject.buttons[0].isEnabled=false
bufferedStop?(NSError(domain:"synthetic",code:2))
check(subject.generation==afterStopToken && subject.sink===afterStop && subject.pending && !subject.buttons[0].isEnabled,"buffered old stop altered a newer connection or pending state")
subject.pending=false;subject.buttons[0].isEnabled=true;subject.invalidateConnection()
// Reuse the real detached-stop operation with a controllable synthetic async stop.
var stopContinuation: CheckedContinuation<Void,Never>?
var stopFinished=false
let stop=subject.stopDetached {
    await withCheckedContinuation { stopContinuation=$0 }
    stopFinished=true
}
var finished=false
Task { @MainActor in
    while stopContinuation == nil { await Task.yield() }
    let next=connection(5,valid:false)
    next.deliver(syntheticImage)
    check(subject.viewer.image == nil && next.onFrame != nil,"pre-alignment frame was accepted")
    subject.geometryValid=true
    next.deliver(syntheticImage)
    check(subject.window.title == "Fusion: Ready slot 5","new connection did not recover")
    let token=subject.generation
    stopContinuation?.resume(); await stop.value
    check(stopFinished,"old stream stop did not complete")
    check(subject.generation == token && subject.sink === next && subject.selected == 5,"old stop cleared newer connection")
    check(subject.viewer.image != nil && subject.window.title == "Fusion: Ready slot 5","old stop cleared new image or Ready")
    // Fifteen selections, preserving first-frame recovery for every new slot.
    for index in 0..<15 {
        subject.invalidateConnection()
        let slot=index%5+1; let current=connection(slot)
        early.deliver(syntheticImage); wrong.deliver(syntheticImage)
        check(subject.viewer.image == nil,"late frame appeared after account switch")
        current.deliver(syntheticImage)
        check(subject.window.title == "Fusion: Ready slot \(slot)","switch first frame did not become Ready")
    }
    print("STATE_REGRESSION_PASS: late frames, geometry cleanup, detached stop, recovery, first frames, 15 switches")
    finished=true
}
while !finished { RunLoop.current.run(until:Date(timeIntervalSinceNow:0.01)) }
