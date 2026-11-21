---
title: Introduction
description: ScholarView's concept and its commitment to DeSci (Decentralized Science)
---

ScholarView is a **decentralized academic peer review and deliberation platform** built on AT Protocol. It provides next-generation scholarly infrastructure where researchers own their data and conduct peer review and discussion in the open.

## The problems ScholarView solves

Today's academic publishing system suffers from data lock-in by centralized publishers, opaque peer review, and expensive subscription fees. Grounded in the principles of **DeSci (Decentralized Science)**, ScholarView addresses these problems with technology.

- **Data sovereignty**: Paper data is stored on the researcher's own PDS (Personal Data Server) and does not depend on any single platform.
- **Transparent peer review**: Built on Bluesky's social infrastructure, deliberation is open — anyone can read it and take part.
- **Local-first**: Users index and manage their own data locally, which provides censorship resistance and strong privacy.

## Core concepts

### 1. Structured data on AT Protocol
A paper is not just a PDF — it is managed as a structured record (`sci.peer.article`) on AT Protocol. This makes it easy to quote part of a paper or analyze it programmatically.

### 2. Seamless Bluesky integration
All review comments and discussions are handled as Bluesky posts (`app.bsky.feed.post`). By leveraging a massive social network, research reaches a wider audience and gathers more diverse feedback.

### 3. Hybrid block editing
A custom block editor that combines the strengths of TeX and Markdown lets you intuitively write advanced academic text, including mathematics.

## How ScholarView is organized

ScholarView consists of three main components:

1.  **Workspace**: A desktop-class web UI for writing papers, managing files, and previewing.
2.  **Lexicon**: A set of schemas that define data formats on the decentralized network.
3.  **AppView (Local)**: A sync engine that collects data from the network and builds your own personal database.
