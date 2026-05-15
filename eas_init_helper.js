const { spawn } = require('child_process');
const child = spawn('npx', ['eas-cli', 'init'], {
  cwd: process.argv[2] || '.',
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
});

let output = '';
child.stdout.on('data', (data) => {
  output += data.toString();
  process.stdout.write(data);
  if (data.toString().includes('Would you like to create')) {
    setTimeout(() => {
      child.stdin.write('Y\n');
    }, 500);
  }
});

child.stderr.on('data', (data) => {
  process.stderr.write(data);
});

child.on('close', (code) => {
  console.log('\nDone with code:', code);
  process.exit(code);
});
