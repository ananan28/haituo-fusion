import AppKit
import ApplicationServices
import ScreenCaptureKit
import CoreGraphics
import CoreMedia
import Foundation
final class Counter:NSObject,SCStreamOutput {
    private let lock=NSLock();private var value=0
    func stream(_ stream:SCStream,didOutputSampleBuffer buffer:CMSampleBuffer,of type:SCStreamOutputType){if type == .screen && buffer.isValid {lock.lock();value += 1;lock.unlock()}}
    func count()->Int {lock.lock();defer{lock.unlock()};return value}
}
@main struct Probe {
 @MainActor static func main() async {
  _ = NSApplication.shared
  guard AXIsProcessTrusted(),CGPreflightScreenCaptureAccess(),let process=NSRunningApplication.runningApplications(withBundleIdentifier:"com.haituo.viberpreview.slot5").first else {exit(2)}
  let app=AXUIElementCreateApplication(process.processIdentifier);var raw:CFTypeRef?
  guard AXUIElementCopyAttributeValue(app,kAXWindowsAttribute as CFString,&raw) == .success,let windows=raw as? [AXUIElement],let target=windows.first else {exit(3)}
  defer {_=AXUIElementSetAttributeValue(target,kAXMinimizedAttribute as CFString,kCFBooleanFalse)}
  do {
   let content=try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:true)
   guard let window=content.windows.first(where:{$0.owningApplication?.processID==process.processIdentifier && $0.frame.width>200 && $0.frame.height>150}) else {exit(4)}
   let config=SCStreamConfiguration();config.width=Int(window.frame.width);config.height=Int(window.frame.height);config.minimumFrameInterval=CMTime(value:1,timescale:10);config.queueDepth=3
   let stream=SCStream(filter:SCContentFilter(desktopIndependentWindow:window),configuration:config,delegate:nil), counter=Counter()
   try stream.addStreamOutput(counter,type:.screen,sampleHandlerQueue:DispatchQueue(label:"minimized.frames"));try await stream.startCapture()
   try await Task.sleep(nanoseconds:2_000_000_000); let before=counter.count()
   let result=AXUIElementSetAttributeValue(target,kAXMinimizedAttribute as CFString,kCFBooleanTrue)
   guard result == .success else {fputs("MINIMIZE_FAILED\n",stderr);exit(5)}
   try await Task.sleep(nanoseconds:4_000_000_000);let after=counter.count()
   try await stream.stopCapture()
   let visible=(CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []).filter {($0[kCGWindowOwnerPID as String] as? Int32)==process.processIdentifier && ($0[kCGWindowLayer as String] as? Int)==0}.count
   print("MINIMIZED_FRAME_COUNT_BEFORE=\(before) AFTER=\(after) DELTA=\(after-before) VISIBLE_WINDOWS=\(visible)")
   guard visible==0,after-before>=2 else {fputs("MINIMIZED_CAPTURE_NOT_USABLE\n",stderr);exit(6)}
   print("MINIMIZED_CAPTURE_FRAMES_PRESENT; content changes and input are UNTESTED")
  } catch {fputs("MINIMIZED_CAPTURE_ERROR \(error.localizedDescription)\n",stderr);exit(7)}
 }
}
