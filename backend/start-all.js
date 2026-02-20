/**
 * Monorepo startup script for production deployment (Render)
 * Launches both Node.js backend and Python ingestion service
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting opus backend + ingestion service...');

// Start Python ingestion service
const pythonProcess = spawn('python', [
  '-m', 'uvicorn', 'main:app',
  '--host', '0.0.0.0',
  '--port', process.env.INGESTION_PORT || '8001'
], {
  cwd: join(__dirname, 'ingestion-service'),
  stdio: 'inherit'
});

pythonProcess.on('error', (err) => {
  console.error('❌ Failed to start ingestion service:', err);
  process.exit(1);
});

pythonProcess.on('exit', (code, signal) => {
  console.error(`❌ Ingestion service exited with code ${code} and signal ${signal}`);
  process.exit(code || 1);
});

// Wait 2 seconds for Python service to start
setTimeout(() => {
  console.log('✅ Ingestion service started');
  console.log('🚀 Starting Node.js backend...');

  // Start Node.js backend
  const nodeProcess = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      INGESTION_SIDECAR_URL: `http://localhost:${process.env.INGESTION_PORT || '8001'}`
    }
  });

  nodeProcess.on('error', (err) => {
    console.error('❌ Failed to start backend:', err);
    pythonProcess.kill();
    process.exit(1);
  });

  nodeProcess.on('exit', (code, signal) => {
    console.error(`❌ Backend exited with code ${code} and signal ${signal}`);
    pythonProcess.kill();
    process.exit(code || 1);
  });

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📴 Received SIGTERM, shutting down gracefully...');
    pythonProcess.kill('SIGTERM');
    nodeProcess.kill('SIGTERM');
    setTimeout(() => process.exit(0), 5000);
  });

  process.on('SIGINT', () => {
    console.log('📴 Received SIGINT, shutting down gracefully...');
    pythonProcess.kill('SIGINT');
    nodeProcess.kill('SIGINT');
    setTimeout(() => process.exit(0), 5000);
  });

  console.log('✅ Backend started');
  console.log('🎉 All services running successfully');
}, 2000);
