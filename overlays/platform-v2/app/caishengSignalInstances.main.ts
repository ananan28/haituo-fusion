// Copyright 2026 Caisheng
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';

const INSTANCE_ARGUMENT = '--caisheng-signal-instance=';
const INSTANCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export type CaishengSignalInstanceStatus = Readonly<{
  id: string;
  running: boolean;
  pid?: number;
}>;

function validateInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !INSTANCE_ID.test(value)) {
    throw new Error('Signal instance id must be 1-64 letters, digits, _ or -');
  }
  return value;
}

export function getCurrentCaishengSignalInstanceId(): string | undefined {
  return process.argv
    .find(arg => arg.startsWith(INSTANCE_ARGUMENT))
    ?.slice(INSTANCE_ARGUMENT.length);
}

export class CaishengSignalInstanceManager {
  readonly #children = new Map<string, ChildProcess>();

  async start(value: unknown): Promise<CaishengSignalInstanceStatus> {
    if (getCurrentCaishengSignalInstanceId() !== undefined) {
      throw new Error('A Signal account instance cannot launch another instance');
    }

    const id = validateInstanceId(value);
    const current = this.#children.get(id);
    if (current !== undefined && current.exitCode === null && !current.killed) {
      return { id, running: true, pid: current.pid };
    }

    const args = app.isPackaged
      ? [`${INSTANCE_ARGUMENT}${id}`]
      : [
          ...process.argv.slice(1).filter(arg => !arg.startsWith(INSTANCE_ARGUMENT)),
          `${INSTANCE_ARGUMENT}${id}`,
        ];
    const child = spawn(process.execPath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('exit', () => this.#children.delete(id));
    this.#children.set(id, child);

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', error => {
        this.#children.delete(id);
        reject(error);
      });
    });
    return { id, running: true, pid: child.pid };
  }

  stop(value: unknown): boolean {
    const id = validateInstanceId(value);
    const child = this.#children.get(id);
    if (child === undefined) {
      return false;
    }
    this.#children.delete(id);
    return child.kill();
  }

  list(): ReadonlyArray<CaishengSignalInstanceStatus> {
    return [...this.#children.entries()].map(([id, child]) => ({
      id,
      running: child.exitCode === null && !child.killed,
      pid: child.pid,
    }));
  }

  stopAll(): void {
    for (const child of this.#children.values()) {
      child.kill();
    }
    this.#children.clear();
  }
}
