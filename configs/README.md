# Configuration System

This directory contains Ottehr's configuration management system based on symlinks.

## Structure

```
configs/
├── public/              # Git-tracked default configuration (ottehr)
│   ├── .env/           # Environment templates
│   ├── oystehr/        # Oystehr IaC configuration
│   ├── oystehr-core/   # Core configuration
│   ├── ottehr-config/  # TypeScript configuration module
│   ├── apps/           # App public assets
│   └── zambdas/        # Zambda assets
├── secrets/            # Git-ignored, your configuration profiles
│   ├── ottehr/         # Default profile
│   └── <profile>/      # Custom profiles
├── scripts/            # Configuration management scripts
│   ├── use.ts          # Switch configuration profiles
│   ├── who.ts          # Show current configuration and health status
│   └── utils.ts        # Shared utilities
├── config-mapping.ts   # Directory mapping definitions
└── tsconfig.json       # TypeScript config
```

## Quick Start

```bash
# Set up configs/secrets/ (see "Setting Up configs/secrets/" below)
./dev clone secrets          # OR create manually: mkdir -p configs/secrets/myprofile

# Activate configuration
./dev use ottehr             # default profile
./dev use myprofile          # custom profile
```

## How It Works

The system uses symlinks to connect configuration sources to their destinations:

1. **Public sources** (`configs/public/`) contain default, git-tracked configuration
2. **Secret sources** (`configs/secrets/{profile}/`) contain environment-specific secrets
3. When you run `./dev use <profile>`, symlinks are created from sources to destinations

### Symlink Priority

When both public and secret sources exist for a path:
- Public files are symlinked first
- Secret files override (replace symlinks) for any overlapping paths

This allows profiles to override specific files while inheriting defaults.

## Commands

| Command | Description |
|---------|-------------|
| `./dev use <profile> [workspace]` | Switch profile and terraform workspace |
| `./dev who` | Show current configuration and health status |
| `./dev who -v` | Show detailed configuration with file lists |
| `./dev clone secrets [branch]` | One-time setup (or create `configs/secrets/` manually) |
| `./dev help` | Show all available commands |

### Arguments

- **profile** - Configuration profile from `configs/secrets/` (e.g., `ottehr`, `myprofile`)
- **workspace** - Terraform workspace filter (default: `local`). Controls which `.tfvars` and `{workspace}_*.tf` files are symlinked

### Terraform Integration

When switching profiles:
1. Clears `.terraform/` cache (required when backend config changes)
2. Symlinks only the selected workspace's terraform files

**Note:** After switching profiles, run `npm run terraform-init` and `terraform workspace select <workspace>` manually in `deploy/` when needed.

**Terraform files symlinked to `deploy/`:**
| Pattern | Behavior |
|---------|----------|
| `*.tfvars` | Only `{workspace}.tfvars` (e.g., `staging.tfvars`) |
| `{workspace}_*.tf` | Only matching workspace (e.g., `staging_import.tf`) |
| All other files | Always symlinked |

**Note:** All `.tf` files without a workspace prefix (like `removed-resources.tf`, `main.tf`) and all non-tf files (like `backend.config`) are always symlinked regardless of the selected workspace.

```bash
./dev use ottehr              # workspace: local (default)
./dev use ottehr staging      # workspace: staging
./dev use myprofile production  # workspace: production
```

## Adding New Configuration Paths

1. Add the mapping to `config-mapping.ts`:
   ```typescript
   {
     dest: 'path/to/destination',
     publicSource: 'path/in/configs/public',
     secretsSource: 'path/in/profile',
   }
   ```

2. Update `.gitignore` to ignore the destination directory

3. If there are tracked files that should remain (like templates), add exclusions:
   ```gitignore
   path/to/destination/
   !path/to/destination/template.file
   ```

## CI/CD Usage

```bash
./dev clone secrets [branch]  # or provide configs/secrets/ via other means
./dev use ottehr [workspace]
```

## Setting Up configs/secrets/

**Option 1:** Clone from a private repository:
```bash
./dev clone secrets
```

**Option 2:** Create manually (for forks/custom setups):
```bash
mkdir -p configs/secrets/ottehr
# Add your configuration files following the profile structure
```

Each profile directory should mirror the structure expected by `config-mapping.ts`.

## What ./dev use Does

Switches all configuration to a specific profile:
1. Removes old symlinks from destination directories
2. Creates symlinks from `configs/public/` (defaults)
3. Creates symlinks from `configs/secrets/<profile>/` (overrides, fails if would overwrite git-tracked files)
4. Clears build caches (Vite, turbo)
5. Clears `.terraform/` cache
6. Runs validation and shows result

## Validation (./dev who)

Shows current configuration status and checks:
- No mixed profiles: All symlinks point to `configs/public/` or ONE specific profile
- No broken symlinks (missing source files)

Use `./dev who -v` for detailed file list.

## Troubleshooting

### Node.js Version

**Minimum required: Node.js 22.16.0**

If you encounter module resolution errors, ensure you're using Node.js 22.16.0+.

### Windows: Enable Developer Mode

If you are using Windows OS, symlinks require Developer Mode: Settings → Update & Security → For developers → Developer Mode → On

### Module Resolution Errors with Symlinks

If you see errors like `Cannot find module '...'` or `does not provide an export named`:

**Vite/Build errors:** All `vite.config.ts` files must include:
```typescript
resolve: { preserveSymlinks: true }
```

**tsx script errors:** Scripts must use `NODE_OPTIONS='--preserve-symlinks'`:
```bash
NODE_OPTIONS='--preserve-symlinks' npx tsx script.ts
# or
node --preserve-symlinks -r tsx/cjs script.ts
```

**Playwright/E2E tests:** Use `cross-env` with NODE_OPTIONS:
```bash
cross-env NODE_OPTIONS='--preserve-symlinks --import tsx/esm' npx playwright test
```

**fs.readdir with symlinks:** When using `withFileTypes`, check both:
```typescript
.filter((f) => f.isFile() || f.isSymbolicLink())
```

### "No configuration active"

Run `./dev use <profile>` to activate a configuration.

### "Secrets not found"

Create `configs/secrets/` directory with at least one profile, or clone from your secrets repository.

### "Mixed profiles detected"

Symlinks point to different profiles. Run `./dev use <profile>` to fix.

### "Broken symlinks"

Source files missing. Update your `configs/secrets/` or re-run `./dev use <profile>`.

### VS Code: Nested Git Repository Not Visible

If `configs/secrets/` contains a git repository but it doesn't appear in VS Code's Source Control tab, restart VS Code to detect the nested repository.

### Running ./dev from subdirectories

The `./dev` command must be run from the project root. To run from any subdirectory, add a function to `~/.zshrc`.

**Note:** Avoid naming it `dev` globally — it may conflict with other tools or be unclear in a global context. Use a project-specific name like `ehr`:

```bash
# Ottehr CLI - runs ./dev from any subdirectory
ehr() {
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    if [[ -x "$dir/dev" ]] && [[ -f "$dir/package.json" ]]; then
      "$dir/dev" "$@"
      return
    fi
    dir="$(dirname "$dir")"
  done
  echo "Error: Not in an ottehr project"
  return 1
}
```

Then use `ehr` instead of `./dev`:
```bash
ehr use ottehr
ehr who
```
