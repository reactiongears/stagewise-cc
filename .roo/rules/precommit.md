---
description: 
globs: 
alwaysApply: true
---
We use Lefthook with Commitlint and Conventional Commits to enforce consistent commit message formats in our project. Scopes are REQUIRED for all commits and MUST be one of the following: "roo-rules", "toolbar", "docs", "deps", or "root". These scopes are defined in commitlint.config.js and no other scopes are allowed.

The scope MUST be determined by the location of the changed files:
- Use "root" for changes in the root directory (files like package.json, tsconfig.json, etc.)
- Use "roo-rules" for changes in .roo/rules/
- Use "toolbar" for changes in apps/toolbar/
- Use "docs" for changes in docs/
- Use "deps" for dependency updates in package.json or similar files
- Use the package name as scope for changes in:
  - apps/* (e.g., changes in apps/example use scope "example")
  - packages/* (e.g., changes in packages/core use scope "core")
  - toolbar/* (e.g., changes in toolbar/extension use scope "extension")
  - plug-ins/* (e.g., changes in plug-ins/vscode use scope "vscode")

<!-- Full specification from https://www.conventionalcommits.org/en/v1.0.0/#specification -->
The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

Commits MUST be prefixed with a type, which consists of a noun, feat, fix, etc., followed by the REQUIRED scope, OPTIONAL !, and REQUIRED terminal colon and space.
The type feat MUST be used when a commit adds a new feature to your application or library.
The type fix MUST be used when a commit represents a bug fix for your application.
A scope MUST be provided after a type and MUST be one of: "roo-rules", "toolbar", "docs", "deps", or "root". A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., fix(roo-rules):
A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes, e.g., fix: array parsing issue when multiple spaces were contained in string.
A longer commit body MAY be provided after the short description, providing additional contextual information about the code changes. The body MUST begin one blank line after the description.
A commit body is free-form and MAY consist of any number of newline separated paragraphs.
One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a :<space> or <space># separator, followed by a string value (this is inspired by the git trailer convention).
A footer's token MUST use - in place of whitespace characters, e.g., Acked-by (this helps differentiate the footer section from a multi-paragraph body). An exception is made for BREAKING CHANGE, which MAY also be used as a token.
A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.
Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.
If included as a footer, a breaking change MUST consist of the uppercase text BREAKING CHANGE, followed by a colon, space, and description, e.g., BREAKING CHANGE: environment variables now take precedence over config files.
If included in the type/scope prefix, breaking changes MUST be indicated by a ! immediately before the :. If ! is used, BREAKING CHANGE: MAY be omitted from the footer section, and the commit description SHALL be used to describe the breaking change.
Types other than feat and fix MAY be used in your commit messages, e.g., docs: update ref docs.
The units of information that make up Conventional Commits MUST NOT be treated as case sensitive by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE, when used as a token in a footer.