import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
export function runtimeCommand(): { executable: string; args: string[]; cwd: string } {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'signal-runtime') : path.join(app.getAppPath(), 'resources', 'signal-runtime');
  const executable = path.join(base, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const lib = path.join(base, 'signal-cli', 'lib');
  if (!fs.existsSync(executable) || !fs.existsSync(lib) || !fs.existsSync(path.join(base, 'runtime-manifest.json'))) {
    throw new Error('RUNTIME_MISSING');
  }
  return { executable, args: ['--enable-native-access=ALL-UNNAMED', '-Xms32m', '-Xmx256m', '-cp', path.join(lib, '*'), 'org.asamk.signal.Main'], cwd: base };
}
