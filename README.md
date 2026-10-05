<div align="center">

<img src="https://lh3.googleusercontent.com/a-/AOh14GhQ7rBGHQeN7Q7l_GEOy09KdkjByqgqRHEkLPhA=s96-c" width="80" alt="Gemini"/>

# 🏭 Fleet Management Warehouse System

### Powered by **Google Gemini AI** — Real-Time Intelligent Robot Fleet Coordination

[![Gemini AI](https://img.shields.io/badge/Google_Gemini_1.5_Flash-AI_Brain-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://aistudio.google.com)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![Phaser](https://img.shields.io/badge/Phaser_3-Simulation-8e44ad?style=for-the-badge)](https://phaser.io)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev)

> **"Every robot decision is made by Google Gemini AI — in real-time, at the edge, with zero central server."**

</div>

---

## 🤖 Why Gemini AI?

Traditional warehouse robot fleets rely on **hardcoded rules** or **heavy ML models** (50MB+ `.pkl` files) that:
- Require Python environments and GPU infrastructure
- Cannot adapt to new conflict patterns
- Fail silently with no explanation

**We replaced all of that with a single Gemini API call.**

```
Old approach:  Robot State → 58MB scikit-learn model → Decision
New approach:  Robot State → Gemini 1.5 Flash API  → Decision + Reason
```

Gemini doesn't just give a decision — **it explains why**, making our system fully transparent and auditable.

---

## ⚡ Gemini in Action — Live Conflict Resolution

When two robots are about to collide in a warehouse corridor, here's what happens in **under 2 seconds**:

```
Robot R001 detects conflict with R002
           │
           ▼
┌─────────────────────────────────────────────────────┐
│              GEMINI 1.5 FLASH PROMPT                │
│                                                     │
│  Robot State:                                       │
│  • Position: (12, 8) → Destination: (24, 8)        │
│  • Battery: 67% | Task: DELIVER (HIGH priority)    │
│  • Conflict: OPPOSITE direction with R002           │
│  • Congestion: 0.72 | Alternative route: YES       │
│                                                     │
│  Choose: MOVE | WAIT | SLOW | REROUTE              │
└─────────────────────────────────────────────────────┘
           │
           ▼
     Gemini Response:
     { "action": "REROUTE",
       "confidence": 0.91,
       "reason": "Head-on conflict with high congestion;
                  alternate path available — rerouting
                  is optimal to avoid deadlock" }
           │
           ▼
  R001 reroutes. R002 proceeds. No collision. ✅
```

---

## 🧠 The Gemini Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Each Robot's Edge Agent                    │
│                                                              │
│   Conflict Detected                                          │
│         │                                                    │
│         ▼                                                    │
│   ┌─────────────┐    HIT     ┌──────────────────────────┐   │
│   │ Smart Cache │──────────► │  Return cached decision  │   │
│   │  (30s TTL)  │            │       < 1ms latency      │   │
│   └──────┬──────┘            └──────────────────────────┘   │
│          │ MISS                                              │
│          ▼                                                   │
│   ┌─────────────┐   LIMIT    ┌──────────────────────────┐   │
│   │ Rate Limiter│──────────► │   Rule-Based Fallback    │   │
│   │  14 RPM cap │            │   (instant, deterministic)│  │
│   └──────┬──────┘            └──────────────────────────┘   │
│          │ OK                                                │
│          ▼                                                   │
│   ┌──────────────────────────────────────────────────────┐  │
│   │           GOOGLE GEMINI 1.5 FLASH API                │  │
│   │                                                      │  │
│   │   Input: 24-feature robot state vector               │  │
│   │   Model: gemini-1.5-flash (free tier)                │  │
│   │   Output: { action, confidence, reason }             │  │
│   │   Timeout: 8s guard                                  │  │
│   └──────────────────────────────────────────────────────┘  │
│          │                                                   │
│          ▼                                                   │
│   Decision: MOVE / WAIT / SLOW / REROUTE                    │
│          │                                                   │
│          ▼                                                   │
│   Broadcast via P2P UDP Multicast to peer robots            │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 What Gemini Decides

| Scenario | Gemini Decision | Why |
|---|---|---|
| Head-on collision, alt route exists | **REROUTE** | Prevents deadlock, uses available path |
| Same direction, robot ahead | **SLOW** | Safe following, no route change needed |
| Critical task, perpendicular conflict | **MOVE** | Priority robot has right-of-way |
| Low battery, heading to charger | **MOVE** | Charging task overrides traffic rules |
| High congestion, no alt route | **WAIT** | Safest option until corridor clears |
| Potential deadlock detected | **REROUTE** | Breaks deadlock proactively |

---

## 🆓 Built for Free Tier — Zero Cost to Run

Gemini 1.5 Flash free tier gives us:
- **15 requests/minute** — we use max 14 (safely under limit)
- **1,500 requests/day** — more than enough for a simulation
- **1M tokens/minute** — our prompts use ~200 tokens each

**Smart optimizations keep us well within free limits:**

```javascript
// 1. Cache identical scenarios — no repeat API calls
const cacheKey = `${relativeDirection}|${priority}|${battery}|${altRoute}`;
// Same conflict type reuses decision for 30 seconds

// 2. Rate limiter — never exceeds 14 RPM
if (!canCallGemini()) return ruleBasedFallback();

// 3. Compact prompts — minimal token usage
// Only essential features sent, not raw telemetry dumps
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- **Gemini API Key** → [Get free key here](https://aistudio.google.com/app/apikey) *(takes 30 seconds)*

### Setup

```bash
# Clone
git clone https://github.com/parv-byte/Fleet-management-warehouse-system.git
cd Fleet-management-warehouse-system

# Install
npm install

# Configure
cp .env.example .env
```

Open `.env` and add your Gemini key:
```env
GEMINI_API_KEY=your_key_here   # ← Only this is required to enable AI
```

### Run

```bash
# Terminal 1 — Backend
npm run server

# Terminal 2 — Frontend  
npm run dev
```

Open **http://localhost:3000** → Watch Gemini coordinate your robot fleet live 🎉

---

## 📁 Project Structure

```
Fleet-management-warehouse-system/
│
├── server/
│   ├── index.js         # WebSocket gateway + UDP multicast observer
│   ├── robotAgent.js    # 🧠 GEMINI AI engine + P2P coordination
│   └── zoneNetwork.js   # Zone-based multicast group management
│
├── src/
│   ├── main.js          # Simulation bootstrap
│   ├── robots/          # Robot state machines
│   ├── navigation/      # A* pathfinding
│   ├── coordination/    # Multi-robot logic
│   ├── simulation/      # Core loop
│   ├── network/         # WebSocket client
│   ├── map/             # Tiled map loader
│   ├── scenarios/       # Warehouse scenarios
│   └── ui/              # Dashboard & HUD
│
├── map/                 # Warehouse tilemap assets
├── .env.example         # Environment template
├── index.html           # App shell
└── package.json
```

---

## 🏆 Gemini vs Old ML Model

| | Old (58MB .pkl model) | **New (Gemini AI)** |
|---|---|---|
| **Size** | 58 MB on disk | 0 bytes — cloud API |
| **Python required** | ✅ Yes (scikit-learn) | ❌ Not needed |
| **Explainability** | ❌ Black box | ✅ Returns reason |
| **Adaptability** | ❌ Fixed training data | ✅ Reasons about any scenario |
| **Setup complexity** | ❌ pip install, venv | ✅ Just an API key |
| **Update needed** | ❌ Retrain model | ✅ Prompt tuning only |
| **Cost** | ❌ GPU/compute | ✅ Free tier |
| **Fallback** | ❌ Crash if unavailable | ✅ Rule-based fallback |

---

## 🛠️ Tech Stack

| Layer | Tech | Role |
|---|---|---|
| 🧠 **AI Brain** | Google Gemini 1.5 Flash | Conflict resolution decisions |
| 🎮 **Simulation** | Phaser 3 | Real-time warehouse visualization |
| ⚙️ **Backend** | Node.js (ESM) | Edge agents + P2P gateway |
| 📡 **Network** | UDP Multicast | Decentralized robot P2P comms |
| 🗄️ **Database** | Supabase | State persistence & telemetry |
| 🔍 **Pathfinding** | A* Algorithm | Optimal route computation |
| ⚡ **Frontend** | Vite 6 | Fast dev server & bundler |

---

## 📜 Scripts

```bash
npm run dev      # Frontend dev server → http://localhost:3000
npm run server   # Backend gateway → ws://localhost:3001
npm run build    # Production build
```

---

<div align="center">

## 🌟 Core Innovation

**No Python. No heavy ML models. No central brain.**

Just **Google Gemini AI** — running at the edge, on every robot,
making intelligent real-time decisions with full explainability.

---

*Built for **Smart India Hackathon 2026***
*Gemini AI · P2P Coordination · Edge Intelligence · Zero Infrastructure*

</div>
