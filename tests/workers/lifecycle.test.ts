import { describe, expect, test } from "vitest";

import { createOxc, parse, transform } from "../../src/index";
import { expectFailure, expectOk } from "./helpers";

describe("Oxc lifecycle", () => {
  test("top-level helpers support repeated calls", async () => {
    expect.hasAssertions();

    expectOk(await parse({ filename: "src/one.tsx", source: `export const one = <p>one</p>;` }));
    expectOk(
      await transform({ filename: "src/one.tsx", source: `export const one = <p>one</p>;` }),
    );
    expectOk(await parse({ filename: "src/two.tsx", source: `export const two = <p>two</p>;` }));
    expectOk(
      await transform({ filename: "src/two.tsx", source: `export const two = <p>two</p>;` }),
    );
  });

  test("an instance recovers after syntax failures", async () => {
    expect.hasAssertions();

    const oxc = await createOxc();

    expectFailure(
      await oxc.parse({ filename: "src/broken.tsx", source: `export const broken = <div>;` }),
    );
    expectOk(
      await oxc.parse({ filename: "src/recovered.tsx", source: `export const value = <p>ok</p>;` }),
    );

    expectFailure(
      await oxc.transform({ filename: "src/broken.tsx", source: `export const broken = <div>;` }),
    );
    expectOk(
      await oxc.transform({
        filename: "src/recovered.tsx",
        source: `export const value = <p>ok</p>;`,
      }),
    );
  });
});
