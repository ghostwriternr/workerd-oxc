import { describe, expect, test } from "vitest";

import { createOxc, experimentalAnalyze } from "../../src/index";
import { expectOk } from "./helpers";

const SOURCE = `
  import TitleSlide, { accentColor as color } from "./slides/title";
  import type { Theme } from "./theme";

  const Slide = "shadowed";
  let count = 0;

  export function Deck(theme: Theme) {
    count += 1;
    return (
      <DeckDocument size={{ width: 960, height: 540 }}>
        <TitleSlide />
        <Slide />
        <MissingSlide color={color} />
      </DeckDocument>
    );
  }
`;

describe("experimentalAnalyze", () => {
  test("top-level experimentalAnalyze returns imports exports bindings references and unresolved facts", async () => {
    const facts = expectOk(
      await experimentalAnalyze({
        filename: "src/deck.tsx",
        source: SOURCE,
        lang: "tsx",
      }),
    );

    expect(facts.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "./slides/title",
          local: "TitleSlide",
          imported: "default",
          kind: "value",
        }),
        expect.objectContaining({
          source: "./slides/title",
          local: "color",
          imported: "accentColor",
          kind: "value",
        }),
        expect.objectContaining({
          source: "./theme",
          local: "Theme",
          imported: "Theme",
          kind: "type",
        }),
      ]),
    );

    expect(facts.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ local: "Deck", exported: "Deck", kind: "named" }),
      ]),
    );

    expect(facts.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "TitleSlide", kind: "import" }),
        expect.objectContaining({ name: "color", kind: "import" }),
        expect.objectContaining({ name: "Slide", kind: "const" }),
        expect.objectContaining({ name: "count", kind: "let", mutated: true }),
        expect.objectContaining({ name: "Deck", kind: "function" }),
      ]),
    );

    expect(facts.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "count",
          flags: expect.arrayContaining(["read", "write"]),
        }),
        expect.objectContaining({ name: "color", bindingId: expect.any(Number) }),
      ]),
    );

    expect(facts.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "DeckDocument" }),
        expect.objectContaining({ name: "MissingSlide" }),
      ]),
    );

    expect(facts.jsxTags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "DeckDocument", kind: "identifier" }),
        expect.objectContaining({
          name: "TitleSlide",
          kind: "identifier",
          bindingId: expect.any(Number),
        }),
        expect.objectContaining({
          name: "Slide",
          kind: "identifier",
          bindingId: expect.any(Number),
        }),
        expect.objectContaining({ name: "MissingSlide", kind: "identifier" }),
      ]),
    );

    const slideBinding = facts.bindings.find((binding) => binding.name === "Slide");
    const slideTag = facts.jsxTags.find((tag) => tag.name === "Slide");
    expect(slideTag?.bindingId).toBe(slideBinding?.id);

    const deckExport = facts.exports.find((exportFact) => exportFact.exported === "Deck");
    expect(deckExport?.source).toBeUndefined();
    expect(Object.hasOwn(deckExport!, "source")).toBe(false);
  });

  test("instance exposes sync experimentalAnalyze", async () => {
    const oxc = await createOxc();
    const facts = expectOk(
      oxc.experimentalAnalyze({
        filename: "src/component.tsx",
        source: `const Component = () => <Widget />;`,
      }),
    );

    expect(facts.bindings).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Component", kind: "const" })]),
    );
    expect(facts.jsxTags).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Widget" })]),
    );
  });

  test("spans are JavaScript UTF-16 string offsets", async () => {
    const source = `const emoji = "😀";\nconst after = emoji;`;
    const facts = expectOk(await experimentalAnalyze({ filename: "src/emoji.ts", source }));
    const afterBinding = facts.bindings.find((binding) => binding.name === "after");

    expect(afterBinding?.span.start).toBe(source.indexOf("after"));
    expect(source.slice(afterBinding!.span.start, afterBinding!.span.end)).toBe("after");
  });

  test("syntax errors return parse diagnostics", async () => {
    const result = await experimentalAnalyze({
      filename: "src/broken.tsx",
      source: `export const = ;`,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "parse", severity: "error", filename: "src/broken.tsx" }),
      ]),
    );
  });

  test("exports include type/value and declaration metadata", async () => {
    const facts = expectOk(
      await experimentalAnalyze({
        filename: "src/exports.tsx",
        lang: "tsx",
        source: `
          export type Theme = { accent: string };
          export interface SlideProps { title: string }
          export enum SlideKind { Title = "title" }
          export const accent = "blue";
          const local = 1;
          export { local as renamedLocal };
          export type { SlideProps as PropsAlias };
        `,
      }),
    );

    expect(facts.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "named",
          local: "Theme",
          exported: "Theme",
          exportKind: "type",
          declarationKind: "type",
        }),
        expect.objectContaining({
          kind: "named",
          local: "SlideProps",
          exported: "SlideProps",
          exportKind: "type",
          declarationKind: "interface",
        }),
        expect.objectContaining({
          kind: "named",
          local: "SlideKind",
          exported: "SlideKind",
          exportKind: "value",
          declarationKind: "enum",
        }),
        expect.objectContaining({
          kind: "named",
          local: "accent",
          exported: "accent",
          exportKind: "value",
          declarationKind: "const",
        }),
        expect.objectContaining({
          kind: "named",
          local: "local",
          exported: "renamedLocal",
          exportKind: "value",
        }),
        expect.objectContaining({
          kind: "named",
          local: "SlideProps",
          exported: "PropsAlias",
          exportKind: "type",
        }),
      ]),
    );
  });

  test("bindings distinguish params and TypeScript declaration kinds", async () => {
    const facts = expectOk(
      await experimentalAnalyze({
        filename: "src/kinds.tsx",
        lang: "tsx",
        source: `
          interface SlideProps { title: string }
          type Theme = { accent: string };
          enum SlideKind { Title = "title" }
          function render(props: SlideProps) {
            const label = props.title;
            return label;
          }
        `,
      }),
    );

    expect(facts.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "SlideProps", kind: "interface" }),
        expect.objectContaining({ name: "Theme", kind: "type" }),
        expect.objectContaining({ name: "SlideKind", kind: "enum" }),
        expect.objectContaining({ name: "Title", kind: "enum-member" }),
        expect.objectContaining({ name: "props", kind: "param" }),
      ]),
    );

    const enumBinding = facts.bindings.find((binding) => binding.name === "SlideKind");
    const enumMemberBinding = facts.bindings.find((binding) => binding.name === "Title");
    expect(enumBinding?.flags).toEqual(expect.arrayContaining(["enum"]));
    expect(enumMemberBinding?.flags).toEqual(expect.arrayContaining(["enum_member"]));

    expect(facts.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "SlideProps", kind: "type" }),
        expect.objectContaining({ name: "props", kind: "identifier" }),
      ]),
    );
  });

  test("jsx binding ids come from semantic resolution", async () => {
    const facts = expectOk(
      await experimentalAnalyze({
        filename: "src/jsx-resolution.tsx",
        lang: "tsx",
        source: `
          const ValueComponent = () => null;
          type TypeOnlyComponent = { title: string };
          const view = (
            <>
              <ValueComponent />
              <TypeOnlyComponent />
            </>
          );
        `,
      }),
    );

    const valueBinding = facts.bindings.find((binding) => binding.name === "ValueComponent");
    const typeOnlyBinding = facts.bindings.find((binding) => binding.name === "TypeOnlyComponent");
    const valueTag = facts.jsxTags.find((tag) => tag.name === "ValueComponent");
    const typeOnlyTag = facts.jsxTags.find((tag) => tag.name === "TypeOnlyComponent");

    expect(valueTag?.bindingId).toBe(valueBinding?.id);
    expect(typeOnlyBinding?.kind).toBe("type");
    expect(typeOnlyTag?.bindingId).toBeUndefined();
    expect(Object.hasOwn(typeOnlyTag!, "bindingId")).toBe(false);
  });

  test("intrinsic elements do not resolve to lexical bindings", async () => {
    const facts = expectOk(
      await experimentalAnalyze({
        filename: "src/intrinsic.tsx",
        source: `
          const div = "not-a-component";
          const el = <div />;
        `,
        lang: "tsx",
      }),
    );

    const divBinding = facts.bindings.find((b) => b.name === "div");
    expect(divBinding).toBeDefined();

    const divTag = facts.jsxTags.find((t) => t.name === "div");
    expect(divTag).toBeDefined();
    expect(divTag?.bindingId).toBeUndefined();
    expect(Object.hasOwn(divTag!, "bindingId")).toBe(false);
  });
});
