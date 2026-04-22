#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as path from 'path';
import { DIR_MAPPINGS, PUBLIC_SOURCE } from '../config-mapping';
import {
  info,
  success,
  warn,
  error,
  header,
  getProjectRoot,
  getPublicDir,
  secretsExist,
  publicExists,
  colors,
  findSymlinksInDir,
  analyzeProfileStatus,
  SymlinkInfo,
} from './utils';

const REQUIRED_DIRS = ['config/oystehr', 'packages/utils/lib/ottehr-config'];

const EXPECTED_GITIGNORE_PATTERNS = [
  'configs/secrets/',
  'config/oystehr/',
  'config/.env/',
  'packages/utils/lib/ottehr-config/',
  'apps/ehr/public/',
  'apps/intake/public/',
  'apps/ehr/env/',
  'apps/intake/env/',
  'packages/zambdas/assets/',
  'packages/zambdas/.env/',
  'deploy/',
];

interface MappingStats {
  dest: string;
  publicCount: number;
  secretsCount: number;
  publicFiles: string[];
  secretsFiles: string[];
}

function checkGitignore(root: string): string[] {
  const warnings: string[] = [];
  const gitignorePath = path.join(root, '.gitignore');
  
  if (!fs.existsSync(gitignorePath)) {
    warnings.push('.gitignore not found');
    return warnings;
  }

  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  for (const pattern of EXPECTED_GITIGNORE_PATTERNS) {
    if (!gitignore.includes(pattern)) {
      warnings.push(`Missing gitignore pattern: ${pattern}`);
    }
  }
  
  return warnings;
}

function detectTerraformEnv(root: string): string | null {
  const deployDir = path.join(root, 'deploy');
  if (!fs.existsSync(deployDir)) return null;

  try {
    const entries = fs.readdirSync(deployDir);
    for (const entry of entries) {
      if (entry.endsWith('.tfvars')) {
        const fullPath = path.join(deployDir, entry);
        try {
          if (fs.lstatSync(fullPath).isSymbolicLink()) {
            return entry.replace('.tfvars', '');
          }
        } catch {}
      }
    }
  } catch {}
  return null;
}

function checkConfig(verbose: boolean, quiet: boolean): void {
  const root = getProjectRoot();
  const publicDir = getPublicDir();

  let allSymlinks: SymlinkInfo[] = [];
  const mappingStats: MappingStats[] = [];

  for (const mapping of DIR_MAPPINGS) {
    const destPath = path.join(root, mapping.dest);
    const symlinks = findSymlinksInDir(destPath, root, publicDir);
    allSymlinks.push(...symlinks);

    const publicFiles = symlinks.filter(s => s.source === 'public' && !s.broken);
    const secretsFiles = symlinks.filter(s => s.source === 'secrets' && !s.broken);

    mappingStats.push({
      dest: mapping.dest,
      publicCount: publicFiles.length,
      secretsCount: secretsFiles.length,
      publicFiles: publicFiles.map(s => s.path),
      secretsFiles: secretsFiles.map(s => s.path),
    });
  }

  const status = analyzeProfileStatus(allSymlinks);
  const { activeProfile, hasPublicSymlinks, secretsProfiles, brokenSymlinks, isMixed } = status;

  if (quiet) {
    if (activeProfile) {
      console.log(activeProfile);
      process.exit(0);
    } else if (allSymlinks.length === 0) {
      process.exit(1);
    } else if (isMixed) {
      console.log(`mixed: ${Array.from(secretsProfiles).join(', ')}`);
      process.exit(1);
    } else {
      process.exit(1);
    }
  }

  const missingReqDirs: string[] = [];
  for (const reqDir of REQUIRED_DIRS) {
    const destPath = path.join(root, reqDir);
    const reqSymlinks = findSymlinksInDir(destPath, root, publicDir);
    if (reqSymlinks.length === 0) {
      missingReqDirs.push(reqDir);
    }
  }

  header('Current Configuration Status');

  let hasIssues = false;

  if (!publicExists()) {
    error('configs/public/ directory not found');
    hasIssues = true;
  }

  if (!secretsExist()) {
    warn('configs/secrets/ not found (see configs/README.md)');
  }

  const gitignoreWarnings = checkGitignore(root);
  if (gitignoreWarnings.length > 0) {
    warn('Gitignore issues:');
    for (const w of gitignoreWarnings) {
      console.log(`  ${colors.YELLOW}⚠${colors.NC} ${w}`);
    }
    hasIssues = true;
  }

  if (allSymlinks.length === 0 && !secretsExist()) {
    error('No configuration active and secrets not found');
    console.log('\nSetup instructions:');
    console.log('  1. Set up configs/secrets/ (see configs/README.md)');
    console.log('  2. Activate config: ./dev use <profile>');
    process.exit(1);
  }

  if (allSymlinks.length === 0) {
    warn('No configuration active');
    console.log('\nActivate a configuration:');
    console.log('  ./dev use ottehr        # Use default ottehr config');
    console.log('  ./dev use <profile>     # Use extended profile');
    process.exit(1);
  }

  if (activeProfile) {
    const label = activeProfile === 'ottehr' ? 'ottehr (default)' : activeProfile;
    success(`Active configuration: ${colors.BOLD}${label}${colors.NC}`);
  } else if (isMixed) {
    const profileList = Array.from(secretsProfiles).join(', ');
    console.log(`${colors.RED}✗ Mixed profiles detected: ${profileList}${colors.NC}`);
    console.log('Run ./dev use <profile> to fix');
  } else {
    warn('No active configuration detected');
    console.log('Run ./dev use <profile> to activate');
  }

  const terraformEnv = detectTerraformEnv(root);
  if (terraformEnv) {
    info(`Terraform env: ${colors.BOLD}${terraformEnv}${colors.NC}`);
  }

  const totalPublic = mappingStats.reduce((sum, m) => sum + m.publicCount, 0);
  const totalSecrets = mappingStats.reduce((sum, m) => sum + m.secretsCount, 0);

  console.log('');
  console.log(`${colors.BOLD}Source breakdown:${colors.NC}`);
  console.log(`  From configs/public/ (core):    ${colors.CYAN}${totalPublic}${colors.NC} files`);
  const profileLabel = activeProfile && activeProfile !== 'ottehr' ? activeProfile : 'profile';
  console.log(`  From configs/secrets/ (${profileLabel}): ${colors.GREEN}${totalSecrets}${colors.NC} files`);

  if (missingReqDirs.length > 0) {
    console.log('');
    warn(`Missing symlinks in required directories:`);
    for (const dir of missingReqDirs) {
      console.log(`  - ${dir}`);
    }
  }

  if (verbose && totalPublic > 0) {
    console.log('');
    console.log(`${colors.BOLD}${colors.CYAN}Files from core (configs/public/):${colors.NC}`);
    for (const stat of mappingStats) {
      if (stat.publicCount > 0) {
        console.log(`  ${colors.BOLD}${stat.dest}/${colors.NC}`);
        for (const file of stat.publicFiles) {
          const shortPath = file.replace(stat.dest + '/', '');
          console.log(`    ${shortPath}`);
        }
      }
    }
  }

  if (verbose && totalSecrets > 0) {
    console.log('');
    console.log(`${colors.BOLD}${colors.GREEN}Files from profile (configs/secrets/):${colors.NC}`);
    for (const stat of mappingStats) {
      if (stat.secretsCount > 0) {
        console.log(`  ${colors.BOLD}${stat.dest}/${colors.NC}`);
        for (const file of stat.secretsFiles) {
          const shortPath = file.replace(stat.dest + '/', '');
          console.log(`    ${shortPath}`);
        }
      }
    }
  }

  if (brokenSymlinks.length > 0) {
    console.log('');
    console.log(`${colors.RED}Broken symlinks:${colors.NC}`);
    for (const sym of brokenSymlinks) {
      console.log(`  ${sym.path} -> ${sym.target}`);
    }
  }

  if (brokenSymlinks.length > 0 || missingReqDirs.length > 0 || hasIssues) {
    process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v') || args.includes('--verbose');
  const quiet = args.includes('--quiet') || args.includes('-q');

  checkConfig(verbose, quiet);
}

main();
