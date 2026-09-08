import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { jsonToolCallObserver } from "./observability";
import { createArcanaMcpServer } from "./server";

const observer = jsonToolCallObserver({ transport: "stdio" });
serveStdio(() => createArcanaMcpServer({ onToolCall: observer }));
