import { dev } from "astro";

/** Starts one isolated server on an automatically selected free port and stops it after the run. */
export default async function setup() {
  const previousKey = process.env.RESTOCK_SECRET_KEY;
  const previousURL = process.env.LABEL_TEST_BASE_URL;
  process.env.RESTOCK_SECRET_KEY = "test-key";
  let server;
  const restore = () => {
    if (previousKey === undefined) delete process.env.RESTOCK_SECRET_KEY;
    else process.env.RESTOCK_SECRET_KEY = previousKey;
    if (previousURL === undefined) delete process.env.LABEL_TEST_BASE_URL;
    else process.env.LABEL_TEST_BASE_URL = previousURL;
  };
  try {
    server = await dev({
      server: { host: "127.0.0.1", port: 0, open: false },
      vite: { server: { strictPort: false } },
    });
    const baseURL = `http://127.0.0.1:${server.address.port}`;
    process.env.LABEL_TEST_BASE_URL = baseURL;
    const response = await fetch(`${baseURL}/label-printer?key=test-key`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(`Label test server returned HTTP ${response.status}`);
    console.log(`Label test server: ${baseURL}`);
  } catch (error) {
    try {
      await server?.stop();
    } finally {
      restore();
    }
    throw error;
  }
  return async () => {
    try {
      await server.stop();
    } finally {
      restore();
    }
  };
}
