import { shellQuote } from './scope';

export type ShellResult = {
  output: string;
  exit?: number;
  status: 'running' | 'exited' | 'timeout' | 'killed';
};

export type TransactionIo = {
  read: (path: string) => Promise<string | undefined>;
  write: (path: string, content: string) => Promise<void>;
  shell: (root: string, command: string) => Promise<ShellResult>;
};

export type ConfigTransactionOptions = {
  io: TransactionIo;
  root: string;
  target: string;
  content: string;
};

export type ConfigTransactionResult = {
  backupPath?: string;
  created: boolean;
};

export class ConfigTransactionError extends Error {
  constructor(message: string, readonly backupPath?: string) {
    super(message);
    this.name = 'ConfigTransactionError';
  }
}

export function configBackupPath(target: string) {
  return `${target}.opencode-mobile.bak`;
}

function tempPath(target: string) {
  return `${target}.opencode-mobile.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
}

function checked(result: ShellResult, action: string) {
  if (result.status !== 'exited' || result.exit !== 0) {
    throw new Error(`Could not ${action} the configuration file.`);
  }
}

async function shellChecked(io: TransactionIo, root: string, command: string, action: string) {
  const result = await io.shell(root, command);
  checked(result, action);
  return result;
}

async function removeTemp(io: TransactionIo, root: string, path: string) {
  await io.shell(root, `rm -f ${shellQuote(path)}`).catch(() => undefined);
}

async function restore(io: TransactionIo, root: string, target: string, backup: string) {
  const restoreTemp = tempPath(target);
  await shellChecked(io, root, `cp -p ${shellQuote(backup)} ${shellQuote(restoreTemp)}`, 'restore');
  await shellChecked(io, root, `mv -f ${shellQuote(restoreTemp)} ${shellQuote(target)}`, 'restore');
}

/**
 * Replace a config file through a same-directory temp file. The target is
 * never opened for writing, so a failed write cannot truncate the live file.
 * A backup is written before the atomic rename and is reused by the rollback.
 */
export async function writeConfigTransaction({ io, root, target, content }: ConfigTransactionOptions): Promise<ConfigTransactionResult> {
  const current = await io.read(target);
  const backup = current === undefined ? undefined : configBackupPath(target);
  const temp = tempPath(target);

  try {
    if (current !== undefined) {
      await shellChecked(io, root, `cp -p ${shellQuote(target)} ${shellQuote(temp)}`, 'prepare');
    }
    await io.write(temp, content);
    if (current === undefined) {
      await shellChecked(io, root, `chmod 600 ${shellQuote(temp)}`, 'secure');
    }
    if ((await io.read(temp)) !== content) {
      throw new ConfigTransactionError('The temporary configuration file did not verify.');
    }

    const latest = await io.read(target);
    if (latest !== current) {
      throw new ConfigTransactionError('The configuration file changed while it was being edited. Nothing was written.');
    }

    if (backup) {
      await shellChecked(io, root, `cp -p ${shellQuote(target)} ${shellQuote(backup)}`, 'back up');
      await shellChecked(io, root, `chmod 600 ${shellQuote(backup)}`, 'secure the backup');
    }

    const beforeRename = await io.read(target);
    if (beforeRename !== current) {
      throw new ConfigTransactionError('The configuration file changed while it was being edited. Nothing was written.');
    }

    await shellChecked(io, root, `mv -f ${shellQuote(temp)} ${shellQuote(target)}`, 'replace');

    if ((await io.read(target)) !== content) {
      if (backup) {
        await restore(io, root, target, backup);
      } else {
        await io.shell(root, `rm -f ${shellQuote(target)}`).catch(() => undefined);
      }
      throw new ConfigTransactionError('The saved configuration did not verify and was rolled back.', backup);
    }

    return { backupPath: backup, created: current === undefined };
  } catch (error) {
    await removeTemp(io, root, temp);
    throw error;
  }
}

export async function restoreConfigBackup({
  io,
  root,
  target,
  backup,
}: {
  io: TransactionIo;
  root: string;
  target: string;
  backup: string;
}) {
  const current = await io.read(target);
  const safety = current === undefined ? undefined : `${configBackupPath(target)}.pre-restore`;
  if (safety) {
    await shellChecked(io, root, `cp -p ${shellQuote(target)} ${shellQuote(safety)}`, 'back up');
    await shellChecked(io, root, `chmod 600 ${shellQuote(safety)}`, 'secure the backup');
  }
  const expected = await io.read(backup);
  if (expected === undefined) throw new Error('The configuration backup is no longer available.');
  try {
    await restore(io, root, target, backup);
    if ((await io.read(target)) !== expected) {
      throw new Error('The restored configuration did not verify.');
    }
    return { backupPath: safety };
  } catch (error) {
    if (safety) await restore(io, root, target, safety).catch(() => undefined);
    throw error;
  }
}
