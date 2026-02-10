# Contributing to OverSeek v2

First off, thanks for taking the time to contribute! ❤️

All types of contributions are encouraged and valued. See the [Table of Contents](#table-of-contents) for different ways to help and details about how this project handles them. Please make sure to read the relevant section before making your contribution. It will make it a lot easier for us maintainers and smooth out the experience for all involved. The community looks forward to your contributions.

## Table of Contents

- [I Have a Question](#i-have-a-question)
- [I Want To Contribute](#i-want-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Your First Code Contribution](#your-first-code-contribution)
- [Development Environment](#development-environment)

## I Have a Question

> If you want to ask a question, we assume that you have read the available [Documentation](README.md).

Before you ask a question, it is best to search for existing [Issues](https://github.com/MerlinStacks/overseek/issues) that might help you. In case you have found a suitable issue and still need clarification, you can write your question in this issue. It is also advisable to search the internet for answers first.

## I Want To Contribute

### Reporting Bugs

#### Before Submitting a Bug Report

A good bug report shouldn't leave others needing to chase you up for more information. Therefore, we ask you to investigate carefully, collect information and describe the issue in detail in your report. Please complete the following steps in advance to help us fix any potential bug as fast as possible.

- **Make sure that you are using the latest version.**
- **Determine if your bug is really a bug and not an error on your side e.g. using incompatible environment components/versions.**
- **Collect information about the bug:**
  - Stack trace (Traceback)
  - OS, Platform and Version (Windows, Linux, macOS, x86, ARM)
  - Version of the interpreter, compiler, SDK, runtime environment, package manager, depending on what seems relevant.
  - Possibly your input and the output
  - Can you reliably reproduce the issue? And can you also reproduce it with older versions?

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for OverSeek v2, **including completely new features and minor improvements to existing functionality**. Following these guidelines will help maintainers and the community to understand your suggestion and find related suggestions.

### Your First Code Contribution

1. Fork the project.
2. Create a branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## Development Environment

To contribute code, please ensure your environment matches our "Iron Core" stack:

- **Node.js**: v22.x or higher (Required for Prisma 7)
- **Database**: PostgreSQL 17+ (with pgvector extension)
- **Search**: Elasticsearch 9.x
- **Cache**: Redis 7+
- **Backend Framework**: Fastify 5.x (We no longer use Express)
- **Frontend Framework**: React 19.x with Vite

### Getting Started

```bash
git clone https://github.com/MerlinStacks/overseek.git
cd overseek
npm install
cp stack.env.example stack.env
# Edit stack.env with your local database/Redis/ES connection details
cd server && npx prisma migrate dev && cd ..
npm run dev
```

> **Docker users:** If running the full stack with Docker Compose, create the proxy network first: `docker network create proxy-net`

Please run `npm run lint` before submitting PRs to ensure your code follows our ESLint 9 Flat Config standards.

## Styleguides

### Commit Messages

- Use [Conventional Commits](https://www.conventionalcommits.org/).
- Present tense. "Add feature" not "Added feature".
- Imperative mood. "Move cursor to..." not "Moves cursor to...".

## Join The Project Team

If you are interested in becoming a core maintainer, please reach out via our [GitHub Issues](https://github.com/MerlinStacks/overseek/issues).
