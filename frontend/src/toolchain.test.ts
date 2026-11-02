import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

const repositoryFile = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

const NODE_VERSION = repositoryFile('frontend/.node-version').trim();
const WORKFLOWS_BUILDING_THE_FRONTEND = ['docker-publish', 'e2e', 'security-scan'];

function majorMinorPatch(version: string): number[] {
  return version.split('.').map(Number);
}

describe('one Node version everywhere', () => {
  it('the image builds with the pinned version', () => {
    expect(repositoryFile('Dockerfile')).toContain(`FROM node:${NODE_VERSION}-slim AS frontend`);
  });

  it.each(WORKFLOWS_BUILDING_THE_FRONTEND)('workflow %s reads the pinned version', (workflow) => {
    const source = repositoryFile(`.github/workflows/${workflow}.yml`);
    expect(source).toContain('node-version-file: frontend/.node-version');
    expect(source).not.toMatch(/node-version:/);
  });

  it('the pinned version satisfies the declared minimum', () => {
    const minimum = majorMinorPatch(packageJson.engines.node.replace('>=', ''));
    const pinned = majorMinorPatch(NODE_VERSION);
    const firstDifference = pinned.findIndex((part, index) => part !== minimum[index]);
    const meetsMinimum = firstDifference === -1 || pinned[firstDifference] > minimum[firstDifference];
    expect(meetsMinimum).toBe(true);
  });
});

describe('release gate', () => {
  const publishWorkflow = repositoryFile('.github/workflows/docker-publish.yml');

  it('publishing waits for every check', () => {
    expect(publishWorkflow).toContain('needs: [verify-backend, verify-frontend, verify-context, verify-e2e]');
  });

  it.each([
    'python manage.py test --settings=config.settings_test',
    'makemigrations --check',
    'npm run lint',
    'npx tsc --noEmit',
    'npm test',
    'scripts/check-build-context.sh',
  ])('the gate runs %s', (command) => {
    expect(publishWorkflow).toContain(command);
  });

  it('the end-to-end workflow can be required by publishing', () => {
    expect(repositoryFile('.github/workflows/e2e.yml')).toContain('workflow_call:');
  });

  it('the published digest is what gets scanned and recorded', () => {
    expect(publishWorkflow).toContain('${{ steps.build-and-push.outputs.digest }}');
    expect(publishWorkflow).toContain('sbom: true');
  });
});

describe('operator documentation and configuration', () => {
  const productionCompose = repositoryFile('docker-compose.prod.yml');

  it.each(['EMAIL_HOST', 'EMAIL_HOST_PASSWORD', 'SSL_REDIRECT', 'NUM_PROXIES', 'TOTP_ENC_KEY', 'EXPORT_MAX_BYTES'])(
    'production passes %s through to the application',
    (variable) => {
      expect(productionCompose).toContain(`- ${variable}=`);
    },
  );

  it('does not advertise updates that do not exist', () => {
    expect(repositoryFile('README.md')).not.toContain('SW_AUTO_UPDATE_YTDLP');
    expect(productionCompose).not.toContain('SW_AUTO_UPDATE_YTDLP');
  });

  it('Makefile uses current commands and never deletes data', () => {
    const makefile = repositoryFile('Makefile');
    expect(makefile).not.toContain('docker-compose ');
    expect(makefile).not.toContain('backend/manage.py');
    expect(makefile).not.toContain('down -v');
    expect(makefile).not.toContain('rm -rf');
  });

  it('the recovery runbook is linked from the README', () => {
    expect(repositoryFile('README.md')).toContain('docs/BACKUP_RESTORE.md');
    expect(repositoryFile('.gitignore')).toContain('!docs/BACKUP_RESTORE.md');
  });
});

