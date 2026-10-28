import AppKit
import ApplicationServices
import ScreenCaptureKit
import CoreGraphics
import CoreMedia
import Foundation
final class Counter:NSObject,SCStreamOutput {
    private let lock=NSLock(); private var value=0
    func stream(_ stream:SCStream,didOutputSampleBuffer buffer:CMSampleBuffer,of type:SCStreamOutputType) { if type == .screen && buffer.isValid { lock.lock();value += 1;lock.unlock() } }
    func count()->Int { lock.lock();defer{lock.unlock()};return value }
}
@main struct OffscreenProbe {
 @MainActor static func main() async {
  _ = NSApplication.shared
  guard AXIsProcessTrusted(),CGPreflightScreenCaptureAccess(),let process=NSRunningApplication.runningApplications(withBundleIdentifier:"com.haituo.viberpreview.slot5").first else { fputs("PERMISSION_OR_PROCESS_MISSING\n",stderr);exit(2) }
  let app=AXUIElementCreateApplication(process.processIdentifier);var raw:CFTypeRef?
  guard AXUIElementCopyAttributeValue(app,kAXWindowsAttribute as CFString,&raw) == .success,let windows=raw as? [AXUIElement] else {exit(3)}
  var target:AXUIElement?,maxArea:CGFloat=0,original=CGPoint.zero
  for window in windows { var value:CFTypeRef?,size=CGSize.zero;if AXUIElementCopyAttributeValue(window,kAXSizeAttribute as CFString,&value) == .success,let value=value,CFGetTypeID(value)==AXValueGetTypeID(),AXValueGetValue(value as! AXValue,.cgSize,&size),size.width*size.height>maxArea {maxArea=size.width*size.height;target=window} }
  guard let target=target else {exit(4)}
  var originalRaw:CFTypeRef?
  guard AXUIElementCopyAttributeValue(target,kAXPositionAttribute as CFString,&originalRaw) == .success,let originalRaw=originalRaw,CFGetTypeID(originalRaw)==AXValueGetTypeID(),AXValueGetValue(originalRaw as! AXValue,.cgPoint,&original) else {exit(5)}
  defer {if let value=AXValueCreate(.cgPoint,&original) {_ = AXUIElementSetAttributeValue(target,kAXPositionAttribute as CFString,value)}}
  var desired=CGPoint(x:3500,y:100); guard let value=AXValueCreate(.cgPoint,&desired) else {exit(6)}
  let result=AXUIElementSetAttributeValue(target,kAXPositionAttribute as CFString,value)
  var actualRaw:CFTypeRef?,actual=CGPoint.zero
  guard result == .success, AXUIElementCopyAttributeValue(target,kAXPositionAttribute as CFString,&actualRaw) == .success,let actualRaw=actualRaw,CFGetTypeID(actualRaw)==AXValueGetTypeID(),AXValueGetValue(actualRaw as! AXValue,.cgPoint,&actual) else {fputs("MOVE_OFFSCREEN_FAILED\n",stderr);exit(7)}
  print("OFFSCREEN_REQUEST x=3500 actual=\(actual.x),\(actual.y)")
  do {
   try await Task.sleep(nanoseconds:500_000_000)
   let content=try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:false)
   guard let window=content.windows.filter({$0.owningApplication?.processID==process.processIdentifier && $0.frame.width>200 && $0.frame.height>150}).max(by:{$0.frame.width*$0.frame.height < $1.frame.width*$1.frame.height}) else {fputs("OFFSCREEN_WINDOW_UNAVAILABLE\n",stderr);exit(8)}
   let screen=CGDisplayBounds(CGMainDisplayID());let intersection=window.frame.intersection(screen)
   print("OFFSCREEN_WINDOW frame=\(window.frame) visibleOnMain=\(!intersection.isEmpty && !intersection.isNull)")
   let config=SCStreamConfiguration();config.width=Int(window.frame.width);config.height=Int(window.frame.height);config.minimumFrameInterval=CMTime(value:1,timescale:10);config.queueDepth=3
   let stream=SCStream(filter:SCContentFilter(desktopIndependentWindow:window),configuration:config,delegate:nil), counter=Counter()
   try stream.addStreamOutput(counter,type:.screen,sampleHandlerQueue:DispatchQueue(label:"offscreen.frames"));try await stream.startCapture();try await Task.sleep(nanoseconds:4_000_000_000);try await stream.stopCapture()
   print("OFFSCREEN_FRAME_COUNT=\(counter.count())")
   guard intersection.isEmpty || intersection.isNull else {fputs("SOURCE_STILL_ON_SCREEN\n",stderr);exit(9)}
   guard counter.count()>=2 else {fputs("OFFSCREEN_STREAM_UNAVAILABLE\n",stderr);exit(10)}
   print("OFFSCREEN_TEST_PASSED; account login and input untested")
  } catch { fputs("OFFSCREEN_ERROR \(error.localizedDescription)\n",stderr);exit(11) }
 }
}
