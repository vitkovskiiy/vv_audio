import { execSync } from 'node:child_process';

/** commit the running code was built from; GIT_SHA wins so deployments don't need .git */
function readSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export const version = {
  sha: readSha(),
  startedAt: new Date().toISOString(),
};
