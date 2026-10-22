from pathlib import Path
import os,subprocess
app=Path('macos/staging/app');source=app/'native/WindowHelper.cs'
compiler=Path(os.environ['SystemRoot'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if not compiler.is_file():raise RuntimeError('Windows C# compiler is required to package window helper')
out=source.with_name('HaituoWindowHelper.exe')
subprocess.run([str(compiler),'/nologo','/target:winexe','/platform:x64','/optimize+','/out:'+str(out),str(source)],check=True)
subprocess.run([str(out),'--self-test'],check=True)
source.unlink()
print('Compiled and loaded dedicated x64 window helper; no runtime shell required')
