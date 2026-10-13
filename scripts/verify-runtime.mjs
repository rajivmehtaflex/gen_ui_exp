import { runProcessTree } from "../server/process-runner.mjs";

export function runStep(options) {
  return runProcessTree(options);
}

export async function withTestServer(startServer, runChecks) {
  let server;
  try {
    server = await startServer();
    return await runChecks(server);
  } finally {
    if (server) await server.stop();
  }
}
