import { describe, expect, test } from "bun:test";
import { createHoverController } from "../web/hover.ts";

const OPEN = 20;
const CLOSE = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness() {
  const log: string[] = [];
  const ctl = createHoverController<{ id: string }>({
    openDelay: OPEN,
    closeDelay: CLOSE,
    keyOf: (t) => t.id,
    onOpen: (t) => log.push(`open:${t.id}`),
    onClose: () => log.push("close"),
  });
  return { ctl, log };
}

describe("hover controller", () => {
  test("resting opens after the delay", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    expect(log).toEqual([]);
    await sleep(OPEN * 2);
    expect(log).toEqual(["open:a"]);
  });

  test("brushing across without resting never opens", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    ctl.leave();
    await sleep(OPEN + CLOSE + 20);
    expect(log).toEqual([]);
  });

  test("leaving closes after the grace period", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    await sleep(OPEN * 2);
    ctl.leave();
    await sleep(CLOSE / 2);
    expect(log).toEqual(["open:a"]);
    await sleep(CLOSE);
    expect(log).toEqual(["open:a", "close"]);
  });

  test("reaching the popover inside the grace period keeps it open", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    await sleep(OPEN * 2);
    ctl.leave();
    await sleep(CLOSE / 2);
    ctl.keepOpen();
    await sleep(CLOSE * 2);
    expect(log).toEqual(["open:a"]);
  });

  test("returning to the open target cancels the pending close without reopening", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    await sleep(OPEN * 2);
    ctl.leave();
    ctl.enter({ id: "a" });
    await sleep(OPEN + CLOSE + 20);
    expect(log).toEqual(["open:a"]);
  });

  test("moving to another annotation opens that one", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    await sleep(OPEN * 2);
    ctl.enter({ id: "b" });
    await sleep(OPEN * 2);
    expect(log).toEqual(["open:a", "open:b"]);
  });

  test("a slow move across the same span still rests it open", async () => {
    const { ctl, log } = harness();
    for (let i = 0; i < 6; i++) {
      ctl.enter({ id: "a" });
      await sleep(OPEN / 3);
    }
    expect(log).toEqual(["open:a"]);
  });

  test("repeated leaves do not push the close out", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    await sleep(OPEN * 2);
    for (let i = 0; i < 6; i++) {
      ctl.leave();
      await sleep(CLOSE / 3);
    }
    expect(log).toEqual(["open:a", "close"]);
  });

  test("cancel drops a pending open", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    ctl.cancel();
    await sleep(OPEN * 2);
    expect(log).toEqual([]);
  });

  test("cancel drops a pending close and forgets what was open", async () => {
    const { ctl, log } = harness();
    ctl.enter({ id: "a" });
    await sleep(OPEN * 2);
    ctl.leave();
    ctl.cancel();
    await sleep(CLOSE * 2);
    expect(log).toEqual(["open:a"]);
    ctl.enter({ id: "a" });
    await sleep(OPEN * 2);
    expect(log).toEqual(["open:a", "open:a"]);
  });

  test("keepOpen while nothing is open does not open anything", async () => {
    const { ctl, log } = harness();
    ctl.keepOpen();
    await sleep(OPEN * 2);
    expect(log).toEqual([]);
  });
});
