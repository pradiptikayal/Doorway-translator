import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { handleMessage, handleClose } from "./server/handlers";

const projectRoot = process.cwd();
dotenv.config({ path: path.resolve(projectRoot, ".env") });
dotenv.config({ path: path.resolve(projectRoot, ".env.local"), override: true });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (clientWs: WebSocket) => {
    console.log("New WebSocket client connected");

    clientWs.on("message", async (messageBuffer) => {
      try {
        await handleMessage(clientWs, messageBuffer);
      } catch (err: any) {
        console.error("Error processing client message:", err);
        clientWs.send(JSON.stringify({ type: "error", error: err.message || String(err) }));
      }
    });

    clientWs.on("close", () => {
      handleClose(clientWs);
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} (http://0.0.0.0:${PORT})`);
  });
}

startServer();
