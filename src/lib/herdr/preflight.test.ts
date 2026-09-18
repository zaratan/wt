import { describe, it, expect } from "vitest";
import {
  candidateSocketPaths,
  socketWasPinned,
  supports,
} from "./preflight.js";

describe("candidateSocketPaths", () => {
  it("uses the default socket when nothing is pinned", () => {
    expect(candidateSocketPaths({ HOME: "/home/me" })).toEqual([
      "/home/me/.config/herdr/herdr.sock",
    ]);
  });

  it("uses ONLY the pinned socket, never the default as a fallback", () => {
    const paths = candidateSocketPaths({
      HOME: "/home/me",
      HERDR_SOCKET_PATH: "/tmp/session/herdr.sock",
    });
    expect(paths).toEqual(["/tmp/session/herdr.sock"]);
    expect(paths).not.toContain("/home/me/.config/herdr/herdr.sock");
  });

  it("ignores an empty pin", () => {
    expect(
      candidateSocketPaths({ HOME: "/home/me", HERDR_SOCKET_PATH: "" }),
    ).toEqual(["/home/me/.config/herdr/herdr.sock"]);
  });
});

describe("socketWasPinned", () => {
  it("is true only for a non-empty value", () => {
    expect(socketWasPinned({ HERDR_SOCKET_PATH: "/x.sock" })).toBe(true);
    expect(socketWasPinned({ HERDR_SOCKET_PATH: "" })).toBe(false);
    expect(socketWasPinned({})).toBe(false);
  });
});

describe("supports", () => {
  it("reads a capability rather than a protocol number", () => {
    const pong = {
      protocol: 22,
      capabilities: { live_handoff: true, old: false },
    };
    expect(supports(pong, "live_handoff")).toBe(true);
    expect(supports(pong, "old")).toBe(false);
    expect(supports(pong, "absent")).toBe(false);
  });
});
