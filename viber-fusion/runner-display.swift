import CoreGraphics
import Foundation
let display=CGMainDisplayID()
guard let modes=CGDisplayCopyAllDisplayModes(display,nil) as? [CGDisplayMode] else { fatalError("RUNNER_DISPLAY_MODES_UNAVAILABLE") }
for mode in modes { print("RUNNER_MODE=\(mode.width)x\(mode.height)") }
guard let mode=modes.filter({$0.width>=1440 && $0.height>=900}).sorted(by:{$0.width*$0.height < $1.width*$1.height}).first else { fatalError("RUNNER_DISPLAY_TOO_SMALL: real Viber minimum geometry cannot fit this runner") }
var configuration: CGDisplayConfigRef?
guard CGBeginDisplayConfiguration(&configuration) == .success, let configuration=configuration else { fatalError("RUNNER_DISPLAY_CONFIGURATION_UNAVAILABLE") }
let configured=CGConfigureDisplayWithDisplayMode(configuration,display,mode,nil)
guard configured == .success else { CGCancelDisplayConfiguration(configuration); fatalError("RUNNER_DISPLAY_MODE_FAILED") }
let result=CGCompleteDisplayConfiguration(configuration,.forSession)
guard result == .success else { fatalError("RUNNER_DISPLAY_CHANGE_FAILED: \(result.rawValue)") }
print("RUNNER_DISPLAY=\(CGDisplayPixelsWide(display))x\(CGDisplayPixelsHigh(display))")
