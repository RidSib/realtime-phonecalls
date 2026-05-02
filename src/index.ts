import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const cfg = loadConfig();
const server = createServer(cfg);

server.listen(cfg.port, () => {
  console.log(
    `bridge listening on :${cfg.port} public=${cfg.publicUrl} ` +
      `provider=${cfg.realtimeProvider}`,
  );
});
