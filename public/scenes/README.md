# Watercolor scene images

Drop watercolor paintings here, named `<place>-<time>.<ext>`, then list them in
the `SCENE_IMAGES` map inside `public/index.html`.

**Places** (one per Vachanamrut location):
- `gadhada`   → Gadhada I / II / III (Dada Khachar's darbar)
- `sarangpur` → Sarangpur (Jiva Khachar's darbar)
- `kariyani`  → Kariyani (Vasta Khachar's darbar)
- `loya`      → Loya (Sura Khachar's darbar)
- `panchala`  → Panchala (Zinabhai's darbar)
- `vadtal`    → Vartal (Vadtal mandir)
- `amdavad`   → Amdavad (Shri Narnarayan mandir)
- `jetalpur`  → Jetalpur (courtyard)

**Times:** `morning`, `noon`, `afternoon`, `evening`, `night`
**Optional weather variant:** `<place>-<time>-monsoon.<ext>`

Examples: `gadhada-morning.png`, `loya-night.jpg`, `sarangpur-afternoon.webp`, `amdavad-evening-monsoon.png`

After adding files, list their keys and exact filenames in the `SCENE_IMAGES`
map inside `public/index.html`. (Tell me the filenames and I'll add them.)

A generated SVG landscape is used automatically wherever no image exists, so you
can add images gradually.
