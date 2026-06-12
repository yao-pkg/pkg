import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sniffBinaryTarget } from '../../lib/sea';

// sniffBinaryTarget reads a binary's magic bytes to decide whether a supplied
// custom base Node binary matches the requested SEA target's platform/arch.
// These fixtures are minimal but real headers (ELF / Mach-O / PE).

function elf(machine: number, le = true): Buffer {
  const b = Buffer.alloc(64);
  b[0] = 0x7f;
  b[1] = 0x45;
  b[2] = 0x4c;
  b[3] = 0x46; // 0x7f E L F
  b[4] = 2; // ELFCLASS64
  b[5] = le ? 1 : 2; // EI_DATA
  if (le) b.writeUInt16LE(machine, 18);
  else b.writeUInt16BE(machine, 18); // e_machine
  return b;
}

function macho(cpu: number): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0); // 64-bit little-endian on disk: CF FA ED FE
  b.writeUInt32LE(cpu, 4); // cputype
  return b;
}

function pe(machine: number): Buffer {
  const b = Buffer.alloc(0x100);
  b[0] = 0x4d;
  b[1] = 0x5a; // MZ
  b.writeUInt32LE(0x80, 0x3c); // e_lfanew
  b[0x80] = 0x50;
  b[0x81] = 0x45; // 'PE'
  b.writeUInt16LE(machine, 0x84); // COFF machine
  return b;
}

describe('sniffBinaryTarget', () => {
  let dir: string;
  const write = (name: string, buf: Buffer): string => {
    const p = path.join(dir, name);
    writeFileSync(p, buf);
    return p;
  };

  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'pkg-sniff-'));
  });
  after(() => {
    /* tmpdir left for the OS to reap; fixtures are tiny */
  });

  it('detects ELF x64 / arm64', async () => {
    assert.deepEqual(await sniffBinaryTarget(write('elf-x64', elf(0x3e))), {
      format: 'elf',
      arch: 'x64',
    });
    assert.deepEqual(await sniffBinaryTarget(write('elf-arm64', elf(0xb7))), {
      format: 'elf',
      arch: 'arm64',
    });
  });

  it('detects big-endian ELF too', async () => {
    assert.equal(
      (await sniffBinaryTarget(write('elf-be', elf(0xb7, false)))).arch,
      'arm64',
    );
  });

  it('detects Mach-O x64 / arm64', async () => {
    assert.deepEqual(
      await sniffBinaryTarget(write('macho-x64', macho(0x01000007))),
      { format: 'macho', arch: 'x64' },
    );
    assert.deepEqual(
      await sniffBinaryTarget(write('macho-arm64', macho(0x0100000c))),
      { format: 'macho', arch: 'arm64' },
    );
  });

  it('detects PE x64 / arm64', async () => {
    assert.deepEqual(await sniffBinaryTarget(write('pe-x64', pe(0x8664))), {
      format: 'pe',
      arch: 'x64',
    });
    assert.deepEqual(await sniffBinaryTarget(write('pe-arm64', pe(0xaa64))), {
      format: 'pe',
      arch: 'arm64',
    });
  });

  it('returns {} for an unrecognised / too-short file', async () => {
    assert.deepEqual(
      await sniffBinaryTarget(write('garbage', Buffer.alloc(64, 0x55))),
      {},
    );
    assert.deepEqual(
      await sniffBinaryTarget(write('tiny', Buffer.alloc(4))),
      {},
    );
  });

  it('returns {} for a nonexistent path (caller skips the check)', async () => {
    assert.deepEqual(
      await sniffBinaryTarget(path.join(dir, 'does-not-exist')),
      {},
    );
  });

  it('maps unknown machine types to undefined arch but keeps the format', async () => {
    const res = await sniffBinaryTarget(write('elf-mips', elf(0x08)));
    assert.equal(res.format, 'elf');
    assert.equal(res.arch, undefined);
  });
});
