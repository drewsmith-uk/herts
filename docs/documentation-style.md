# Documentation style

Herts uses **ASD-STE100 Simplified Technical English (Issue 9)** for project documentation.
The [official standard](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) defines the writing rules and dictionary.
See the [official overview](https://www.asd-ste100.org/about_STE.html) for information about technical terms.

## Scope

Apply this rule to README files, guides, contributor instructions, release notes, API descriptions, and documentation in pull requests.
Apply it to new or changed code comments and templates that generate documentation.
The root [AGENTS.md](../AGENTS.md) gives this instruction to coding agents for every project task.
Contributors must follow the same rule.

Preserve code, commands, paths, identifiers, exact UI labels, quotations, and legal text when their original form is necessary.
Do not change an API name or command to satisfy a prose rule.
Write the explanation around that text in STE.
Do not copy the standard's dictionary into this repository.

## Writing rules

- Use dictionary words with their approved meanings and parts of speech. Check uncertain words against the official standard.
- Use the same term for the same thing. Define an unfamiliar abbreviation at first use.
- Use active voice. Name the component or person that performs the action.
- Use the imperative for instructions. Put a condition before the instruction when the condition determines the action.
- Give one instruction in each step. Use numbered steps when order matters.
- Keep each sentence to 20 words or fewer. This project applies the procedural limit to descriptions too.
- Keep each paragraph about one subject. Divide long explanations into short paragraphs.
- Use full forms instead of contractions. Avoid idioms, promotional wording, and unnecessary words.
- State requirements with “must”. Use “can” for capability and “may” for permission.
- Preserve technical meaning, failure conditions, recovery steps, and warnings when you simplify text.

## Project technical terms

STE permits technical nouns and verbs for a subject area.
The following terms have specific meanings in Herts documentation.
They do not exempt surrounding prose from the writing rules.

| Term | Meaning |
| --- | --- |
| Herts | This application. |
| Hermes | The external agent system that runs conversations and model work. |
| backend | The Hermes service to which Herts connects. |
| app service | The Herts server process. |
| plugin | An optional Herts package with screens, actions, or server functions. |
| profile | A Hermes configuration with its own identity and settings. |
| conversation | A message history that Herts can display and continue. |
| session | A stored or running Hermes session. State which type when the distinction matters. |
| draft | Editable content saved before submission. |
| receipt | A saved record of an operation and its status. |
| unknown outcome | An operation whose remote result Herts cannot confirm. |
| acknowledgement | Confirmation that a receiving component accepted an operation or saved its result. |
| cached | Stored locally for later use, including offline use. |
| migration | A change to stored data that a new application version requires. |
| fixture | Isolated synthetic data or services used by a test. |
| PWA | Progressive web app; an app installed through a browser. |
| UI | User interface. |
| API | Application programming interface. |

Product names, protocols, programming terms, and exact labels can also be necessary technical terms.
Define new project terms here when readers need a shared definition.
Do not treat an ordinary word as a technical term to avoid review.

## Automatic checks

Run the documentation checks with these commands:

```sh
npm run check:docs
npm run test:docs
```

The checker reads tracked and new Markdown files that Git does not ignore.
It checks paragraphs, headings, list text, table cells, link labels, and image descriptions.
It excludes code blocks, link destinations, and HTML markup.
It counts each inline code span or URL as one technical term.
Use inline code only for literal technical text.

The checker rejects sentences with more than 20 words, common contractions, and selected unnecessary expressions.
A colon separates a list introduction from the following text.
A semicolon does not reset the word count.
The word count is an approximation for Markdown, not the standard's complete word-count method.
The checker uses `Intl.Segmenter` with English sentence rules to find sentence boundaries.
These rules keep a period with the current sentence when lowercase text follows, including after closing quotes or brackets.
Capital letters after abbreviations can still cause incorrect boundaries.
Review these cases manually, including abbreviations before names and sentences that start with lowercase technical terms.

`npm run check` and `npm run check:release` run the documentation checker and its regression tests first.
The Check and Quality workflows run those commands on pull requests.
Repository administrators must require their status checks in branch protection to prevent merges after failures.
Local checks and workflow files cannot configure that remote setting.

## Review before completion

1. Read changed prose against the official rules and dictionary.
2. Verify technical terms and their meanings.
3. Compare commands, links, requirements, and recovery instructions with the original text.
4. Run the automatic checks.
5. State any remaining review limits.

The checker enforces a useful subset of the project rule.
It cannot verify all approved vocabulary, grammatical roles, technical accuracy, or full ASD-STE100 compliance.
Code comments, pull-request text, and non-Markdown documents require manual review.
A passing check is not certification.
