import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRateRequest } from "../server/nodeHandler.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  void handleRateRequest(req, res);
}
