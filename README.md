# ⚡ react2next

A collection of Node.js automation scripts to migrate **React.js (Vite/CRA)** templates to **Next.js App Router** — zero manual copy-paste.

---

## 📋 Table of Contents

- [Requirements](#requirements)
- [Setup](#setup)
- [Scripts](#scripts)
  - [1. wrap-text-animation](#1-wrap-text-animation)
  - [2. upgrade-static-image](#2-upgrade-static-image)
  - [3. convert-img-to-next](#3-convert-img-to-next)
  - [4. convert-link-to-next](#4-convert-link-to-next)
  - [5. add-use-client](#5-add-use-client)
  - [6. convert-layouts](#6-convert-layouts)
  - [7. convert-pages-to-app](#7-convert-pages-to-app)
  - [8. convert-home-pages](#8-convert-home-pages)
  - [9. fix-bg-image-src](#9-fix-bg-image-src)
- [Recommended Run Order](#recommended-run-order)
- [Project Structure Assumption](#project-structure-assumption)

---

## Requirements

- Node.js `18+` (ESM support required — all scripts use `.mjs`)
- A React project with the folder structure described below

---

## Setup

1. Copy all `.mjs` script files into your **project root** (same level as `package.json`).

2. Add the following to your `package.json` scripts block:

```json
"scripts": {
  "wrap-animation":  "node wrap-text-animation.mjs",
  "upgrade-images":  "node upgrade-static-image.mjs",
  "convert-img":     "node convert-img-to-next.mjs",
  "convert-link":    "node convert-link-to-next.mjs",
  "use-client":      "node add-use-client.mjs",
  "convert-layouts": "node convert-layouts.mjs",
  "convert-pages":   "node convert-pages-to-app.mjs",
  "convert-home":    "node convert-home-pages.mjs",
  "fix-bg-src":      "node fix-bg-image-src.mjs"
}
```

3. Run any script from your project root:

```bash
npm run convert-img
```

---

## Scripts

---

### 1. `wrap-text-animation`

**File:** `wrap-text-animation.mjs`
**Runs on:** `src/features`

Wraps the inner text of every `<h2 className="section-title__title">` with a `<TextAnimation>` component and adds the import automatically.

**Before:**

```tsx
<h2 className="section-title__title">Free Appointment</h2>
```

**After:**

```tsx
import TextAnimation from "@/components/elements/TextAnimation";

<h2 className="section-title__title">
  <TextAnimation>Free Appointment</TextAnimation>
</h2>;
```

| Case                                     | Behaviour                      |
| ---------------------------------------- | ------------------------------ |
| Plain text inside `section-title__title` | Wrapped with `<TextAnimation>` |
| Already has `<TextAnimation>` inside     | Skipped                        |
| Import already present                   | Not duplicated                 |

```bash
npm run wrap-animation
```

---

### 2. `upgrade-static-image`

**File:** `upgrade-static-image.mjs`
**Runs on:** `src/data`

Finds TypeScript interface fields that are assigned imported image files (`.png`, `.jpg`, `.svg`, etc.) in data arrays and upgrades their type from `string` to `StaticImageData | string`. Adds `import { StaticImageData } from "next/image"` at the top.

**Before:**

```ts
export interface BrandItem {
  id: number;
  image: string;
}
```

**After:**

```ts
import { StaticImageData } from "next/image";

export interface BrandItem {
  id: number;
  image: StaticImageData | string;
}
```

> **Smart detection:** Only upgrades fields that are provably assigned an image import identifier in the data array — not by field name guessing. Fields like `icon: string` or `imageAlt: string` assigned plain string values are left untouched.

```bash
npm run upgrade-images
```

---

### 3. `convert-img-to-next`

**File:** `convert-img-to-next.mjs`
**Runs on:** `src/features`, `src/components`

Replaces all `<img>` tags with the Next.js `<Image>` component, adds a missing `alt` prop derived from the filename, ensures the tag is self-closing, and adds `import Image from "next/image"` at the top.

**Before:**

```tsx
<img src="assets/images/resources/logo-2.png" />
```

**After:**

```tsx
import Image from "next/image";

<Image src="assets/images/resources/logo-2.png" alt="logo 2" />;
```

| Case                         | Behaviour                                            |
| ---------------------------- | ---------------------------------------------------- |
| Missing `alt`                | Derived from filename: `logo-2.png` → `alt="logo 2"` |
| Existing `alt`               | Kept as-is                                           |
| Not self-closing `<img ...>` | Converted to self-closing `<Image ... />`            |
| Dynamic src `{someVar}`      | `alt="image"` added as fallback                      |

```bash
npm run convert-img
```

---

### 4. `convert-link-to-next`

**File:** `convert-link-to-next.mjs`
**Runs on:** `src/components`, `src/features`, `src/layouts`

Replaces `react-router-dom` Link imports with `next/link` and changes the `to` prop to `href` on all `<Link>` components.

**Before:**

```tsx
import { Link } from "react-router-dom";

<Link to="/about">About</Link>;
```

**After:**

```tsx
import Link from "next/link";

<Link href="/about">About</Link>;
```

| Import variant                                         | Behaviour                                  |
| ------------------------------------------------------ | ------------------------------------------ |
| `import Link from 'react-router-dom'`                  | Replaced with `next/link`                  |
| `import { Link } from 'react-router-dom'`              | Replaced with `next/link`                  |
| `import { Link, useNavigate } from 'react-router-dom'` | Link removed, rest kept, `next/link` added |

```bash
npm run convert-link
```

---

### 5. `add-use-client`

**File:** `add-use-client.mjs`
**Runs on:** `src/features`, `src/components`, `src/layouts`

Adds `"use client";` to the top of any component file that uses React hooks or event handler props. Files with no client-side logic remain untouched as Server Components.

**Detected hooks:**

```
useState, useEffect, useContext, useRef, useReducer,
useMemo, useCallback, useLayoutEffect, useTransition,
useId, createContext, ...
```

**Detected event handlers:**

```
onClick, onChange, onSubmit, onFocus, onBlur,
onKeyDown, onMouseEnter, onScroll, onDrop, ...
```

| Case                         | Behaviour                    |
| ---------------------------- | ---------------------------- |
| Uses hooks or event handlers | `"use client";` added at top |
| Already has `"use client"`   | Skipped entirely             |
| Static JSX only              | Left as Server Component     |

```bash
npm run use-client
```

---

### 6. `convert-layouts`

**File:** `convert-layouts.mjs`
**Runs on:** `src/layouts` — only `*Layout.tsx` files

Converts React Router layout files to Next.js layout format. Removes `<Outlet />`, adds `{ children }` prop, unwraps `<SuspenseWrapper>`, and adds the `LayoutProps` interface.

**Before:**

```tsx
import { Outlet } from "react-router-dom";
import SuspenseWrapper from "@/components/elements/SuspenseWrapper";
import Header from "@/components/headers/Header";

export default function DefaultLayout() {
  return (
    <SuspenseWrapper>
      <Header />
      <Outlet />
    </SuspenseWrapper>
  );
}
```

**After:**

```tsx
import React from "react";
import Header from "@/components/headers/Header";

interface LayoutProps {
  children: React.ReactNode;
}

export default function DefaultLayout({ children }: LayoutProps) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}
```

| Transform                                   | Behaviour                           |
| ------------------------------------------- | ----------------------------------- |
| `import { Outlet } from "react-router-dom"` | Removed                             |
| `import SuspenseWrapper from "..."`         | Removed                             |
| `<SuspenseWrapper>…</SuspenseWrapper>`      | Unwrapped → `<>…</>`                |
| `<Outlet />`                                | Replaced with `{children}`          |
| Function params                             | `({ children }: LayoutProps)` added |

```bash
npm run convert-layouts
```

---

### 7. `convert-pages-to-app`

**File:** `convert-pages-to-app.mjs`
**Runs on:** `src/pages`

Converts each React page file into a Next.js App Router `page.tsx` inside `src/app/(pages)/`. Creates the folder automatically based on the page filename.

**File mapping:**

| `src/pages/`         | `src/app/(pages)/`         |
| -------------------- | -------------------------- |
| `About.tsx`          | `about/page.tsx`           |
| `HomeOne.tsx`        | `home-one/page.tsx`        |
| `BlogGrid.tsx`       | `blog-grid/page.tsx`       |
| `ServiceDetails.tsx` | `service-details/page.tsx` |

**Before:**

```tsx
import { lazy } from "react";
import SEO from "@/components/elements/SEO";
import SuspenseWrapper from "@/components/elements/SuspenseWrapper";
import ErrorBoundary from "@/components/elements/ErrorBoundary";
const AboutOne = lazy(() => import("@/features/about/AboutOne"));

export default function About() {
  return (
    <>
      <SEO title="About || My Template" />
      <SuspenseWrapper>
        <ErrorBoundary name="about">
          <AboutOne />
        </ErrorBoundary>
      </SuspenseWrapper>
    </>
  );
}
```

**After (`src/app/(pages)/about/page.tsx`):**

```tsx
import { Metadata } from "next";
import AboutOne from "@/features/about/AboutOne";

export const metadata: Metadata = {
  title: "About || My Template",
};

export default function Page() {
  return (
    <>
      <AboutOne />
    </>
  );
}
```

```bash
npm run convert-pages
```

---

### 8. `convert-home-pages`

**File:** `convert-home-pages.mjs`
**Runs on:** `src/home`

Converts home page variants to Next.js App Router pages using a naming convention that mirrors a PHP `renameGet()` function. Each page is wrapped with its matching layout component.

**File → Route mapping:**

| `src/home/` file    | App Route          | Output                             |
| ------------------- | ------------------ | ---------------------------------- |
| `HomeOne.tsx`       | `/`                | `src/app/page.tsx`                 |
| `HomeTwo.tsx`       | `/index2`          | `src/app/index2/page.tsx`          |
| `HomeThree.tsx`     | `/index3`          | `src/app/index3/page.tsx`          |
| `SingleHomeOne.tsx` | `/index-one-page`  | `src/app/index-one-page/page.tsx`  |
| `SingleHomeTwo.tsx` | `/index2-one-page` | `src/app/index2-one-page/page.tsx` |
| `DarkHome.tsx`      | `/index-dark`      | `src/app/index-dark/page.tsx`      |

**Layout import path rules:**

| Page type                          | Layout import path                         |
| ---------------------------------- | ------------------------------------------ |
| `HomeOne`, `HomeTwo` …             | `@/layouts/multipage/HomeTwoLayout`        |
| `SingleHomeOne`, `SingleHomeTwo` … | `@/layouts/singlepage/SingleHomeOneLayout` |
| `DarkHome`, any suffix variant     | `@/layouts/DarkHomeLayout`                 |

**After (`src/app/index2/page.tsx`):**

```tsx
import React from "react";
import { Metadata } from "next";
import HomeTwoLayout from "@/layouts/multipage/HomeTwoLayout";
import MainSliderTwo from "@/features/HomeTwo/MainSliderTwo";

export const metadata: Metadata = {
  title: "Home Two || My Template",
};

const Page: React.FC = () => {
  return (
    <>
      <HomeTwoLayout>
        <MainSliderTwo />
      </HomeTwoLayout>
    </>
  );
};

export default Page;
```

```bash
npm run convert-home
```

---

### 9. `fix-bg-image-src`

**File:** `fix-bg-image-src.mjs`
**Runs on:** `src/components`, `src/features`

In Next.js, imported static images are objects — not plain strings. Inline `backgroundImage` style props must use `.src` to get the URL string. This script finds all template literals using an imported image variable in a `url(${...})` pattern and appends `.src`.

**Before:**

```tsx
style={{ backgroundImage: `url(${HeroBg})` }}
```

**After:**

```tsx
style={{ backgroundImage: `url(${HeroBg.src})` }}
```

Works on all formatting styles — single line, multi-line indented, any variable name.

| Case                 | Behaviour                 |
| -------------------- | ------------------------- |
| `url(${AnyVar})`     | `.src` appended           |
| `url(${AnyVar.src})` | Already correct — skipped |

```bash
npm run fix-bg-src
```

---

## Recommended Run Order

Run the scripts in this order for a clean migration:

```bash
# 1. Fix data layer types first
npm run upgrade-images

# 2. Convert HTML elements
npm run convert-img
npm run convert-link
npm run fix-bg-src

# 3. Convert structure
npm run convert-layouts
npm run convert-pages
npm run convert-home

# 4. Add client directives (after all components are in final state)
npm run use-client

# 5. UI text animation (optional, theme-specific)
npm run wrap-animation
```

---

## Project Structure Assumption

These scripts assume the following React source structure:

```
src/
├── assets/
│   └── images/
├── components/
│   ├── elements/
│   └── context/
├── data/
├── features/
├── home/          ← home page variants (HomeOne.tsx, HomeTwo.tsx …)
├── layouts/
├── pages/         ← route pages (About.tsx, Contact.tsx …)
└── types/
```

Output is written to:

```
src/
└── app/
    ├── page.tsx                    ← HomeOne (root)
    ├── index2/page.tsx             ← HomeTwo
    ├── index-dark/page.tsx         ← DarkHome
    ├── index-one-page/page.tsx     ← SingleHomeOne
    └── (pages)/
        ├── about/page.tsx
        ├── contact/page.tsx
        └── blog-grid/page.tsx
```

---

## License

MIT
