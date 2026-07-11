# Doorway Translator - Future Roadmap & TODOs

This file outlines the prioritized TODO list for scaling, securing, and optimizing the **Doorway** real-time translation system. It serves as a guide for transitioning this dual-phone prototype into a production-grade application.

---

## 🔴 Phase 1: High Priority (Security & Reliability)

- [ ] **Implement Rate Limiting on Passcode Attempts**
  - *Goal*: Secure private rooms from brute-forcing.
  - *Details*: Enforce an IP or connection-based cooling-off block (e.g., 15 minutes) after 5 consecutive incorrect passcode entries.
  - *Target*: `server.ts` WebSocket connection handler.

- [ ] **Enforce Maximum WebSocket Payload Size**
  - *Goal*: Guard against memory exhaustion and thread-blocking (DoS) attacks.
  - *Details*: Configure the server to reject frames exceeding a reasonable threshold (e.g., 150KB).
  - *Target*: `WebSocketServer` initialization config in `server.ts`.

- [ ] **Introduce JSON Schema Validation**
  - *Goal*: Ensure structural validation of incoming client payloads.
  - *Details*: Use a runtime schema library like `Zod` to parse and validate incoming JSON shapes before they are processed.
  - *Target*: `server.ts` WebSocket incoming message parsers.

- [ ] **Enforce Secure Context (SSL Redirects)**
  - *Goal*: Safeguard media streams and secure mobile browser camera/microphone access.
  - *Details*: Set up HTTPS redirection middleware in the production build and prevent unencrypted `ws://` links in favor of `wss://`.
  - *Target*: Express routing layer.

---

## 🟡 Phase 2: Medium Priority (Scalability & Resilience)

- [ ] **Decouple Room States to a Redis Store**
  - *Goal*: Move state away from the server's local process memory.
  - *Details*: Replace the local `Map` stores with a fast, centralized **Redis** database to allow stateless server instances.
  - *Target*: Room state maps in `server.ts`.

- [ ] **Orchestrate Multi-Pod Delivery via Redis Pub/Sub**
  - *Goal*: Scale horizontal server containers behind a load balancer.
  - *Details*: Route audio buffers dynamically between instances. Pod A (User A) publishes audio to channel `room:roomId:B`, and Pod B (User B) subscribes and forwards it to User B.
  - *Target*: Core WebSocket delivery logic in `server.ts`.

- [ ] **Add Reconnection Grace Windows**
  - *Goal*: Prevent immediate call drops on volatile mobile connections.
  - *Details*: Allow a 30-60 second "keep-alive" window for running Gemini sessions when a WebSocket unexpectedly closes, letting clients reconnect seamlessly.
  - *Target*: Client reconnect handshake + server connection termination triggers.

---

## 🔵 Phase 3: Lower Priority (Performance & Feature UX)

- [ ] **Migrate to AudioWorklets**
  - *Goal*: Achieve high-performance, glitch-free speech capturing.
  - *Details*: Replace the deprecated, main-thread-blocking `ScriptProcessorNode` with an AudioWorklet running on a background audio thread.
  - *Target*: `src/App.tsx` audio capturing setup.

- [ ] **Optimize Streams with Raw Binary Packets**
  - *Goal*: Reduce network data usage and lag.
  - *Details*: Eliminate Base64 text encoding and transmit audio bytes directly as raw `ArrayBuffer` binaries.
  - *Target*: Client-server WS message protocols.

- [ ] **Introduce Local/Secure Chat History Logs**
  - *Goal*: Allow users to save or export their translation transcripts.
  - *Details*: Persist transcripts in browser `IndexedDB` and provide an "Export Conversation" button to download history as a PDF/Markdown file.
  - *Target*: Client state management in `src/App.tsx`.

- [ ] **Ambient Comprehension Halos**
  - *Goal*: Enhance speaker UI intuition.
  - *Details*: Render a dynamic, glowing visual halo around the screen (green = clear comprehension, yellow/amber = listener confusion) driven directly by face mesh metrics.
  - *Target*: Client component layout in `src/App.tsx`.
