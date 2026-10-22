import Foundation
import Vision
import ImageIO
import CoreGraphics
// Pad and enlarge narrow screen selections before OCR. Coordinates are mapped back to the crop.
do {
 guard CommandLine.arguments.count == 2 else { throw NSError(domain:"HaituoOCR",code:1,userInfo:[NSLocalizedDescriptionKey:"Missing image"]) }
 let url=URL(fileURLWithPath:CommandLine.arguments[1])
 guard let source=CGImageSourceCreateWithURL(url as CFURL,nil),let image=CGImageSourceCreateImageAtIndex(source,0,nil) else {throw NSError(domain:"HaituoOCR",code:2)}
 let pad=24.0,scale=min(3.0,4096.0/(Double(max(image.width,image.height))+pad*2)),width=Int((Double(image.width)+pad*2)*scale),height=Int((Double(image.height)+pad*2)*scale)
 guard let context=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue) else {throw NSError(domain:"HaituoOCR",code:3)}
 context.setFillColor(CGColor(gray:1,alpha:1));context.fill(CGRect(x:0,y:0,width:Double(width),height:Double(height)));context.interpolationQuality = .high
 context.draw(image,in:CGRect(x:pad*scale,y:pad*scale,width:Double(image.width)*scale,height:Double(image.height)*scale))
 guard let prepared=context.makeImage() else {throw NSError(domain:"HaituoOCR",code:4)}
 let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate;request.usesLanguageCorrection=true;request.minimumTextHeight=0
 if #available(macOS 13.0, *) {request.automaticallyDetectsLanguage=true}
 try VNImageRequestHandler(cgImage:prepared,options:[:]).perform([request])
 let blocks:[[String:Any]]=(request.results ?? []).compactMap { observation in
  guard let candidate=observation.topCandidates(1).first else {return nil}
  let b=observation.boundingBox,x=max(0,(b.minX*Double(width)/scale-pad)/Double(image.width)*1000),y=max(0,((1-b.maxY)*Double(height)/scale-pad)/Double(image.height)*1000)
  return ["original":candidate.string,"x":x,"y":y,"width":min(1000-x,b.width*Double(width)/scale/Double(image.width)*1000),"height":min(1000-y,b.height*Double(height)/scale/Double(image.height)*1000)]
 }
 FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:["blocks":blocks]))
} catch {FileHandle.standardError.write(Data(error.localizedDescription.utf8));exit(1)}
