import { describe, expect, it } from "vitest";
import { money, plural, since, tone } from "./format";

describe("format", () => {
  it("since", () => expect([since(5), since(125), since(7300)]).toEqual(["5s", "2m", "2h"]));
  it("tone uses the TUI bar thresholds", () => expect([tone(10), tone(60), tone(85)]).toEqual(["good", "warn", "bad"]));
  it("money and plural", () => expect([money(2.5), plural(1, "chat"), plural(2, "chat")]).toEqual(["$2.50", "1 chat", "2 chats"]));
});
