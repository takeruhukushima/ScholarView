---
title: Getting Started
description: Setting up a ScholarView development environment and the basic workflow
---

This guide explains how to run ScholarView locally and take your first step into decentralized academic publishing.

## Prerequisites

Before you begin, make sure the following tools are installed:

- **Node.js**: v18.x or later
- **pnpm**: package manager
- **lex CLI**: a tool for managing AT Protocol lexicons (`npm install -g @atproto/lex`)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/takeruhukushima/ScholarView.git
   cd ScholarView
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Build the lexicons**
   Generate TypeScript type definitions from the custom lexicon definitions.
   ```bash
   lex build --importExt=""
   ```

4. **Start the application**
   ```bash
   pnpm dev
   ```

## Basic workflow

1. **Log in**: Click the login button in the sidebar, enter your Bluesky handle, and complete OAuth authentication.
2. **Create a workspace**: Create `.md` or `.tex` files in the file tree in the left sidebar and start writing.
3. **Add assets**: Drop image files onto the editor and they are automatically uploaded to your PDS.
4. **Publish your paper**: When you're done writing, choose "Publish" from the toolbar to broadcast it to Bluesky.
5. **Join the deliberation**: Review and reply to feedback from other researchers in the Discussion tab of the right panel.

## Developer community

Please report bugs and propose new features on [GitHub Issues](https://github.com/takeruhukushima/ScholarView/issues). ScholarView is 100% open source, and contributions are welcome.
