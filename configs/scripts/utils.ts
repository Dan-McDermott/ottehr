import * as fs from 'fs';
import * as path from 'path';
import { PUBLIC_SOURCE, SECRETS_SOURCE } from '../config-mapping';

export const colors = {
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  BOLD: '\x1b[1m',
  NC: '\x1b[0m',
};

export function info(msg: string): void {
  console.log(`${colors.BLUE}▸${colors.NC} ${msg}`);
}

export function success(msg: string): void {
  console.log(`${colors.GREEN}✓${colors.NC} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${colors.YELLOW}⚠${colors.NC} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${colors.RED}✗${colors.NC} ${msg}`);
}

export function header(msg: string): void {
  console.log(`\n${colors.BOLD}${colors.CYAN}═══ ${msg} ═══${colors.NC}\n`);
}

export function getProjectRoot(): string {
  let dir = __dirname;
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === 'ottehr') {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not find project root');
}

export function getPublicDir(): string {
  return path.join(getProjectRoot(), PUBLIC_SOURCE);
}

export function getSecretsDir(): string {
  return path.join(getProjectRoot(), SECRETS_SOURCE);
}

export function secretsExist(): boolean {
  return fs.existsSync(getSecretsDir());
}

export function publicExists(): boolean {
  return fs.existsSync(getPublicDir());
}

export function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolveSymlinkTarget(filePath: string): string | null {
  try {
    if (!isSymlink(filePath)) return null;
    const target = fs.readlinkSync(filePath);
    if (path.isAbsolute(target)) return target;
    return path.resolve(path.dirname(filePath), target);
  } catch {
    return null;
  }
}

export function isSymlinkBroken(filePath: string): boolean {
  if (!isSymlink(filePath)) return false;
  const resolved = resolveSymlinkTarget(filePath);
  if (!resolved) return true;
  return !fs.existsSync(resolved);
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function listConfigs(): string[] {
  const secretsDir = getSecretsDir();
  if (!fs.existsSync(secretsDir)) return [];
  return fs
    .readdirSync(secretsDir)
    .filter((name: string) => {
      const fullPath = path.join(secretsDir, name);
      return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
    })
    .sort();
}

export interface SymlinkInfo {
  path: string;
  target: string;
  profile: string;
  source: 'public' | 'secrets' | 'unknown';
  broken: boolean;
}

export interface ProfileStatus {
  activeProfile: string | null;
  hasPublicSymlinks: boolean;
  secretsProfiles: Set<string>;
  symlinks: SymlinkInfo[];
  brokenSymlinks: SymlinkInfo[];
  isMixed: boolean;
}

export interface TargetInfo {
  profile: string;
  source: 'public' | 'secrets' | 'unknown';
}

export function getTargetInfo(target: string, publicDir: string): TargetInfo {
  if (target.startsWith(publicDir)) {
    return { profile: 'ottehr', source: 'public' };
  }
  const secretsMatch = target.match(/configs\/secrets\/([^/]+)/);
  if (secretsMatch) {
    return { profile: secretsMatch[1], source: 'secrets' };
  }
  return { profile: 'unknown', source: 'unknown' };
}

export function findSymlinksInDir(
  dirPath: string,
  root: string,
  publicDir: string
): SymlinkInfo[] {
  const symlinks: SymlinkInfo[] = [];
  if (!fs.existsSync(dirPath)) return symlinks;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (isSymlink(fullPath)) {
      const target = resolveSymlinkTarget(fullPath);
      const broken = isSymlinkBroken(fullPath);
      const relativePath = path.relative(root, fullPath);
      const info = target ? getTargetInfo(target, publicDir) : { profile: 'unknown', source: 'unknown' as const };

      symlinks.push({
        path: relativePath,
        target: target || 'broken',
        profile: info.profile,
        source: info.source,
        broken,
      });
    } else if (entry.isDirectory()) {
      symlinks.push(...findSymlinksInDir(fullPath, root, publicDir));
    }
  }
  return symlinks;
}

export function analyzeProfileStatus(symlinks: SymlinkInfo[]): ProfileStatus {
  const brokenSymlinks: SymlinkInfo[] = [];
  const secretsProfiles = new Set<string>();
  let hasPublicSymlinks = false;

  for (const sym of symlinks) {
    if (sym.broken) {
      brokenSymlinks.push(sym);
    } else if (sym.source === 'public') {
      hasPublicSymlinks = true;
    } else if (sym.source === 'secrets' && sym.profile !== 'unknown') {
      secretsProfiles.add(sym.profile);
    }
  }

  const isMixed = secretsProfiles.size > 1;

  const activeProfile = secretsProfiles.size === 1
    ? Array.from(secretsProfiles)[0]
    : secretsProfiles.size === 0 && hasPublicSymlinks
      ? 'ottehr'
      : null;

  return {
    activeProfile,
    hasPublicSymlinks,
    secretsProfiles,
    symlinks,
    brokenSymlinks,
    isMixed,
  };
}
