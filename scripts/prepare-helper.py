from pathlib import Path
import os,subprocess
app=Path('macos/staging/app');source=app/'native/WindowHelper.cs'
compiler=Path(os.environ['SystemRoot'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if not compiler.is_file():raise RuntimeError('Windows C# compiler is required to package window helper')
out=source.with_name('HaituoWindowHelper.exe')
if source.is_file():
    subprocess.run([str(compiler),'/nologo','/target:winexe','/platform:x64','/optimize+','/out:'+str(out),str(source)],check=True)
    subprocess.run([str(out),'--self-test'],check=True)
    source.unlink()
    print('Compiled and loaded dedicated x64 window helper; no runtime shell required')
else:
    # The release build already compiled and consumed the source in this
    # staging tree; the runtime-test phase rebuilds from the same staging,
    # so only prove the existing helper still loads.
    if not out.is_file():raise RuntimeError('Window helper source consumed but HaituoWindowHelper.exe missing; re-run the full build')
    subprocess.run([str(out),'--self-test'],check=True)
    print('Window helper already compiled; self-test passed')
