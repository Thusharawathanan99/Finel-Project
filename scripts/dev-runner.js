#!/usr/bin/env node
/**
 * CareConnect Unified Development Runner
 * Starts required services concurrently with colored log prefixes and graceful shutdown.
 * 
 * Usage:
 *   node scripts/dev-runner.js web        -> Express API + Vite Web Frontend (HMR enabled)
 *   node scripts/dev-runner.js app        -> Caretaker & Patient Mobile Apps (Expo Fast Refresh)
 *   node scripts/dev-runner.js all        -> Backend API + Donut ML + Vite Frontend + Expo Mobile
 *   node scripts/dev-runner.js donut      -> Donut ML OCR Server
 *   node scripts/dev-runner.js caretaker  -> Caretaker Expo Mobile App
 *   node scripts/dev-runner.js patient    -> Patient Expo Mobile App
 */

const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const isWindows = os.platform() === 'win32';

const ROOT_DIR = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'web';

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

function canImportPython(pythonCommand, pythonArgs = []) {
  const result = spawnSync(pythonCommand, [...pythonArgs, '-c', 'import fastapi, torch, transformers'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 5000,
  });
  return result.status === 0;
}

function resolveDonutCommand() {
  const virtualEnvPython = path.join(ROOT_DIR, '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
  if (fs.existsSync(virtualEnvPython) && canImportPython(virtualEnvPython)) {
    return { cmd: virtualEnvPython, args: ['donut_server.py'] };
  }
  if (isWindows && canImportPython('py.exe', ['-3.11'])) {
    return { cmd: 'py.exe', args: ['-3.11', 'donut_server.py'] };
  }
  if (canImportPython(isWindows ? 'python.exe' : 'python3')) {
    return { cmd: isWindows ? 'python.exe' : 'python3', args: ['donut_server.py'] };
  }
  return null;
}

const donutCommand = resolveDonutCommand();

const serviceConfigs = {
  backend: {
    name: 'BACKEND',
    color: colors.green,
    cwd: path.join(ROOT_DIR, '4-system-engine', 'api'),
    cmd: isWindows ? 'node.exe' : 'node',
    args: ['index.js'],
    desc: 'Express API Server (http://localhost:3001)',
  },
  frontend: {
    name: 'WEB-UI ',
    color: colors.cyan,
    cwd: path.join(ROOT_DIR, '1-ui-ux'),
    cmd: isWindows ? 'cmd.exe' : 'npm',
    args: isWindows ? ['/c', 'npm', 'run', 'dev'] : ['run', 'dev'],
    desc: 'Vite React Web Dashboard (http://localhost:5173 with HMR)',
  },
  donut: {
    name: 'DONUT-ML',
    color: colors.magenta,
    cwd: path.join(ROOT_DIR, '3-prescription-reader', 'server'),
    cmd: donutCommand?.cmd,
    args: donutCommand?.args || [],
    desc: 'Donut ML OCR Server (http://localhost:8000)',
  },
  caretaker: {
    name: 'CARETAKER',
    color: colors.yellow,
    cwd: path.join(ROOT_DIR, '6-caretaker'),
    cmd: isWindows ? 'cmd.exe' : 'npx',
    args: isWindows ? ['/c', 'npx', 'expo', 'start', '--offline', '--web', '--port', '8081'] : ['expo', 'start', '--offline', '--web', '--port', '8081'],
    desc: 'Caretaker Mobile App (Expo Metro Web with Fast Refresh)',
  },
  patient: {
    name: 'PATIENT',
    color: colors.blue,
    cwd: path.join(ROOT_DIR, '5-patient'),
    cmd: isWindows ? 'cmd.exe' : 'npx',
    args: isWindows ? ['/c', 'npx', 'expo', 'start', '--offline', '--web', '--port', '8082'] : ['expo', 'start', '--offline', '--web', '--port', '8082'],
    desc: 'Patient Mobile App (Expo Metro Web with Fast Refresh)',
  },
};

let selectedServices = [];

switch (mode.toLowerCase()) {
  case 'web':
    selectedServices = ['backend', 'frontend'];
    break;
  case 'app':
  case 'mobile':
    selectedServices = ['backend', 'caretaker', 'patient'];
    break;
  case 'caretaker':
    selectedServices = ['backend', 'caretaker'];
    break;
  case 'patient':
    selectedServices = ['backend', 'patient'];
    break;
  case 'donut':
    selectedServices = ['donut'];
    break;
  case 'all':
    selectedServices = ['backend', 'donut', 'frontend', 'caretaker', 'patient'];
    break;
  default:
    selectedServices = ['backend', 'frontend'];
}

if (selectedServices.includes('donut') && !donutCommand) {
  console.error(`${colors.red}[DONUT-ML] Python 3.11 with FastAPI, PyTorch, and Transformers is unavailable. Run the Donut setup instructions before starting this service.${colors.reset}`);
  if (mode.toLowerCase() === 'donut') process.exit(1);
  selectedServices = selectedServices.filter(service => service !== 'donut');
}

console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`${colors.bold}  CareConnect Unified Development Runner [mode: ${mode.toUpperCase()}]${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════════${colors.reset}`);
console.log('Starting services:');
selectedServices.forEach(s => {
  const conf = serviceConfigs[s];
  console.log(`  ${conf.color}• [${conf.name}]${colors.reset} ${conf.desc}`);
});
console.log(`${colors.bold}${colors.cyan}──────────────────────────────────────────────────────────────────${colors.reset}\n`);

const children = [];

selectedServices.forEach(key => {
  const cfg = serviceConfigs[key];
  try {
    const child = spawn(cfg.cmd, cfg.args, {
      cwd: cfg.cwd,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.on('error', error => {
      console.error(`[${cfg.name}] Could not start: ${error.message}. Check this service's installation and executable path.`);
      process.exitCode = 1;
    });

    child.stdout.on('data', data => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim().length > 0) {
          console.log(`${cfg.color}[${cfg.name}]${colors.reset} ${line}`);
        }
      });
    });

    child.stderr.on('data', data => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim().length > 0) {
          console.error(`${cfg.color}[${cfg.name}]${colors.reset} ${colors.red}${line}${colors.reset}`);
        }
      });
    });

    child.on('close', code => {
      console.log(`${cfg.color}[${cfg.name}]${colors.reset} exited with code ${code}`);
    });

    children.push(child);
  } catch (err) {
    console.error(`Failed to launch ${cfg.name}:`, err);
  }
});

function cleanup() {
  console.log(`\n${colors.yellow}Shutting down all development services...${colors.reset}`);
  children.forEach(child => {
    try {
      if (isWindows) {
        if (child.pid) spawn('taskkill', ['/pid', child.pid, '/f', '/t']).on('error', () => {});
      } else {
        child.kill('SIGTERM');
      }
    } catch (_) {}
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
