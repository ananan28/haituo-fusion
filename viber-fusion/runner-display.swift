import CoreGraphics
import Foundation
let display=CGMainDisplayID()
guard let modes=CGDisplayCopyAllDisplayModes(display,nil) as? [CGDisplayMode] else { fatalError("RUNNER_DISPLAY_MODES_UNAVAILABLE") }
for mode in modes { print("RUNNER_MODE=\(mode.width)x\(mode.height)") }
guard let mode=modes.filter({$0.width>=1440 && $0.height>=900}).sorted(by:{$0.width*$0.height < $1.width*$1.height}).first else { fatalError("RUNNER_DISPLAY_TOO_SMALL: real Viber minimum geometry cannot fit this runner") }
let result=CGDisplaySetDisplayMode(display,mode,nil)
guard result == .success else { fatalError("RUNNER_DISPLAY_CHANGE_FAILED: \(result.rawValue)") }
print("RUNNER_DISPLAY=\(CGDisplayPixelsWide(display))x\(CGDisplayPixelsHigh(display))")
