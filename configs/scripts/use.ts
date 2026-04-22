#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { DIR_MAPPINGS, PUBLIC_SOURCE, SECRETS_SOURCE } from '../config-mapping';
import {
  info,
  success,
  warn,
  error,
  header,
  getProjectRoot,
  getPublicDir,
  getSecretsDir,
  secretsExist,
  ensureDir,
  isSymlink,
  listConfigs,
} from './utils';

const VALID_WORKSPACES = ['local', 'development', 'staging', 'testing', 'demo', 'production', 'e2e', 'e2e2', 'e2e3'];

function showUsage(): void {
  console.log('Usage: npx tsx configs/scripts/use.ts <profile> [workspace] [flags]\n');
  console.log('Arguments:');
  console.log('  profile     Configuration profile from configs/secrets/');
  console.log('  workspace   Terraform workspace filter (default: local)');
  console.log('              Symlinks only: {workspace}.tfvars, {workspace}_*.tf');
  console.log('');
  console.log('Flags:');
  console.log('  -v, --verbose     Show detailed file list');
  console.log('');
  console.log('Available profiles:');
  console.log('  ottehr              Default configuration');
  const configs = listConfigs();
  if (configs.length > 0) {
    configs
      .filter((c) => c !== 'ottehr')
      .forEach((c) => console.log(`  ${c}`));
  } else if (!secretsExist()) {
    console.log('\n  (Set up configs/secrets/ first - see configs/README.md)');
  }
  console.log('');
  console.log(`Workspaces: ${VALID_WORKSPACES.join(', ')}`);
}

function isTrackedByGit(filePath: string): boolean {
  try {
    execSync(`git ls-files --error-unmatch "${filePath}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function cleanSymlinks(dirPath: string): number {
  let count = 0;
  if (!fs.existsSync(dirPath)) return count;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (isSymlink(fullPath)) {
      fs.unlinkSync(fullPath);
      count++;
    } else if (entry.isDirectory()) {
      count += cleanSymlinks(fullPath);
      try {
        const remaining = fs.readdirSync(fullPath);
        if (remaining.length === 0) {
          fs.rmdirSync(fullPath);
        }
      } catch {}
    }
  }
  return count;
}

interface SymlinkOptions {
  filter?: (filename: string) => boolean;
}

function symlinkDir(
  sourceDir: string,
  destDir: string,
  root: string,
  conflicts: string[],
  options: SymlinkOptions = {}
): number {
  let count = 0;
  if (!fs.existsSync(sourceDir)) return count;

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (options.filter && !options.filter(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const relativeDest = path.relative(root, destPath);

    if (entry.isDirectory()) {
      ensureDir(destPath);
      count += symlinkDir(sourcePath, destPath, root, conflicts, options);
    } else {
      if (fs.existsSync(destPath)) {
        if (isSymlink(destPath)) {
          fs.unlinkSync(destPath);
        } else if (isTrackedByGit(destPath)) {
          conflicts.push(relativeDest);
          continue;
        } else {
          fs.unlinkSync(destPath);
        }
      }

      ensureDir(path.dirname(destPath));
      const relativeTarget = path.relative(path.dirname(destPath), sourcePath);
      fs.symlinkSync(relativeTarget, destPath);
      count++;
    }
  }
  return count;
}

function createTerraformFilter(workspace: string): (filename: string) => boolean {
  return (filename: string) => {
    if (filename.endsWith('.tfvars')) {
      return filename === `${workspace}.tfvars`;
    }
    if (filename.endsWith('.tf')) {
      for (const ws of VALID_WORKSPACES) {
        if (filename.startsWith(`${ws}_`)) {
          return ws === workspace;
        }
      }
    }
    return true;
  };
}

function applyConfig(profile: string, workspace: string, verbose: boolean): void {
  const root = getProjectRoot();
  const publicDir = getPublicDir();
  const secretsDir = getSecretsDir();
  const profileSecretsDir = path.join(secretsDir, profile);

  if (!fs.existsSync(profileSecretsDir)) {
    error(`Profile not found: configs/secrets/${profile}`);
    if (!secretsExist()) {
      console.log('\nSet up configs/secrets/ first - see configs/README.md');
    } else {
      const available = listConfigs().join(', ');
      console.log(`\nAvailable profiles: ${available}`);
    }
    process.exit(1);
  }

  const wsLabel = workspace === 'local' ? '' : ` [${workspace}]`;
  header(`Switching to ${profile === 'ottehr' ? 'ottehr (default)' : profile}${wsLabel}`);

  let totalSymlinks = 0;
  let totalCleaned = 0;
  const allConflicts: string[] = [];

  for (const mapping of DIR_MAPPINGS) {
    const destPath = path.join(root, mapping.dest);
    const conflicts: string[] = [];

    ensureDir(destPath);

    const cleaned = cleanSymlinks(destPath);
    totalCleaned += cleaned;

    const isTerraform = mapping.dest === 'deploy';
    const options: SymlinkOptions = isTerraform ? { filter: createTerraformFilter(workspace) } : {};

    if (mapping.publicSource) {
      const publicSourcePath = path.join(publicDir, mapping.publicSource);
      if (fs.existsSync(publicSourcePath)) {
        totalSymlinks += symlinkDir(publicSourcePath, destPath, root, conflicts, options);
      }
    }

    if (mapping.secretsSource) {
      const secretsSourcePath = path.join(profileSecretsDir, mapping.secretsSource);
      if (fs.existsSync(secretsSourcePath)) {
        totalSymlinks += symlinkDir(secretsSourcePath, destPath, root, conflicts, options);
      }
    }

    allConflicts.push(...conflicts);
  }

  if (allConflicts.length > 0) {
    error(`\nCONFLICT: The following files are tracked in git AND exist in secrets:`);
    for (const conflict of allConflicts) {
      console.log(`  ${conflict}`);
    }
    console.log('\nThis can cause bugs. Please resolve by either:');
    console.log('  1. Remove the file from main repo: git rm <file> && add to .gitignore');
    console.log('  2. Remove the file from secrets repo');
    process.exit(1);
  }

  success(`Cleaned ${totalCleaned} old symlinks`);
  success(`Created ${totalSymlinks} new symlinks`);

  info('Clearing caches...');
  const cacheDirs = [
    'node_modules/.vite',
    'apps/ehr/node_modules/.vite',
    'apps/intake/node_modules/.vite',
    '.turbo',
  ];
  for (const cacheDir of cacheDirs) {
    const cachePath = path.join(root, cacheDir);
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { recursive: true, force: true });
    }
  }
  success('Caches cleared');

  const terraformDir = path.join(root, 'deploy', '.terraform');
  if (fs.existsSync(terraformDir)) {
    info('Clearing .terraform cache...');
    fs.rmSync(terraformDir, { recursive: true, force: true });
    success('.terraform cleared');
  }

  console.log('');
  const whoCmd = verbose ? 'npx tsx configs/scripts/who.ts -v' : 'npx tsx configs/scripts/who.ts';
  execSync(whoCmd, { cwd: root, stdio: 'inherit' });
}

function main(): void {
  const rawArgs = process.argv.slice(2);
  const verbose = rawArgs.includes('-v') || rawArgs.includes('--verbose');
  const args = rawArgs.filter(a => !['-v', '--verbose'].includes(a));

  if (args.length === 0 || args[0] === '--help') {
    showUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const profile = args[0];
  const workspace = args[1] || 'local';

  if (!VALID_WORKSPACES.includes(workspace)) {
    error(`Invalid workspace: ${workspace}`);
    console.log(`\nValid workspaces: ${VALID_WORKSPACES.join(', ')}`);
    process.exit(1);
  }

  if (!secretsExist()) {
    error('Secrets not found. Set up configs/secrets/ - see configs/README.md');
    process.exit(1);
  }

  applyConfig(profile, workspace, verbose);
}

main();
