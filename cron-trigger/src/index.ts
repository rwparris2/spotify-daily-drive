interface Env {
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  WORKFLOW_FILE: string;
  GITHUB_REF: string;
  GITHUB_TOKEN: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatchWorkflow(env));
  },
} satisfies ExportedHandler<Env>;

async function dispatchWorkflow(env: Env): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "spotify-daily-drive-trigger",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    },
    body: JSON.stringify({ ref: env.GITHUB_REF }),
  });
  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(`workflow_dispatch failed: ${response.status} ${body}`);
  }
  console.log(`workflow_dispatch ok: ${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.WORKFLOW_FILE}`);
}
