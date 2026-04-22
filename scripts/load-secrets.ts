// todo: remove this script and use the ./dev CLI instead
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SECRETS_REPO = 'git@github.com:masslight/ottehr-secrets.git';
const SECRETS_DIR = './configs/secrets';

function exec(command: string, cwd?: string): void {
  execSync(command, { stdio: 'inherit', cwd });
}

function main(): void {
  const args = process.argv.slice(2);
  const projectName = args[0];
  const branchName = args[1] || 'main';

  if (!projectName) {
    console.error('Error: project_name is required');
    console.error('Usage: npm run load-secrets <project_name> [branch_name] [environment]');
    console.error('\nAlternatively, use the ./dev CLI:');
    console.error('  ./dev clone secrets [branch]');
    console.error('  ./dev use <project_name>');
    process.exit(1);
  }

  console.log(`Loading secrets for project: ${projectName} (branch: ${branchName})`);

  if (fs.existsSync(SECRETS_DIR)) {
    console.log('Secrets directory exists, updating...');
    exec(`git checkout ${branchName}`, SECRETS_DIR);
    exec(`git pull origin ${branchName}`, SECRETS_DIR);
  } else {
    console.log('Cloning secrets repository...');
    fs.mkdirSync(path.dirname(SECRETS_DIR), { recursive: true });
    exec(`git clone --branch ${branchName} ${SECRETS_REPO} ${SECRETS_DIR}`);
  }

  const projectPath = path.join(SECRETS_DIR, projectName);
  if (!fs.existsSync(projectPath)) {
    console.error(`Error: Project '${projectName}' not found in secrets repository`);
    const available = fs
      .readdirSync(SECRETS_DIR)
      .filter((f) => fs.statSync(path.join(SECRETS_DIR, f)).isDirectory() && !f.startsWith('.'));
    console.error(`Available: ${available.join(', ')}`);
    process.exit(1);
  }

  console.log(`Activating ${projectName} configuration...`);
  exec(`npx tsx configs/scripts/use.ts ${projectName}`);

  const terraformDir = './deploy/.terraform';
  if (fs.existsSync(terraformDir)) {
    console.log('Removing .terraform directory to force reinitialization...');
    fs.rmSync(terraformDir, { recursive: true, force: true });
  }

  console.log(`\n✅ Secrets loaded successfully for ${projectName}`);
}

main();
