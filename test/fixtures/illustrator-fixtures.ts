import { join } from "node:path";

export type IllustratorFixturePriority = "P0" | "P1" | "P2";

export interface IllustratorFixtureRequiredArtifacts {
  savedOutput: boolean;
  goldenIr: boolean;
  automatedCoverage: boolean;
  visualBaseline: boolean;
  manualQa: boolean;
}

export interface IllustratorFixture {
  name: string;
  sourceAiPath: string;
  priority: IllustratorFixturePriority;
  scenarios: string[];
  releaseBlocking: boolean;
  requiredArtifacts: IllustratorFixtureRequiredArtifacts;
}

export const ILLUSTRATOR_VISUAL_WIDTHS = [320, 768, 1024, 1440] as const;

export const illustratorFixtures: IllustratorFixture[] = [
  {
    name: "countries",
    sourceAiPath: "data/countries.ai",
    priority: "P1",
    scenarios: ["editorial", "svg-layer", "custom-html", "multi-artboard"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "fixed",
    sourceAiPath: "data/fixed.ai",
    priority: "P1",
    scenarios: ["fixed-layout", "multi-artboard"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "template",
    sourceAiPath: "data/template.ai",
    priority: "P1",
    scenarios: ["responsive", "multi-artboard"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "sample-ai-file",
    sourceAiPath: "data/sample-ai-file.ai",
    priority: "P2",
    scenarios: ["basic-export", "metadata", "text"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "text-cleanup",
    sourceAiPath: "data/text-cleanup.ai",
    priority: "P2",
    scenarios: ["text-cleanup", "custom-css"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "multiple-files-test",
    sourceAiPath: "data/multiple-files-test.ai",
    priority: "P0",
    scenarios: ["multiple-files", "grouping"],
    releaseBlocking: true,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: true,
    },
  },
  {
    name: "layer-types-test",
    sourceAiPath: "data/layer-types-test.ai",
    priority: "P0",
    scenarios: ["svg-layer", "png-layer", "symbol-layer", "video-layer", "html-hooks"],
    releaseBlocking: true,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: true,
    },
  },
  {
    name: "mask-test",
    sourceAiPath: "data/mask-test.ai",
    priority: "P0",
    scenarios: ["masking", "hidden-content"],
    releaseBlocking: true,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: true,
    },
  },
  {
    name: "settings-precedence",
    sourceAiPath: "data/settings-precedence/settings-precedence.ai",
    priority: "P0",
    scenarios: ["settings-block", "config-file", "panel-precedence"],
    releaseBlocking: true,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: true,
    },
  },
  {
    name: "rotated-text-real",
    sourceAiPath: "data/rotated-text-real/rotated-text-real.ai",
    priority: "P1",
    scenarios: ["rotation", "text-html"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "rotated-text-image",
    sourceAiPath: "data/rotated-text-image/rotated-text-image.ai",
    priority: "P1",
    scenarios: ["rotation", "text-image"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "character-styles-real",
    sourceAiPath: "data/character-styles-real/character-styles-real.ai",
    priority: "P1",
    scenarios: ["character-styles", "rich-text"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "hyperlinks",
    sourceAiPath: "data/hyperlinks/hyperlinks.ai",
    priority: "P1",
    scenarios: ["clickable-link", "html-text"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: false,
      manualQa: true,
    },
  },
  {
    name: "accessibility",
    sourceAiPath: "data/accessibility/accessibility.ai",
    priority: "P1",
    scenarios: ["accessibility", "alt-text", "aria-role"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: false,
      manualQa: true,
    },
  },
  {
    name: "layer-export-matrix",
    sourceAiPath: "data/layer-export-matrix/layer-export-matrix.ai",
    priority: "P0",
    scenarios: ["svg-asset", "svg-inline", "png-overlay"],
    releaseBlocking: true,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: true,
    },
  },
  {
    name: "video-editorial",
    sourceAiPath: "data/video-editorial/video-editorial.ai",
    priority: "P1",
    scenarios: ["video-layer", "video-invalid", "editorial"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: false,
      manualQa: true,
    },
  },
  {
    name: "html-hooks-editorial",
    sourceAiPath: "data/html-hooks-editorial/html-hooks-editorial.ai",
    priority: "P1",
    scenarios: ["html-before", "html-after", "custom-blocks", "editorial"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: true,
    },
  },
  {
    name: "font-mapping-real",
    sourceAiPath: "data/font-mapping-real/font-mapping-real.ai",
    priority: "P1",
    scenarios: ["font-mapping", "missing-font-warning"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "overset-text-real",
    sourceAiPath: "data/overset-text-real/overset-text-real.ai",
    priority: "P1",
    scenarios: ["overset-text", "area-text"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: true,
      manualQa: false,
    },
  },
  {
    name: "large-story",
    sourceAiPath: "data/large-story/large-story.ai",
    priority: "P1",
    scenarios: ["editorial", "multi-artboard", "performance", "svg-layer", "png-layer"],
    releaseBlocking: false,
    requiredArtifacts: {
      savedOutput: true,
      goldenIr: true,
      automatedCoverage: true,
      visualBaseline: false,
      manualQa: true,
    },
  },
];

export function getIllustratorFixtureOutputDir(
  rootDir: string,
  fixture: IllustratorFixture,
): string {
  return join(rootDir, "data/all2html-output", fixture.name);
}

export function getIllustratorFixtureGoldenIrPath(
  rootDir: string,
  fixture: IllustratorFixture,
): string {
  return join(rootDir, "test/fixtures/golden-ir", `${fixture.name}.json`);
}

export function getIllustratorFixtureSummaryPath(
  rootDir: string,
  fixture: IllustratorFixture,
): string {
  return join(getIllustratorFixtureOutputDir(rootDir, fixture), "summary.json");
}

export function getIllustratorFixtureVisualBaselinePaths(
  rootDir: string,
  fixture: IllustratorFixture,
): string[] {
  return ILLUSTRATOR_VISUAL_WIDTHS.map((width) =>
    join(rootDir, "test/visual/__screenshots__/screenshot.test.ts", `${fixture.name}-${width}.png`),
  );
}

export function getIllustratorFixtureManualQaDocPath(rootDir: string): string {
  return join(rootDir, "internal-docs/illustrator-manual-qa-checklist.md");
}
