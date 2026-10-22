param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]
function Await($Operation,[Type]$ResultType) {
 $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
 $task=$method.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
 $task.GetAwaiter().GetResult()
}
# OCR engines can miss a 15px line in a tightly cropped 25px strip.
Add-Type -AssemblyName System.Drawing
$source=[System.Drawing.Bitmap]::FromFile($ImagePath)
$originalWidth=$source.Width;$originalHeight=$source.Height;$pad=24.0
$scale=[Math]::Min(3.0,4096.0/([Math]::Max($originalWidth,$originalHeight)+$pad*2))
$prepared=[System.Drawing.Bitmap]::new([int](($originalWidth+$pad*2)*$scale),[int](($originalHeight+$pad*2)*$scale))
$graphics=[System.Drawing.Graphics]::FromImage($prepared)
try {
 $graphics.Clear([System.Drawing.Color]::White)
 $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
 $graphics.DrawImage($source,[single]($pad*$scale),[single]($pad*$scale),[single]($originalWidth*$scale),[single]($originalHeight*$scale))
 $preparedPath=Join-Path (Split-Path -Parent $ImagePath) 'prepared.png'
 $prepared.Save($preparedPath,[System.Drawing.Imaging.ImageFormat]::Png)
} finally {$graphics.Dispose();$prepared.Dispose();$source.Dispose()}
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($preparedPath)) ([Windows.Storage.StorageFile])
$stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
 $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 try {
  $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if($null -eq $engine){throw 'No OCR language pack installed. Install a language OCR pack in Windows Settings.'}
  $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  if([string]::IsNullOrWhiteSpace($result.Text)){
   $null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
   $english=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
   if($null -ne $english){$result=Await ($english.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])}
  }
  $blocks=@(foreach($line in $result.Lines){
   $left=[double]::PositiveInfinity;$top=[double]::PositiveInfinity;$right=0.0;$bottom=0.0
   foreach($word in $line.Words){$r=$word.BoundingRect;$left=[Math]::Min($left,$r.X);$top=[Math]::Min($top,$r.Y);$right=[Math]::Max($right,$r.X+$r.Width);$bottom=[Math]::Max($bottom,$r.Y+$r.Height)}
   if($right -gt $left -and $bottom -gt $top){@{original=$line.Text;x=[Math]::Max(0,($left/$scale-$pad)*1000/$originalWidth);y=[Math]::Max(0,($top/$scale-$pad)*1000/$originalHeight);width=($right-$left)/$scale*1000/$originalWidth;height=($bottom-$top)/$scale*1000/$originalHeight}}
  })
  @{blocks=$blocks}|ConvertTo-Json -Depth 5 -Compress
 } finally {$bitmap.Dispose()}
} finally {$stream.Dispose()}
