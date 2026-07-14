


# ⏱️ time - Timing & Leaderboard System

HTML based Timing App for Sports and Other Activities. Coded heavily with AI and some (very few lines) of own Code.

A high-performance, lightweight web application for precise timing, specially developed for sports events, scout gatherings, and other competitions.

## 🚀 Features

* **Precision Timing:** Start, stop, and pause functionality for individual runners.
* **Group Mode:** Manage and time multiple runners simultaneously.
* **Dynamic Adjustments:** Easily add penalty seconds or subtract bonus time with configurable buttons.
* **Leaderboard:** Automatic result sorting with export options (PDF, Image, JSON).
* **Dynamic Localization:** Fully modular language system managed via the `lang/` directory and `lang.info`.
* **Screen View:** Separate popup window for live projection on large displays.
* **Dark Mode:** Eye-friendly design for night-time or low-light operation.

## 🛠️ Technical Details

* **Language Management:** Languages are dynamically loaded at startup based on the `lang.info` configuration file.
* **Data Storage:** Uses browser `localStorage` for persistent data. Supports full import/export functionality via JSON or compressed URL parameters.
* **Zero Dependencies:** Runs directly in the browser; requires a web server to handle `fetch()` requests for language and configuration files correctly.

## 📦 Installation & Setup

1. Clone this repository or download the source code.
2. Ensure all files (`index.html`, `lang.info`, `ver.info`, `whitelabel.info`) and the `lang/` directory are present in the root folder.
3. **Important:** Due to browser security policies regarding `fetch()`, please run the application through a local web server (e.g., VS Code "Live Server", `python -m http.server`, or similar). Opening the `index.html` directly via `file://` will prevent the language files from loading.

## 🌍 Adding a New Language

1. Create a new file in the `lang/` folder, e.g., `fr.lang`.
2. Add the language code (e.g., `fr`) to the `available` array in your `lang.info` file.
3. Follow the structure of the `de.lang` or `en.lang` files to define your translations.

## ☕ Support & Contact

This project is developed with passion. If you find it useful, I would be honored to receive your feedback or support on GitHub!
