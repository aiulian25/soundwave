import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

describe('background workers', () => {
  const supervisor = repositoryFile('docker_assets/run.sh');
  const downloadQueue = repositoryFile('backend/config/celery.py').match(/DOWNLOAD_QUEUE_NAME = '([a-z]+)'/)?.[1];

  it('a worker consumes each queue, and no worker consumes both', () => {
    expect(downloadQueue).toBeDefined();
    const queueOptions = supervisor.match(/--queues=\S+/g);
    expect(queueOptions).toEqual(['--queues=celery', `--queues=${downloadQueue}`]);
  });

  it('the download worker is supervised with the others', () => {
    const pidLists = supervisor.match(/"\$WORKER_PID".*/g) ?? [];
    expect(pidLists.length).toBeGreaterThanOrEqual(3);
    pidLists.forEach((pidList) => expect(pidList).toContain('"$DOWNLOAD_WORKER_PID"'));
  });

  it('production can size the download worker', () => {
    expect(repositoryFile('docker-compose.prod.yml')).toContain('- DOWNLOAD_WORKER_CONCURRENCY=');
  });
});

describe('installed app', () => {
  const manifest = JSON.parse(repositoryFile('frontend/public/manifest.json'));

  it('a link shared to the app lands on a page the app has', () => {
    expect(manifest.share_target.method).toBe('GET');
    expect(repositoryFile('frontend/src/App.tsx')).toContain(`<Route path="${manifest.share_target.action}"`);
  });
});

describe('settings page', () => {
  it('every switch changes something', () => {
    const switches = repositoryFile('frontend/src/pages/SettingsPage.tsx').match(/<Switch\b[^]*?\/>/g) ?? [];

    expect(switches.length).toBeGreaterThan(0);
    expect(switches.filter((control) => !control.includes('onChange='))).toEqual([]);
  });
});

describe('questions and notices', () => {
  const sourceFiles = (readdirSync(resolve(__dirname), { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'));

  it('no page falls back to the browser\'s own confirm or alert box', () => {
    const usingBrowserDialogs = sourceFiles.filter((file) =>
      /(^|[^.\w])(window\.)?(confirm|alert)\(/.test(readFileSync(join(__dirname, file), 'utf8')));

    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(usingBrowserDialogs).toEqual([]);
  });
});

describe('supply chain', () => {
  const workflowDirectory = resolve(__dirname, '../../.github/workflows');
  const workflows = readdirSync(workflowDirectory).map((file) => readFileSync(join(workflowDirectory, file), 'utf8'));
  // What branch protection on main requires. Renaming one of these jobs without updating the
  // rule blocks every pull request, which is how eight dependency updates sat open for weeks.
  const REQUIRED_CHECKS = ['Code, deps & config', 'Backend tests and migration drift', 'e2e'];

  it('every action is pinned to a commit, with its version beside it', () => {
    const actions = workflows.flatMap((source) => source.match(/uses: \S+.*/g) ?? []).filter((use) => !use.includes('./'));

    expect(actions.length).toBeGreaterThan(20);
    expect(actions.filter((use) => !/uses: \S+@[0-9a-f]{40} # v\d/.test(use))).toEqual([]);
  });

  it('the checks branch protection requires are jobs that exist', () => {
    const jobNames = workflows.flatMap((source) => [
      ...(source.match(/^ {4}name: (.+)$/gm) ?? []).map((line) => line.replace(/^ {4}name: /, '')),
      ...(source.match(/^ {2}([\w-]+):$/gm) ?? []).map((line) => line.trim().replace(':', '')),
    ]);

    expect(REQUIRED_CHECKS.filter((check) => !jobNames.includes(check))).toEqual([]);
  });

  it.each(['docker-compose.prod.yml', 'docker-compose.yml'])('%s names a major version for every image it pulls', (compose) => {
    const images = repositoryFile(compose).match(/image: \S+/g) ?? [];
    const floating = images.filter((image) => !/:(main|latest|\d)/.test(image) || /:(alpine|latest)$/.test(image));

    expect(images.length).toBeGreaterThan(1);
    expect(floating).toEqual([]);
  });
});

describe('maintainability', () => {
  const MAX_SOURCE_LINES = 1000;
  const MAX_LINT_WARNINGS = 25;

  it('no source file is longer than a thousand lines', () => {
    const tooLong = (readdirSync(resolve(__dirname), { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
      .filter((file) => readFileSync(join(__dirname, file), 'utf8').split('\n').length > MAX_SOURCE_LINES);

    expect(tooLong).toEqual([]);
  });

  it('the lint warning allowance only ever goes down', () => {
    const allowance = Number(packageJson.scripts.lint.match(/--max-warnings (\d+)/)?.[1]);

    expect(allowance).toBeLessThanOrEqual(MAX_LINT_WARNINGS);
  });
});

