import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createArcanaMcpServer } from "./server";

serveStdio(() => createArcanaMcpServer());
