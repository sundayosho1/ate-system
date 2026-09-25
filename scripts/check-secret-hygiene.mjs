import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowedPlaceholderPatterns = [
  "REPLACE_WITH_LOCAL_VALUE",
  "USER:PASSWORD@HOST",
  "x-access-token:[REDACTED]",
];

const secretPatterns = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  },
  {
    name: "GitHub token",
    pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/,
  },
  {
    name: "AWS access key",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "generic credential assignment",
    pattern:
      /\b(?:password|passwd|pwd|secret|api[_-]?key|token|private[_-]?key)\b\s*[:=]\s*['"]?(?!REPLACE_WITH|PLACEHOLDER|TODO|YOUR_|example|postgresql:\/\/USER:PASSWORD@HOST)[^'"\s#]+/i,
  },
];

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);

const findings = [];

for (const file of repositoryFiles) {
  const content = readFileSync(file, "utf8");
  const sanitizedContent = allowedPlaceholderPatterns.reduce(
    (value, allowedPattern) => value.replaceAll(allowedPattern, ""),
    content,
  );

  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(sanitizedContent)) {
      findings.push(`${file}: possible ${name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secret material detected:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Secret hygiene check passed for ${repositoryFiles.length} repository files.`);
