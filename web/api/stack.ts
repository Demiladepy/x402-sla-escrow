import type { IncomingMessage, ServerResponse } from "node:http";
import { handleStackRequest } from "../server/nodeHandler.js";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  handleStackRequest(req, res);
}
