import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url);

function readRepoFile(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

describe("GitHub automation configuration", () => {
  it("enables Dependabot updates for npm dependencies and GitHub Actions", () => {
    const dependabot = readRepoFile(".github/dependabot.yml");

    expect(dependabot).toContain("version: 2");
    expect(dependabot).toContain('package-ecosystem: "npm"');
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
    expect(dependabot).toContain('directory: "/"');
    expect(dependabot).toContain('interval: "weekly"');
    expect(dependabot).toContain('timezone: "America/Denver"');
    expect(dependabot).toContain("open-pull-requests-limit: 5");
    expect(dependabot).toContain("npm-dependencies:");
    expect(dependabot).toContain("github-actions:");
    expect(dependabot).toContain('prefix: "deps"');
    expect(dependabot).toContain('prefix: "ci"');
  });

  it("publishes the npm package through trusted publishing after release gates", () => {
    const workflow = readRepoFile(".github/workflows/npm-publish.yml");
    const releaseDocs = readRepoFile("docs/release.md");
    const changelog = readRepoFile("CHANGELOG.md");

    expect(workflow).toContain("name: Publish Package to npm");
    expect(workflow).toContain("release:");
    expect(workflow).toContain("- published");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("dry_run:");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("environment:");
    expect(workflow).toContain("name: npm");
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain('registry-url: "https://registry.npmjs.org"');
    expect(workflow).toContain("npm install -g npm@latest");
    expect(workflow).toContain("pnpm run publish:check");
    expect(workflow).toContain("Verify release tag matches package version");
    expect(workflow).toContain('expected_tag="v${{ steps.package.outputs.version }}"');
    expect(workflow).toContain('npm view "@dogpile/sdk@${{ steps.package.outputs.version }}" version');
    expect(workflow).toContain("npm publish --dry-run --access public");
    expect(workflow).toContain("npm publish --access public");

    expect(releaseDocs).toContain("Organization or user: `bubstack`");
    expect(releaseDocs).toContain("Workflow filename: `npm-publish.yml`");
    expect(releaseDocs).toContain("Environment name: `npm`");
    expect(releaseDocs).toContain("npm Trusted Publishing/OIDC");
    expect(changelog).toContain("Dependabot version-update configuration");
    expect(changelog).toContain("npm publish workflow");
  });
});
