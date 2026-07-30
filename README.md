# 🍒 Jessy Juice Boutique: Interactive Dessert Planner

Welcome to the official repository for **Jessy Juice Boutique** in Batroun, Lebanon! 

This is a modern full-stack web application designed with an elegant interface. Customers can explore premium Belgian chocolate crepes, avocado super cocktail smoothies, dual-layer loaded waffles, and stacked pancakes. Key interactive features include custom platter personalization using **My Plate**, a real-time loyalty point verification system with custom SMS verification simulation, and an AI-powered conversational dessert assistant named **Jessy**.

---

## 🏗️ Technical Architecture & Stack

- **Frontend**: [Vue.js 3](https://vuejs.org/) (SFCs, Composition API, Refs) styled with [Tailwind CSS 4.0](https://tailwindcss.com/) for a sleek, responsive, and tactile display card design.
- **Backend**: [Express Node.js](https://expressjs.com/) server integrated seamlessly as a development-time Vite middleware. For production, it serves precompiled production builds.
- **AI Core**: Powered by high-speed server-side [Google Gemini API](https://ai.google.dev/) using the official `@google/genai` TypeScript SDK.
- **Video Cinematics**: Automatically streams slow-motion fruit and chocolate dessert backdrops.

---

## ⚡ Setup Guide: Running Locally

Follow these quick commands inside your local VS Code terminal to install, configure, and boot the full-stack application on port `3000`.

### 1. Extract and Install Dependencies
Navigate to your project root category and install all packages:
```bash
npm install
```

### 2. Configure Your Environment Secrets
Duplicate the `.env.example` file and label it `.env`:
```bash
cp .env.example .env
```
Inside your new `.env` file, configure your secure Gemini Key. This enables the server-side assistant chat endpoints without exposing keys to the browser:
```env
GEMINI_API_KEY=your_actual_google_gemini_api_key_here
```

### 3. Open Development Host
Launch both Vue 3 and the Express server concurrently:
```bash
npm run dev
```
Once booted, open `http://localhost:3000` in your web browser.

---

## 📁 Repository Structure

```markdown
├── public/                 # Static graphical assets, markers, & custom overlays
├── src/
│   ├── App.vue             # Main viewport: includes specials, platter config, and toast overlays
│   ├── components/         # Extracted modular Vue components (e.g. Chatbot, IntroLoader)
│   ├── data.ts             # Authentic item pricing lists and categories
│   ├── index.css           # Global typography setup (Google Fonts: Inter & JetBrains Mono)
│   └── main.ts             # Vue initiation and mount point
├── server.ts               # Core full-stack Express API routes and Gemini controller
├── package.json            # Development dependencies & bundling instructions
└── .gitignore              # Preconfigured exclusions (locks local logs, caches, and node modules)
```

---

## 🚀 Resolving Local Git Conflicts (Quick Fixes)

If you have untracked changes, local database files (`db.sqlite3` locks), or rebase rejections during git push, here is the fastest sequence of steps to reset cleanliness, combine local branch updates, and push your code smoothly:

### A. Cleaning locks & untracked files
If your terminal prompts file conflicts or unlinking locks:
```bash
# Force delete cached database lock files
git clean -fd

# If a process is using db.sqlite3, use this on Windows (PowerShell) to terminate it:
Stop-Process -Name "python" -Force
```

### B. Pull, Rebase, and Sync Remotes
If `git push` was rejected because the remote contains work that you do not have locally:
```bash
# Pull remote files matching your remote branch smoothly
git pull origin main --rebase

# Mark code files as updated and resolve any small edits
git add .

# Create a clean checkpoint commit
git commit -m "sync: updated Jessy Juice Boutique codebase"

# Push securely to your remote Git platform
git push origin main
```

Enjoy building the sweet flavors of Batroun! 🍓
