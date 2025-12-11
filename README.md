# Uno Speed Clock

A fully customizable, browser-based Uno timer inspired by chess clocks — but upgraded with QOL features, animations, themes, player management, and an integrated leaderboard system.  

Built with **HTML, CSS, and vanilla JavaScript** — no frameworks required.

---

## Features

### Core Timer Functionality
- Per-player countdown timers  
- Press **Space** to pass your turn  
- Press **P** to Start / Pause  
- Automatic “next player” highlighting  
- Reverse turn order (clockwise / counter-clockwise)  
- Adjustable initial timer (applies to all players)

### Player Management
- 2–8 players  
- Editable player names  
- Lockable names (tournament mode)  
- Knock Out & Reinstate mechanics  
- Out-of-Time rules:
  - If a player runs out → all others get **+1:00**
  - Knocked out → everyone gets **+1:00**
  - Revive-from-OOT → that player gets **+1:00**
  - Revive-from-KO → no time change

### Advanced Options
- Pass bonuses:
  - None
  - Increment (adds time)
  - Delay (pauses before countdown)
- Knock Out bonus
- Reinstate bonus  
- Dynamic themes:
  - Default  
  - Sunset  
  - Forest  
  - High Contrast  

### Built-in Leaderboard
- Tracks **all-time** & **session-only** points  
- CSV export  
- Archive & Reset  
- Auto-sorting  
- Modal interface  

### Import / Export Configuration
Save your entire session or load preset player setups.

---

## Live Interface
The UI includes:
- Responsive grid for player panels  
- Circular "table mode" layout  
- Animated states (active, next, knocked out)  
- Clean modern theme using CSS variables  
- Modal leaderboard display  

All styling is controlled entirely through `styles.css`.


