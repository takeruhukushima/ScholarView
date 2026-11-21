---
title: Architecture
description: ScholarView's client-side design and its AT Protocol integration
---

ScholarView adopts a **Client-Side First** design that runs entirely in the user's browser, returning data ownership to the user through AT Protocol.

## 1. Client-side data management (IndexedDB)

ScholarView uses the browser's built-in **IndexedDB** for fast offline operation and data persistence.

- **Local Storage (`scholarview-client-db`)**: Stores paper drafts, the workspace file structure, and a cache of records fetched from the PDS locally.
- **Direct PDS Interaction**: Writes (publishing) go directly to the user's PDS through an OAuth session. Because no central server is involved, censorship resistance and privacy are preserved.

## 2. Authentication (AT Protocol OAuth)

Authentication uses **`@atproto/oauth-client-browser`**.

- **Secure Login**: Users sign in with their own Bluesky account or DID.
- **Scope-based Permission**: Only the minimum permissions needed to create and delete paper records (`sci.peer.article`) and Bluesky posts (`app.bsky.feed.post`) are requested.
- **AppView Resolution**: The browser talks directly to the PDS and AppView to fetch real-time social data.

## 3. Custom lexicon: `sci.peer.article`

Structured paper data is defined by a custom lexicon called `sci.peer.article`.

- **Block structure**: A paper is composed of blocks (paragraph, heading, image, etc.) stored as a flat array with hierarchy levels (`level`).
- **Authors, citations, and images**: The author list, BibTeX citations, and references to **PDS Blobs** (image assets) are managed together.

## 4. Hybrid integration (Social & Academic)

ScholarView combines the rigor of academic data with Bluesky's social reach.

- **Academic Layer**: The paper body and its structure are managed with the custom lexicon.
- **Social Layer**: Review comments, deliberation, likes, reposts, and other actions all use standard Bluesky posts (`app.bsky.feed.*`).

With this design, peer review (deliberation) begins across Bluesky's vast network the moment a paper is published.
